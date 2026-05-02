import {
  type ActionLogEntry,
  type ApiErrorResponse,
  type ApiResponseMeta,
  type ApiSuccessResponse,
  type ApiValidationErrorDetail,
  type BlockerReason,
  type CampaignDecisionRow,
  type CampaignInsightsSummary,
  type CampaignSnapshot,
  type CampaignStatus,
  type ClassifiedError,
  type ConfigReadModel,
  type ConfigVersionConflictPayload,
  type ConfigWriteBlockedPayload,
  type ConfigWriteSuccessPayload,
  type DataState,
  type DataWarning,
  type DecisionEvidence,
  type DecisionType,
  type Env,
  type HealthPayload,
  type NormalizedRuleConfig,
  type RuleAction,
  type RuleConfig,
  type RunHealthSummary,
  RULE_CONFIG_DEFAULTS,
} from './types';
import { fetchActiveCampaigns, fetchAdAccounts, fetchCampaignInsights } from './meta-api-client';


const RULE_CONFIG_KEY = 'RULE_CONFIG';
const RULE_LOGS_KEY = 'RULE_LOGS';

function getNamespacedKvKey(baseKey: string, accountId: string): string {
  return `${baseKey}::${accountId}`;
}

function getRequiredAccountId(req: Request): string | Response {
  const accountId = new URL(req.url).searchParams.get('accountId')?.trim();

  if (!accountId) {
    return jsonError(
      {
        category: 'validation',
        code: 'MISSING_ACCOUNT_ID',
        message: 'accountId query parameter is required.',
        retryable: false,
      },
      { status: 400 }
    );
  }

  return accountId.startsWith('act_') ? accountId.slice(4) : accountId;
}

function getConfigKey(accountId: string): string {
  return getNamespacedKvKey(RULE_CONFIG_KEY, accountId);
}

function getLogsKey(accountId: string): string {
  return getNamespacedKvKey(RULE_LOGS_KEY, accountId);
}

interface MetaActionRecord {
  action_type?: string;
  value?: string;
}

interface MetaInsightsRecord {
  spend?: string;
  actions?: MetaActionRecord[];
}

interface MetaCampaignRecord {
  id?: string;
  name?: string;
  status?: string;
}

