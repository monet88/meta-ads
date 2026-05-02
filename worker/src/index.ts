import { RULE_CONFIG_DEFAULTS, type ActionLogEntry, type ClassifiedError, type Env, type RuleAction, type RuleConfig, type RunStatus } from './types';
import { evaluateCampaigns, executeCampaignActions, createSystemLogEntry } from './auto-rule-engine';
import { Router } from './router';
import { handleOptions, withCors } from './cors';
import {
  handleGetCampaigns,
  handleGetCampaignInsights,
  handleGetConfig,
  handlePutConfig,
  handleGetLogs,
  handleHealth
} from './api-handlers';

const DEFAULT_CONFIG: RuleConfig = RULE_CONFIG_DEFAULTS;
const RULE_LOGS_KEY = 'RULE_LOGS';
const RUN_LOCK_KEY = 'AUTOMATION_RUN_LOCK';
const RUN_LOCK_TTL_SECONDS = 60 * 25;

function getRunId(): string {
  return crypto.randomUUID();
}

function getNowIso(): string {
  return new Date().toISOString();
}

function getLockPayload(runId: string): string {
  return JSON.stringify({ runId, acquiredAt: getNowIso() });
}

async function tryAcquireRunLock(kv: KVNamespace, runId: string): Promise<boolean> {
  const existingLock = await kv.get(RUN_LOCK_KEY, 'text');
  if (existingLock) {
    return false;
  }

  await kv.put(RUN_LOCK_KEY, getLockPayload(runId), {
    expirationTtl: RUN_LOCK_TTL_SECONDS,
  });

  const confirmedLock = await kv.get(RUN_LOCK_KEY, 'text');
  if (!confirmedLock) {
    return false;
  }

  try {
    const parsed = JSON.parse(confirmedLock) as { runId?: string };
    return parsed.runId === runId;
  } catch {
    return false;
  }
}

async function releaseRunLock(kv: KVNamespace): Promise<void> {
  await kv.delete(RUN_LOCK_KEY);
}

async function persistAuditRun(
  db: D1Database | undefined,
  input: {
    runId: string;
    status: RunStatus;
    summary?: Record<string, unknown> | null;
    error?: ClassifiedError | null;
  }
): Promise<void> {
  if (!db) {
    return;
  }

  const now = getNowIso();
  await db
    .prepare(
      'INSERT INTO automation_runs (id, status, startedAt, completedAt, failedAt, summaryJson, errorJson) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      input.runId,
      input.status,
      now,
      input.status === 'completed' || input.status === 'skipped_overlap' || input.status === 'blocked_live_gate' ? now : null,
      input.status === 'failed' ? now : null,
      JSON.stringify(input.summary ?? null),
      JSON.stringify(input.error ?? null)
    )
    .run();
}

async function persistCampaignStates(
  db: D1Database | undefined,
  updates: Array<{
    campaignId: string;
    lastDecision: string;
    lastAction: 'PAUSE' | 'RESUME' | null;
    lastActionAt: string | null;
    lastRunId: string | null;
    pausedByTool: boolean;
  }>
): Promise<void> {
  if (!db || updates.length === 0) {
    return;
  }

  for (const update of updates) {
    await db
      .prepare(
        'INSERT INTO campaign_states (campaignId, lastDecision, lastAction, lastActionAt, lastRunId, pausedByTool) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(campaignId) DO UPDATE SET lastDecision=excluded.lastDecision, lastAction=excluded.lastAction, lastActionAt=excluded.lastActionAt, lastRunId=excluded.lastRunId, pausedByTool=excluded.pausedByTool'
      )
      .bind(
        update.campaignId,
        update.lastDecision,
        update.lastAction,
        update.lastActionAt,
        update.lastRunId,
        update.pausedByTool ? 1 : 0
      )
      .run();
  }
}

async function persistAuditLogs(db: D1Database | undefined, logs: ActionLogEntry[]): Promise<void> {
  if (!db || logs.length === 0) {
    return;
  }

  for (const log of logs) {
    await db
      .prepare(
        'INSERT INTO action_logs (id, runId, campaignId, decision, source, status, occurredAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        log.id,
        log.runId ?? 'unknown-run',
        log.campaignId,
        log.decision,
        log.source,
        log.status,
        log.occurredAt,
        JSON.stringify(log)
      )
      .run();
  }
}

export async function persistConfigVersion(
  db: D1Database | undefined,
  input: {
    version: number;
    configJson: string;
    createdAt: string;
    createdBy: string | null;
  }
): Promise<void> {
  if (!db) {
    return;
  }

  await db
    .prepare(
      'INSERT INTO config_versions (version, configJson, createdAt, createdBy) VALUES (?, ?, ?, ?)'
    )
    .bind(input.version, input.configJson, input.createdAt, input.createdBy)
    .run();
}


function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
}

function jsonAuthError(code: string, message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      success: false,
      data: null,
      error: {
        category: 'auth',
        code,
        message,
        retryable: false,
      },
      message,
      meta: {
        generatedAt: new Date().toISOString(),
      },
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

function isLocalRequest(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');

  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    origin?.startsWith('http://localhost:') === true ||
    origin?.startsWith('http://127.0.0.1:') === true ||
    referer?.startsWith('http://localhost:') === true ||
    referer?.startsWith('http://127.0.0.1:') === true
  );
}

function isLocalDevBypassEnabled(env: Env): boolean {
  return env.ALLOW_LOCAL_DEV === 'true';
}

function hasAccessIdentity(request: Request, env: Env): boolean {
  if (isLocalRequest(request) && isLocalDevBypassEnabled(env)) {
    return true;
  }

  if (env.API_AUTH_TOKEN) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader === `Bearer ${env.API_AUTH_TOKEN}`) {
      return true;
    }
  }

  const accessJwt = request.headers.get('CF-Access-Jwt-Assertion');
  return typeof accessJwt === 'string' && accessJwt.length > 0;
}

function requireApiAuth(request: Request, env: Env): Response | null {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) {
    return null;
  }

  if (request.method === 'OPTIONS') {
    return null;
  }

  if (hasAccessIdentity(request, env)) {
    return null;
  }

  return jsonAuthError('ACCESS_UNAUTHORIZED', 'Authentication required for API access.', 401);
}

function getAllowedOrigin(env: Env): string | null {
  if (!env.FRONTEND_URL) {
    return null;
  }

  try {
    return new URL(env.FRONTEND_URL).origin;
  } catch {
    return null;
  }
}

function hasAllowedOrigin(request: Request, env: Env): boolean {
  if (isLocalRequest(request) && isLocalDevBypassEnabled(env)) {
    return true;
  }

  const allowedOrigin = getAllowedOrigin(env);
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');

  if (allowedOrigin && origin === allowedOrigin) {
    return true;
  }

  if (allowedOrigin && typeof referer === 'string') {
    try {
      return new URL(referer).origin === allowedOrigin;
    } catch {
      return false;
    }
  }

  return false;
}

function requireMutationOrigin(request: Request, env: Env): Response | null {
  const path = new URL(request.url).pathname;
  const isMutation = request.method !== 'GET' && request.method !== 'OPTIONS';

  if (!isMutation) {
    return null;
  }

  if (path !== '/api/config') {
    return null;
  }

  if (hasAllowedOrigin(request, env)) {
    return null;
  }

  return jsonAuthError('ORIGIN_FORBIDDEN', 'Origin or referer is not allowed for this mutation.', 403);
}

async function loadConfig(kv: KVNamespace): Promise<RuleConfig> {
  try {
    const data = await kv.get('RULE_CONFIG', 'json');
    if (data) {
      return data as RuleConfig;
    }
  } catch (error) {
    console.error('Failed to load config from KV, using defaults', error);
  }
  return DEFAULT_CONFIG;
}