interface ConfigWriteRequest extends RuleConfig {
  version?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isClassifiedError(value: unknown): value is ClassifiedError {
  return (
    isRecord(value) &&
    typeof value.category === 'string' &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean'
  );
}

function isDecisionEvidence(value: unknown): value is DecisionEvidence {
  return (
    isRecord(value) &&
    'spendToday' in value &&
    'purchasesToday' in value &&
    'purchases3d' in value &&
    value.purchaseMetric === 'omni_purchase' &&
    typeof value.dataState === 'string' &&
    typeof value.dryRun === 'boolean' &&
    typeof value.cooldownHours === 'number' &&
    typeof value.maxActionsPerRun === 'number' &&
    typeof value.maxActionsPerDay === 'number' &&
    typeof value.allowlisted === 'boolean' &&
    typeof value.excluded === 'boolean' &&
    typeof value.emergencyStop === 'boolean' &&
    typeof value.armingStatus === 'string'
  );
}

function isLegacyRuleAction(value: unknown): value is RuleAction {
  return (
    isRecord(value) &&
    typeof value.campaignId === 'string' &&
    typeof value.campaignName === 'string' &&
    (value.action === 'PAUSE' || value.action === 'RESUME') &&
    typeof value.reason === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.spend === 'number' &&
    typeof value.purchaseCount === 'number'
  );
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown, fallback: number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getNowIso(): string {
  return new Date().toISOString();
}

async function persistConfigVersion(
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
    .prepare('INSERT INTO config_versions (version, configJson, createdAt, createdBy) VALUES (?, ?, ?, ?)')
    .bind(input.version, input.configJson, input.createdAt, input.createdBy)
    .run();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
}

function buildMeta(meta?: Partial<ApiResponseMeta>): ApiResponseMeta {
  return {
    generatedAt: getNowIso(),
    ...meta,
  };
}

function jsonSuccess<T>(
  data: T,
  options?: {
    status?: number;
    message?: string;
    meta?: Partial<ApiResponseMeta>;
    legacy?: Record<string, unknown>;
  }
): Response {
  const payload: ApiSuccessResponse<T> & Record<string, unknown> = {
    success: true,
    data,
    error: null,
    meta: buildMeta(options?.meta),
    ...options?.legacy,
  };

  if (options?.message) {
    payload.message = options.message;
  }

  return new Response(JSON.stringify(payload), {
    status: options?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(
  error: ClassifiedError,
  options?: {
    status?: number;
    message?: string;
    data?: unknown;
    meta?: Partial<ApiResponseMeta>;
    legacy?: Record<string, unknown>;
  }
): Response {
  const payload: ApiErrorResponse<unknown> & Record<string, unknown> = {
    success: false,
    data: options?.data ?? null,
    error,
    message: options?.message ?? error.message,
    meta: buildMeta(options?.meta),
    ...options?.legacy,
  };

  return new Response(JSON.stringify(payload), {
    status: options?.status ?? 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildValidationError(details: ApiValidationErrorDetail[]): ClassifiedError {
  return {
    category: 'validation',
    code: 'INVALID_CONFIG',
    message: 'Config validation failed',
    retryable: false,
    details,
  };
}

function buildArmingBlockers(config: NormalizedRuleConfig): BlockerReason[] {
  const blockers: BlockerReason[] = [];

  if (config.emergencyStop) {
    blockers.push({
      code: 'EMERGENCY_STOP',
      message: 'Emergency stop is enabled.',
      blocking: true,
    });
  }

  if (!config.arming.adAccountConfirmed) {
    blockers.push({
      code: 'AD_ACCOUNT_CONFIRMATION_REQUIRED',
      message: 'Ad account confirmation is required before live mode.',
      blocking: true,
    });
  }

  if (config.allowlistCampaignIds.length === 0) {
    blockers.push({
      code: 'ALLOWLIST_REQUIRED',
      message: 'At least one allowlisted campaign is required before live mode.',
      blocking: true,
    });
  }

  if (config.maxActionsPerRun <= 0 || config.maxActionsPerDay <= 0) {
    blockers.push({
      code: 'ACTION_CAPS_REQUIRED',
      message: 'Positive action caps are required before live mode.',
      blocking: true,
    });
  }

  if (!config.arming.recentDryRunReviewedAt) {
    blockers.push({
      code: 'RECENT_DRY_RUN_REVIEW_REQUIRED',
      message: 'A reviewed recent dry-run is required before live mode.',
      blocking: true,
    });
  }

  return blockers;
}

function normalizeConfig(input: unknown): ConfigReadModel {
  const record = isRecord(input) ? input : {};
  const armingRecord = isRecord(record.arming) ? record.arming : {};

  const config: ConfigReadModel = {
    enabled: asBoolean(record.enabled, RULE_CONFIG_DEFAULTS.enabled),
    dryRun: asBoolean(record.dryRun, RULE_CONFIG_DEFAULTS.dryRun),
    pauseThreshold: asNumber(record.pauseThreshold, RULE_CONFIG_DEFAULTS.pauseThreshold),
    pauseThreshold2: asNullableNumber(record.pauseThreshold2, RULE_CONFIG_DEFAULTS.pauseThreshold2),
    resumeThreshold: asNumber(record.resumeThreshold, RULE_CONFIG_DEFAULTS.resumeThreshold),
    cooldownHours: asNumber(record.cooldownHours, RULE_CONFIG_DEFAULTS.cooldownHours),
    maxActionsPerRun: asNumber(record.maxActionsPerRun, RULE_CONFIG_DEFAULTS.maxActionsPerRun),
    maxActionsPerDay: asNumber(record.maxActionsPerDay, RULE_CONFIG_DEFAULTS.maxActionsPerDay),
    allowlistCampaignIds: isStringArray(record.allowlistCampaignIds)
      ? [...record.allowlistCampaignIds]
      : [...RULE_CONFIG_DEFAULTS.allowlistCampaignIds],
    excludeCampaignIds: isStringArray(record.excludeCampaignIds)
      ? [...record.excludeCampaignIds]
      : [...RULE_CONFIG_DEFAULTS.excludeCampaignIds],
    emergencyStop: asBoolean(record.emergencyStop, RULE_CONFIG_DEFAULTS.emergencyStop),
    arming: {
      status:
        armingRecord.status === 'eligible' ||
        armingRecord.status === 'armed' ||
        armingRecord.status === 'blocked'
          ? armingRecord.status
          : RULE_CONFIG_DEFAULTS.arming.status,
      adAccountConfirmed: asBoolean(
        armingRecord.adAccountConfirmed,
        RULE_CONFIG_DEFAULTS.arming.adAccountConfirmed
      ),
      recentDryRunRunId: asStringOrNull(armingRecord.recentDryRunRunId),
      recentDryRunReviewedAt: asStringOrNull(armingRecord.recentDryRunReviewedAt),
      reviewedBy: asStringOrNull(armingRecord.reviewedBy),
      reliabilityScore:
        typeof armingRecord.reliabilityScore === 'number' && Number.isFinite(armingRecord.reliabilityScore)
          ? armingRecord.reliabilityScore
          : RULE_CONFIG_DEFAULTS.arming.reliabilityScore,
      evidenceWindowDays: asNumber(
        armingRecord.evidenceWindowDays,
        RULE_CONFIG_DEFAULTS.arming.evidenceWindowDays
      ),
    },
    version:
      typeof record.version === 'number' && Number.isFinite(record.version) ? record.version : null,
    updatedAt: asStringOrNull(record.updatedAt),
    updatedBy: asStringOrNull(record.updatedBy),
    liveArmingEligible: false,
    armingBlockers: [],
  };

  const armingBlockers = buildArmingBlockers(config);

  return {
    ...config,
    armingBlockers,
    liveArmingEligible: armingBlockers.length === 0,
  };
}

function validateConfigInput(input: unknown): ApiValidationErrorDetail[] {
  if (!isRecord(input)) {
    return [
      {
        field: 'body',
        code: 'invalid_type',
        message: 'Config payload must be an object.',
      },
    ];
  }

  const details: ApiValidationErrorDetail[] = [];

  const pushIfInvalidNumber = (field: string, value: unknown, allowNull = false) => {
    if (allowNull && value === null) {
      return;
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      details.push({
        field,
        code: 'invalid_number',
        message: `${field} must be a finite number greater than or equal to 0.`,
      });
    }
  };

  if (typeof input.enabled !== 'boolean') {
    details.push({
      field: 'enabled',
      code: 'invalid_type',
      message: 'enabled must be a boolean.',
    });
  }

  if (typeof input.dryRun !== 'boolean') {
    details.push({
      field: 'dryRun',
      code: 'invalid_type',
      message: 'dryRun must be a boolean.',
    });
  }

  if (typeof input.emergencyStop !== 'boolean') {
    details.push({
      field: 'emergencyStop',
      code: 'invalid_type',
      message: 'emergencyStop must be a boolean.',
    });
  }

  pushIfInvalidNumber('pauseThreshold', input.pauseThreshold);
  pushIfInvalidNumber('pauseThreshold2', input.pauseThreshold2, true);
  pushIfInvalidNumber('resumeThreshold', input.resumeThreshold);

  if (
    typeof input.cooldownHours !== 'number' ||
    !Number.isFinite(input.cooldownHours) ||
    input.cooldownHours <= 0
  ) {
    details.push({
      field: 'cooldownHours',
      code: 'invalid_number',
      message: 'cooldownHours must be a finite number greater than 0.',
    });
  }

  if (
    typeof input.maxActionsPerRun !== 'number' ||
    !Number.isInteger(input.maxActionsPerRun) ||
    input.maxActionsPerRun < 0
  ) {
    details.push({
      field: 'maxActionsPerRun',
      code: 'invalid_number',
      message: 'maxActionsPerRun must be an integer greater than or equal to 0.',
    });
  }

  if (
    typeof input.maxActionsPerDay !== 'number' ||
    !Number.isInteger(input.maxActionsPerDay) ||
    input.maxActionsPerDay < 0
  ) {
    details.push({
      field: 'maxActionsPerDay',
      code: 'invalid_number',
      message: 'maxActionsPerDay must be an integer greater than or equal to 0.',
    });
  }

  if (!isStringArray(input.allowlistCampaignIds)) {
    details.push({
      field: 'allowlistCampaignIds',
      code: 'invalid_type',
      message: 'allowlistCampaignIds must be an array of campaign ids.',
    });
  }

  if (!isStringArray(input.excludeCampaignIds)) {
    details.push({
      field: 'excludeCampaignIds',
      code: 'invalid_type',
      message: 'excludeCampaignIds must be an array of campaign ids.',
    });
  }

  if (!isRecord(input.arming)) {
    details.push({
      field: 'arming',
      code: 'invalid_type',
      message: 'arming must be an object.',
    });
  } else {
    if (typeof input.arming.adAccountConfirmed !== 'boolean') {
      details.push({
        field: 'arming.adAccountConfirmed',
        code: 'invalid_type',
        message: 'arming.adAccountConfirmed must be a boolean.',
      });
    }

    if (
      input.arming.reliabilityScore !== null &&
      input.arming.reliabilityScore !== undefined &&
      (typeof input.arming.reliabilityScore !== 'number' || !Number.isFinite(input.arming.reliabilityScore))
    ) {
      details.push({
        field: 'arming.reliabilityScore',
        code: 'invalid_number',
        message: 'arming.reliabilityScore must be a finite number or null.',
      });
    }

    if (
      typeof input.arming.evidenceWindowDays !== 'number' ||
      !Number.isInteger(input.arming.evidenceWindowDays) ||
      input.arming.evidenceWindowDays <= 0
    ) {
      details.push({
        field: 'arming.evidenceWindowDays',
        code: 'invalid_number',
        message: 'arming.evidenceWindowDays must be a positive integer.',
      });
    }
  }

  return details;
}

function normalizeCampaignStatus(value: unknown): CampaignStatus {
  return value === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
}

function extractInsightsSummary(raw: unknown): {
  insights: CampaignInsightsSummary;
  warnings: DataWarning[];
  purchases: number | null;
} {
  const record = isRecord(raw) ? (raw as MetaInsightsRecord) : {};
  const spend = typeof record.spend === 'string' ? Number.parseFloat(record.spend) : 0;
  const actions = Array.isArray(record.actions) ? record.actions : [];
  const omniPurchase = actions.find((action) => action.action_type === 'omni_purchase');
  const hasPurchaseMetric = Boolean(omniPurchase);
  const purchases =
    hasPurchaseMetric && typeof omniPurchase?.value === 'string'
      ? Number.parseInt(omniPurchase.value, 10)
      : 0;
  const warnings: DataWarning[] = [];
  const dataState: DataState = hasPurchaseMetric ? 'complete' : 'missing';

  if (!hasPurchaseMetric) {
    warnings.push({
      code: 'MISSING_OMNI_PURCHASE',
      message: 'Meta insights payload does not include omni_purchase.',
      severity: 'warning',
    });
  }

  return {
    insights: {
      spend: Number.isFinite(spend) ? spend : 0,
      purchases,
      purchaseMetric: 'omni_purchase',
      hasPurchaseMetric,
      dataState,
    },
    warnings,
    purchases: hasPurchaseMetric ? purchases : null,
  };
}

function createEvidence(config: ConfigReadModel, campaignId: string, insights: CampaignInsightsSummary): DecisionEvidence {
  return {
    spendToday: insights.spend,
    purchasesToday: insights.hasPurchaseMetric ? insights.purchases : null,
    purchases3d: null,
    purchaseMetric: 'omni_purchase',
    dataState: insights.dataState,
    dryRun: config.dryRun,
    cooldownHours: config.cooldownHours,
    maxActionsPerRun: config.maxActionsPerRun,
    maxActionsPerDay: config.maxActionsPerDay,
    allowlisted: config.allowlistCampaignIds.includes(campaignId),
    excluded: config.excludeCampaignIds.includes(campaignId),
    emergencyStop: config.emergencyStop,
    armingStatus: config.arming.status,
    reliabilityScore: config.arming.reliabilityScore,
  };
}

function determineDecision(
  campaign: MetaCampaignRecord,
  config: ConfigReadModel,
  insights: CampaignInsightsSummary,
  warnings: DataWarning[]
): {
  decision: DecisionType;
  why: string[];
  blockers: BlockerReason[];
} {
  if (!insights.hasPurchaseMetric) {
    return {
      decision: 'UNKNOWN_DATA',
      why: ['Cannot make trusted decision without omni_purchase.'],
      blockers: [
        {
          code: 'MISSING_OMNI_PURCHASE',
          message: 'Missing omni_purchase blocks trusted automation decisions.',
          blocking: true,
        },
      ],
    };
  }

  const status = normalizeCampaignStatus(campaign.status);
  const spend = insights.spend;
  const purchases = insights.purchases;
  const liveBlockers = buildArmingBlockers(config);

  if (config.excludeCampaignIds.includes(campaign.id ?? '')) {
    return {
      decision: 'SKIPPED_CAP',
      why: ['Campaign is excluded from automation.'],
      blockers: [
        {
          code: 'CAMPAIGN_EXCLUDED',
          message: 'Campaign is in exclusion list.',
          blocking: true,
        },
      ],
    };
  }

  if (!config.dryRun && !config.allowlistCampaignIds.includes(campaign.id ?? '')) {
    return {
      decision: 'BLOCKED_NOT_ARMED',
      why: ['Campaign is not allowlisted for live automation.'],
      blockers: [
        {
          code: 'CAMPAIGN_NOT_ALLOWED',
          message: 'Campaign is not present in allowlist.',
          blocking: true,
        },
      ],
    };
  }

  if (status === 'ACTIVE' && spend > config.pauseThreshold && purchases === 0) {
    if (config.dryRun) {
      return {
        decision: 'WOULD_PAUSE',
        why: [`Spend ${spend} is above pause threshold ${config.pauseThreshold} with 0 omni_purchase.`],
        blockers: liveBlockers,
      };
    }

    if (liveBlockers.length > 0) {
      return {
        decision: 'BLOCKED_NOT_ARMED',
        why: ['Live pause is blocked until arming requirements pass.'],
        blockers: liveBlockers,
      };
    }

    return {
      decision: 'PAUSE',
      why: [`Spend ${spend} is above pause threshold ${config.pauseThreshold} with 0 omni_purchase.`],
      blockers: [],
    };
  }

  if (
    status === 'ACTIVE' &&
    config.pauseThreshold2 !== null &&
    spend > config.pauseThreshold2 &&
    purchases < 2
  ) {
    if (config.dryRun) {
      return {
        decision: 'WOULD_PAUSE',
        why: [`Spend ${spend} is above pause threshold 2 ${config.pauseThreshold2} with fewer than 2 omni_purchase.`],
        blockers: liveBlockers,
      };
    }

    if (liveBlockers.length > 0) {
      return {
        decision: 'BLOCKED_NOT_ARMED',
        why: ['Live pause is blocked until arming requirements pass.'],
        blockers: liveBlockers,
      };
    }

    return {
      decision: 'PAUSE',
      why: [`Spend ${spend} is above pause threshold 2 ${config.pauseThreshold2} with fewer than 2 omni_purchase.`],
      blockers: [],
    };
  }

  if (status === 'PAUSED' && spend < config.resumeThreshold && purchases > 0) {
    if (config.dryRun) {
      return {
        decision: 'WOULD_RESUME',
        why: [`Spend ${spend} is below resume threshold ${config.resumeThreshold} with ${purchases} omni_purchase.`],
        blockers: liveBlockers,
      };
    }

    if (liveBlockers.length > 0) {
      return {
        decision: 'BLOCKED_NOT_ARMED',
        why: ['Live resume is blocked until arming requirements pass.'],
        blockers: liveBlockers,
      };
    }

    return {
      decision: 'RESUME',
      why: [`Spend ${spend} is below resume threshold ${config.resumeThreshold} with ${purchases} omni_purchase.`],
      blockers: [],
    };
  }

  return {
    decision: warnings.length > 0 ? 'UNKNOWN_DATA' : 'MONITORING',
    why: warnings.length > 0 ? ['Monitoring blocked by incomplete decision evidence.'] : ['Campaign is being monitored.'],
    blockers: [],
  };
}

function createCampaignSnapshot(
  campaign: MetaCampaignRecord,
  insights: CampaignInsightsSummary,
  purchases: number | null
): CampaignSnapshot {
  return {
    id: typeof campaign.id === 'string' ? campaign.id : '',
    name: typeof campaign.name === 'string' ? campaign.name : 'Unknown campaign',
    status: normalizeCampaignStatus(campaign.status),
    spendToday: insights.spend,
    purchasesToday: purchases,
    purchases3d: null,
    purchaseMetric: 'omni_purchase',
    hasPurchaseMetric: insights.hasPurchaseMetric,
    dataState: insights.dataState,
  };
}

function mapLegacyLog(log: RuleAction, index: number): ActionLogEntry {
  const decision = log.action === 'PAUSE' ? 'PAUSE' : 'RESUME';

  return {
    id: `${log.timestamp}-${log.campaignId}-${index}`,
    runId: null,
    campaignId: log.campaignId,
    campaignName: log.campaignName,
    decision,
    source: 'live',
    status: 'applied',
    occurredAt: log.timestamp,
    why: [log.reason],
    blockers: [],
    warnings: [],
    error: null,
    evidence: {
      spendToday: log.spend,
      purchasesToday: log.purchaseCount,
      purchases3d: null,
      purchaseMetric: 'omni_purchase',
      dataState: 'complete',
      dryRun: false,
      cooldownHours: RULE_CONFIG_DEFAULTS.cooldownHours,
      maxActionsPerRun: RULE_CONFIG_DEFAULTS.maxActionsPerRun,
      maxActionsPerDay: RULE_CONFIG_DEFAULTS.maxActionsPerDay,
      allowlisted: true,
      excluded: false,
      emergencyStop: false,
      armingStatus: 'armed',
      reliabilityScore: null,
    },
  };
}

function mapStoredLog(log: unknown, index: number): ActionLogEntry | null {
  if (!isRecord(log)) {
    return null;
  }

  if ('decision' in log && 'occurredAt' in log) {
    return {
      id: typeof log.id === 'string' ? log.id : `timeline-${index}`,
      runId: typeof log.runId === 'string' ? log.runId : null,
      campaignId: typeof log.campaignId === 'string' ? log.campaignId : null,
      campaignName: typeof log.campaignName === 'string' ? log.campaignName : null,
      decision:
        typeof log.decision === 'string'
          ? (log.decision as ActionLogEntry['decision'])
          : 'ERROR',
      source:
        log.source === 'dry_run' || log.source === 'system' ? log.source : 'live',
      status:
        log.status === 'skipped' || log.status === 'failed' ? log.status : 'applied',
      occurredAt: typeof log.occurredAt === 'string' ? log.occurredAt : getNowIso(),
      why: Array.isArray(log.why) ? log.why.filter((item): item is string => typeof item === 'string') : [],
      blockers: Array.isArray(log.blockers) ? (log.blockers as BlockerReason[]) : [],
      warnings: Array.isArray(log.warnings) ? (log.warnings as DataWarning[]) : [],
      error: isClassifiedError(log.error) ? log.error : null,
      evidence: isDecisionEvidence(log.evidence) ? log.evidence : null,
    };
  }

  if (isLegacyRuleAction(log)) {
    return mapLegacyLog(log, index);
  }

  return null;
}

function createDefaultRunHealth(): RunHealthSummary {
  return {
    currentStatus: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastFailedAt: null,
    nextScheduledAt: null,
    activeLock: false,
    activeRunId: null,
  };
}

export async function handleGetAdAccounts(_req: Request, env: Env): Promise<Response> {
  try {
    const accounts = await fetchAdAccounts(env);

    return jsonSuccess(accounts, {
      meta: { total: accounts.length },
    });
  } catch (error: unknown) {
    return jsonError(
      {
        category: 'auth',
        code: 'AD_ACCOUNTS_FETCH_FAILED',
        message: getErrorMessage(error),
        retryable: true,
      },
      {
        status: 502,
        meta: { total: 0 },
      }
    );
  }
}

export async function handleGetCampaigns(req: Request, env: Env): Promise<Response> {
  const accountId = getRequiredAccountId(req);
  if (typeof accountId !== 'string') {
    return accountId;
  }

  const configRaw = await env.CONFIG_KV.get(getConfigKey(accountId), 'json');
  const config = normalizeConfig(configRaw);

  try {
    const campaignsRaw = (await fetchActiveCampaigns(env, accountId)) as unknown;
    const campaigns = Array.isArray(campaignsRaw) ? (campaignsRaw as MetaCampaignRecord[]) : [];

    const rows = await Promise.all(
      campaigns.map(async (campaign): Promise<CampaignDecisionRow> => {
        try {
          const insightsRaw = await fetchCampaignInsights(env, typeof campaign.id === 'string' ? campaign.id : '');
          const { insights, warnings, purchases } = extractInsightsSummary(insightsRaw);
          const decisionResult = determineDecision(campaign, config, insights, warnings);
          const evidence = createEvidence(config, typeof campaign.id === 'string' ? campaign.id : '', insights);

          return {
            id: typeof campaign.id === 'string' ? campaign.id : '',
            name: typeof campaign.name === 'string' ? campaign.name : 'Unknown campaign',
            status: normalizeCampaignStatus(campaign.status),
            decision: decisionResult.decision,
            why: decisionResult.why,
            evidence,
            blockers: decisionResult.blockers,
            campaignSnapshot: createCampaignSnapshot(campaign, insights, purchases),
            warnings,
            error: null,
            insights,
          };
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          const classifiedError: ClassifiedError = {
            category: 'global_insights',
            code: 'INSIGHTS_FETCH_FAILED',
            message,
            retryable: true,
          };

          return {
            id: typeof campaign.id === 'string' ? campaign.id : '',
            name: typeof campaign.name === 'string' ? campaign.name : 'Unknown campaign',
            status: normalizeCampaignStatus(campaign.status),
            decision: 'ERROR',
            why: ['Insights fetch failed for this campaign.'],
            evidence: {
              spendToday: null,
              purchasesToday: null,
              purchases3d: null,
              purchaseMetric: 'omni_purchase',
              dataState: 'error',
              dryRun: config.dryRun,
              cooldownHours: config.cooldownHours,
              maxActionsPerRun: config.maxActionsPerRun,
              maxActionsPerDay: config.maxActionsPerDay,
              allowlisted: config.allowlistCampaignIds.includes(typeof campaign.id === 'string' ? campaign.id : ''),
              excluded: config.excludeCampaignIds.includes(typeof campaign.id === 'string' ? campaign.id : ''),
              emergencyStop: config.emergencyStop,
              armingStatus: config.arming.status,
              reliabilityScore: config.arming.reliabilityScore,
            },
            blockers: [],
            campaignSnapshot: {
              id: typeof campaign.id === 'string' ? campaign.id : '',
              name: typeof campaign.name === 'string' ? campaign.name : 'Unknown campaign',
              status: normalizeCampaignStatus(campaign.status),
              spendToday: null,
              purchasesToday: null,
              purchases3d: null,
              purchaseMetric: 'omni_purchase',
              hasPurchaseMetric: false,
              dataState: 'error',
            },
            warnings: [],
            error: classifiedError,
            insights: null,
          };
        }
      })
    );

    return jsonSuccess(rows, {
      meta: { total: rows.length, run: createDefaultRunHealth() },
    });
  } catch (error: unknown) {
    return jsonError(
      {
        category: 'global_insights',
        code: 'CAMPAIGNS_FETCH_FAILED',
        message: getErrorMessage(error),
        retryable: true,
      },
      {
        status: 502,
        meta: { total: 0, run: createDefaultRunHealth() },
      }
    );
  }
}

export async function handleGetCampaignInsights(
  _req: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  const { id } = params;

  if (!id) {
    return jsonError(
      {
        category: 'validation',
        code: 'MISSING_CAMPAIGN_ID',
        message: 'Missing campaign id',
        retryable: false,
      },
      { status: 400 }
    );
  }

  try {
    const insights = await fetchCampaignInsights(env, id);
    return jsonSuccess(insights);
  } catch (error: unknown) {
    return jsonError(
      {
        category: 'global_insights',
        code: 'INSIGHTS_FETCH_FAILED',
        message: getErrorMessage(error),
        retryable: true,
      },
      { status: 502 }
    );
  }
}

export async function handleGetConfig(req: Request, env: Env): Promise<Response> {
  const accountId = getRequiredAccountId(req);
  if (typeof accountId !== 'string') {
    return accountId;
  }

  const configRaw = await env.CONFIG_KV.get(getConfigKey(accountId), 'json');
  const config = normalizeConfig(configRaw);

  return jsonSuccess(config, {
    meta: { version: config.version },
  });
}

export async function handlePutConfig(req: Request, env: Env): Promise<Response> {
  const accountId = getRequiredAccountId(req);
  if (typeof accountId !== 'string') {
    return accountId;
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return jsonError(
      {
        category: 'validation',
        code: 'INVALID_JSON',
        message: 'Invalid JSON',
        retryable: false,
      },
      { status: 400 }
    );
  }

  const validationErrors = validateConfigInput(body);
  if (validationErrors.length > 0) {
    return jsonError(buildValidationError(validationErrors), {
      status: 400,
    });
  }

  const currentConfig = normalizeConfig(await env.CONFIG_KV.get(getConfigKey(accountId), 'json'));
  const payload = body as ConfigWriteRequest;
  const submittedVersion = typeof payload.version === 'number' ? payload.version : null;

  if (currentConfig.version !== submittedVersion) {
    const conflictPayload: ConfigVersionConflictPayload = {
      status: 'version_conflict',
      currentVersion: currentConfig.version,
      submittedVersion,
      latestConfig: currentConfig,
    };

    return jsonError(
      {
        category: 'config',
        code: 'CONFIG_VERSION_CONFLICT',
        message: 'Config version conflict',
        retryable: true,
      },
      {
        status: 409,
        data: conflictPayload,
        meta: { version: currentConfig.version },
      }
    );
  }

  const nextVersion = (currentConfig.version ?? 0) + 1;
  const nextConfig = normalizeConfig({
    ...payload,
    version: nextVersion,
    updatedAt: getNowIso(),
    updatedBy: 'dashboard',
  });

  if (!nextConfig.dryRun && nextConfig.armingBlockers.length > 0) {
    const blockedPayload: ConfigWriteBlockedPayload = {
      status: 'blocked_live_gate',
      config: nextConfig,
      blockers: nextConfig.armingBlockers,
    };

    return jsonError(
      {
        category: 'config',
        code: 'LIVE_ARMING_BLOCKED',
        message: 'Live mode is blocked until arming requirements pass',
        retryable: false,
      },
      {
        status: 409,
        data: blockedPayload,
        meta: { version: currentConfig.version },
      }
    );
  }

  await env.CONFIG_KV.put(getConfigKey(accountId), JSON.stringify(nextConfig));
  await persistConfigVersion(env.AUDIT_DB, {
    version: nextVersion,
    configJson: JSON.stringify(nextConfig),
    createdAt: nextConfig.updatedAt ?? getNowIso(),
    createdBy: nextConfig.updatedBy,
  });

  const successPayload: ConfigWriteSuccessPayload = {
    status: 'saved',
    config: nextConfig,
  };

  return jsonSuccess(successPayload, {
    message: 'Config updated successfully',
    meta: { version: nextConfig.version },
  });
}

export async function handleGetLogs(req: Request, env: Env): Promise<Response> {
  const accountId = getRequiredAccountId(req);
  if (typeof accountId !== 'string') {
    return accountId;
  }

  const logsRaw = await env.CONFIG_KV.get(getLogsKey(accountId), 'json');
  const logs = Array.isArray(logsRaw)
    ? logsRaw
        .map((log, index) => mapStoredLog(log, index))
        .filter((log): log is ActionLogEntry => log !== null)
    : [];

  return jsonSuccess(logs, {
    meta: { total: logs.length, run: createDefaultRunHealth() },
  });
}

export async function handleHealth(_req: Request, env: Env): Promise<Response> {
  try {
    const url = 'https://graph.facebook.com/v21.0/me';
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      },
    });
    const data = (await response.json()) as unknown;

    if (isRecord(data) && isRecord(data.error) && typeof data.error.message === 'string') {
      const payload: HealthPayload = {
        status: 'error',
        message: data.error.message,
        checkedAt: getNowIso(),
        metaAccountId: env.META_ACCOUNT_ID,
      };

      return jsonError(
        {
          category: 'auth',
          code: 'META_TOKEN_INVALID',
          message: data.error.message,
          retryable: false,
        },
        {
          status: 401,
          data: payload,
          legacy: {
            status: payload.status,
            checkedAt: payload.checkedAt,
          },
        }
      );
    }

    const payload: HealthPayload = {
      status: 'ok',
      message: 'System healthy and token valid',
      checkedAt: getNowIso(),
      metaAccountId: env.META_ACCOUNT_ID,
    };

    return jsonSuccess(payload, {
      legacy: {
        status: payload.status,
        checkedAt: payload.checkedAt,
      },
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const payload: HealthPayload = {
      status: 'error',
      message,
      checkedAt: getNowIso(),
      metaAccountId: env.META_ACCOUNT_ID,
    };

    return jsonError(
      {
        category: 'auth',
        code: 'HEALTH_CHECK_FAILED',
        message,
        retryable: true,
      },
      {
        status: 500,
        data: payload,
        legacy: {
          status: payload.status,
          checkedAt: payload.checkedAt,
        },
      }
    );
  }
}