async function logActions(
  kv: KVNamespace,
  actions: Array<RuleAction | ActionLogEntry>
): Promise<{ ok: true } | { ok: false; error: ClassifiedError }> {
  try {
    const currentLogsString = await kv.get(RULE_LOGS_KEY, 'text');
    const logs = currentLogsString ? (JSON.parse(currentLogsString) as Array<RuleAction | ActionLogEntry>) : [];
    const nextLogs = [...actions, ...logs].slice(0, 1000);

    await kv.put(RULE_LOGS_KEY, JSON.stringify(nextLogs));
    return { ok: true };
  } catch (error) {
    const classifiedError: ClassifiedError = {
      category: 'config',
      code: 'KV_LOG_PERSIST_FAILED',
      message: getErrorMessage(error),
      retryable: true,
    };
    console.error('Failed to save logs to KV', error);
    return { ok: false, error: classifiedError };
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const config = await loadConfig(env.CONFIG_KV);
    if (!config.enabled) return;

    const runId = getRunId();
    const lockAcquired = await tryAcquireRunLock(env.CONFIG_KV, runId);

    if (!lockAcquired) {
      const overlapLog = createSystemLogEntry({
        runId,
        decision: 'SKIPPED_LOCK',
        why: ['Skipped overlapping run because automation lock is active.'],
        status: 'skipped',
        source: 'system',
      });

      const kvLogResult = await logActions(env.CONFIG_KV, [overlapLog]);
      const kvFailureLog =
        kvLogResult.ok
          ? null
          : createSystemLogEntry({
              runId,
              decision: 'ERROR',
              why: ['Failed to persist overlap log to KV.'],
              status: 'failed',
              source: 'system',
              error: kvLogResult.error,
            });
      const auditLogs = kvFailureLog ? [overlapLog, kvFailureLog] : [overlapLog];

      await Promise.all([
        persistAuditRun(env.AUDIT_DB, {
          runId,
          status: 'skipped_overlap',
          summary: {
            reason: 'lock_active',
            kvLogWriteStatus: kvLogResult.ok ? 'ok' : 'failed',
            kvLogError: kvLogResult.ok ? null : kvLogResult.error.code,
          },
        }),
        persistAuditLogs(env.AUDIT_DB, auditLogs),
      ]);
      return;
    }

    try {
      const rows = await evaluateCampaigns(env, config);
      const execution = await executeCampaignActions(env, rows, { runId });
      const allLogs = execution.logs.length > 0 ? execution.logs : [];
      const kvLogResult = allLogs.length > 0 ? await logActions(env.CONFIG_KV, allLogs) : { ok: true as const };
      const kvFailureLog =
        kvLogResult.ok
          ? null
          : createSystemLogEntry({
              runId,
              decision: 'ERROR',
              why: ['Failed to persist automation logs to KV.'],
              status: 'failed',
              source: 'system',
              error: kvLogResult.error,
            });
      const auditLogs = kvFailureLog ? [...allLogs, kvFailureLog] : allLogs;

      await Promise.all([
        persistAuditRun(env.AUDIT_DB, {
          runId,
          status: 'completed',
          summary: {
            evaluatedCampaigns: rows.length,
            appliedActions: execution.actions.length,
            logCount: allLogs.length,
            kvLogWriteStatus: kvLogResult.ok ? 'ok' : 'failed',
            kvLogError: kvLogResult.ok ? null : kvLogResult.error.code,
          },
        }),
        persistAuditLogs(env.AUDIT_DB, auditLogs),
        persistCampaignStates(env.AUDIT_DB, execution.campaignStateUpdates),
      ]);
    } catch (error) {
      const classifiedError: ClassifiedError = {
        category: 'global_insights',
        code: 'AUTOMATION_RUN_FAILED',
        message: getErrorMessage(error),
        retryable: true,
      };
      const failureLog = createSystemLogEntry({
        runId,
        decision: 'ERROR',
        why: ['Automation run failed before completion.'],
        status: 'failed',
        source: 'system',
        error: classifiedError,
      });

      const kvLogResult = await logActions(env.CONFIG_KV, [failureLog]);
      const auditLogs = kvLogResult.ok
        ? [failureLog]
        : [
            failureLog,
            createSystemLogEntry({
              runId,
              decision: 'ERROR',
              why: ['Failed to persist failure log to KV.'],
              status: 'failed',
              source: 'system',
              error: kvLogResult.error,
            }),
          ];

      await Promise.all([
        persistAuditRun(env.AUDIT_DB, {
          runId,
          status: 'failed',
          error: classifiedError,
          summary: {
            kvLogWriteStatus: kvLogResult.ok ? 'ok' : 'failed',
            kvLogError: kvLogResult.ok ? null : kvLogResult.error.code,
          },
        }),
        persistAuditLogs(env.AUDIT_DB, auditLogs),
      ]);
      console.error('Error executing rules:', error);
    } finally {
      ctx.waitUntil(releaseRunLock(env.CONFIG_KV));
    }
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    if (request.method === 'OPTIONS') return handleOptions(request, env);

    const authError = requireApiAuth(request, env);
    if (authError) {
      return withCors(authError, env, request);
    }

    const originError = requireMutationOrigin(request, env);
    if (originError) {
      return withCors(originError, env, request);
    }

    const router = new Router();
    router.get('/api/campaigns', handleGetCampaigns);
    router.get('/api/campaigns/:id/insights', handleGetCampaignInsights);
    router.get('/api/config', handleGetConfig);
    router.put('/api/config', handlePutConfig);
    router.get('/api/logs', handleGetLogs);
    router.get('/api/health', handleHealth);

    try {
      const response = await router.handle(request, env);
      return withCors(response, env, request);
    } catch (error) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            data: null,
            error: {
              category: 'auth',
              code: 'UNEXPECTED_FETCH_ERROR',
              message: getErrorMessage(error),
              retryable: true,
            },
            message: getErrorMessage(error),
            meta: {
              generatedAt: new Date().toISOString(),
            },
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        ),
        env,
        request
      );
    }
  }
} satisfies ExportedHandler<Env>;

