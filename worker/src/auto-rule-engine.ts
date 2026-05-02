import {
  type ActionLogEntry,
  type BlockerReason,
  type CampaignDecisionRow,
  type CampaignInsightsSummary,
  type CampaignSnapshot,
  type ClassifiedError,
  type DataState,
  type DataWarning,
  type DecisionEvidence,
  type DecisionType,
  type Env,
  type NormalizedRuleConfig,
  type RuleAction,
  type RuleConfig,
  RULE_CONFIG_DEFAULTS,
} from './types';
import {
  extractPurchaseCount,
  fetchAccountCampaignInsights,
  fetchActiveCampaigns,
  pauseCampaign,
  resumeCampaign,
  type MetaAccountInsightsRow,
  type MetaActionRecord,
  type MetaCampaignRecord,
} from './meta-api-client';

interface ExecutionResult {
  actions: RuleAction[];
  logs: ActionLogEntry[];
  campaignStateUpdates: Array<{
    campaignId: string;
    lastDecision: DecisionType;
    lastAction: 'PAUSE' | 'RESUME' | null;
    lastActionAt: string | null;
    lastRunId: string | null;
    pausedByTool: boolean;
  }>;
}

interface DecisionInputInsights {
  summary: CampaignInsightsSummary;
  warnings: DataWarning[];
  purchasesToday: number | null;
  purchases3d: number | null;
  hasPurchaseMetric3d: boolean;
}

function getNowIso(): string {
  return new Date().toISOString();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
}

function normalizeRuleConfig(config: RuleConfig): NormalizedRuleConfig {
  return {
    ...RULE_CONFIG_DEFAULTS,
    ...config,
    pauseThreshold2: config.pauseThreshold2 ?? RULE_CONFIG_DEFAULTS.pauseThreshold2,
    cooldownHours: config.cooldownHours ?? RULE_CONFIG_DEFAULTS.cooldownHours,
    maxActionsPerRun: config.maxActionsPerRun ?? RULE_CONFIG_DEFAULTS.maxActionsPerRun,
    maxActionsPerDay: config.maxActionsPerDay ?? RULE_CONFIG_DEFAULTS.maxActionsPerDay,
    allowlistCampaignIds: [...(config.allowlistCampaignIds ?? RULE_CONFIG_DEFAULTS.allowlistCampaignIds)],
    excludeCampaignIds: [...(config.excludeCampaignIds ?? RULE_CONFIG_DEFAULTS.excludeCampaignIds)],
    emergencyStop: config.emergencyStop ?? RULE_CONFIG_DEFAULTS.emergencyStop,
    dryRun: config.dryRun ?? RULE_CONFIG_DEFAULTS.dryRun,
    arming: {
      ...RULE_CONFIG_DEFAULTS.arming,
      ...(config.arming ?? {}),
    },
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

function createEvidence(
  config: NormalizedRuleConfig,
  campaignId: string,
  insights: CampaignInsightsSummary,
  purchases3d: number | null
): DecisionEvidence {
  return {
    spendToday: insights.spend,
    purchasesToday: insights.hasPurchaseMetric ? insights.purchases : null,
    purchases3d,
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

function createCampaignSnapshot(
  campaign: MetaCampaignRecord,
  insights: CampaignInsightsSummary,
  purchasesToday: number | null,
  purchases3d: number | null
): CampaignSnapshot {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    spendToday: insights.spend,
    purchasesToday,
    purchases3d,
    purchaseMetric: 'omni_purchase',
    hasPurchaseMetric: insights.hasPurchaseMetric,
    dataState: insights.dataState,
  };
}

function createInsightsSummary(raw: {
  spend?: string;
  actions?: MetaActionRecord[];
}): {
  insights: CampaignInsightsSummary;
  warnings: DataWarning[];
  purchasesToday: number | null;
} {
  const spend = Number.parseFloat(raw.spend ?? '0');
  const purchases = extractPurchaseCount(raw.actions);
  const hasPurchaseMetric = Array.isArray(raw.actions)
    ? raw.actions.some((action) => action.action_type === 'omni_purchase')
    : false;
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
    purchasesToday: hasPurchaseMetric ? purchases : null,
  };
}

function createThreeDayEvidence(raw: {
  actions?: MetaActionRecord[];
}): {
  purchases3d: number | null;
  hasPurchaseMetric3d: boolean;
} {
  const purchases = extractPurchaseCount(raw.actions);
  const hasPurchaseMetric3d = Array.isArray(raw.actions)
    ? raw.actions.some((action) => action.action_type === 'omni_purchase')
    : false;

  return {
    purchases3d: hasPurchaseMetric3d ? purchases : null,
    hasPurchaseMetric3d,
  };
}

function determineDecision(
  campaign: MetaCampaignRecord,
  config: NormalizedRuleConfig,
  input: DecisionInputInsights
): {
  decision: DecisionType;
  why: string[];
  blockers: BlockerReason[];
} {
  if (!input.summary.hasPurchaseMetric || !input.hasPurchaseMetric3d || input.purchases3d === null) {
    return {
      decision: 'UNKNOWN_DATA',
      why: ['Cannot make trusted decision without omni_purchase today and 3-day evidence.'],
      blockers: [
        {
          code: 'MISSING_OMNI_PURCHASE',
          message: 'Missing omni_purchase blocks trusted automation decisions.',
          blocking: true,
        },
      ],
    };
  }

  const liveBlockers = buildArmingBlockers(config);

  if (config.excludeCampaignIds.includes(campaign.id)) {
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

  if (!config.dryRun && !config.allowlistCampaignIds.includes(campaign.id)) {
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

  if (
    campaign.status === 'ACTIVE' &&
    input.summary.spend > config.pauseThreshold &&
    input.summary.purchases === 0 &&
    input.purchases3d === 0
  ) {
    if (config.dryRun) {
      return {
        decision: 'WOULD_PAUSE',
        why: [
          `Spend ${input.summary.spend} is above pause threshold ${config.pauseThreshold} with 0 omni_purchase today and 0 omni_purchase over 3 days.`,
        ],
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
      why: [
        `Spend ${input.summary.spend} is above pause threshold ${config.pauseThreshold} with 0 omni_purchase today and 0 omni_purchase over 3 days.`,
      ],
      blockers: [],
    };
  }

  if (
    campaign.status === 'ACTIVE' &&
    config.pauseThreshold2 !== null &&
    input.summary.spend > config.pauseThreshold2 &&
    input.summary.purchases < 2 &&
    input.purchases3d < 2
  ) {
    if (config.dryRun) {
      return {
        decision: 'WOULD_PAUSE',
        why: [
          `Spend ${input.summary.spend} is above pause threshold 2 ${config.pauseThreshold2} with fewer than 2 omni_purchase today and over 3 days.`,
        ],
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
      why: [
        `Spend ${input.summary.spend} is above pause threshold 2 ${config.pauseThreshold2} with fewer than 2 omni_purchase today and over 3 days.`,
      ],
      blockers: [],
    };
  }

  if (
    campaign.status === 'PAUSED' &&
    input.summary.spend < config.resumeThreshold &&
    input.summary.purchases > 0
  ) {
    if (config.dryRun) {
      return {
        decision: 'WOULD_RESUME',
        why: [
          `Spend ${input.summary.spend} is below resume threshold ${config.resumeThreshold} with ${input.summary.purchases} omni_purchase.`,
        ],
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
      why: [
        `Spend ${input.summary.spend} is below resume threshold ${config.resumeThreshold} with ${input.summary.purchases} omni_purchase.`,
      ],
      blockers: [],
    };
  }

  return {
    decision: input.warnings.length > 0 ? 'UNKNOWN_DATA' : 'MONITORING',
    why:
      input.warnings.length > 0
        ? ['Monitoring blocked by incomplete decision evidence.']
        : ['Campaign is being monitored.'],
    blockers: [],
  };
}

function classifyMutationError(error: unknown): ClassifiedError {
  return {
    category: 'campaign_mutation',
    code: 'META_MUTATION_FAILED',
    message: getErrorMessage(error),
    retryable: true,
  };
}

function createLogEntry(
  row: CampaignDecisionRow,
  status: ActionLogEntry['status'],
  source: ActionLogEntry['source'],
  runId: string | null,
  error: ClassifiedError | null = row.error
): ActionLogEntry {
  return {
    id: `${runId ?? 'local'}-${row.id || 'run'}-${row.decision}-${crypto.randomUUID()}`,
    runId,
    campaignId: row.id || null,
    campaignName: row.name || null,
    decision: row.decision,
    source,
    status,
    occurredAt: getNowIso(),
    why: [...row.why],
    blockers: [...row.blockers],
    warnings: [...row.warnings],
    error,
    evidence: row.evidence,
  };
}

function createRuleAction(row: CampaignDecisionRow): RuleAction {
  return {
    campaignId: row.id,
    campaignName: row.name,
    action: row.decision === 'PAUSE' ? 'PAUSE' : 'RESUME',
    reason: row.why.join(' '),
    timestamp: getNowIso(),
    spend: row.evidence.spendToday ?? 0,
    purchaseCount: row.evidence.purchasesToday ?? 0,
  };
}

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getTrailingDateRange(days: number): { since: string; until: string } {
  const todayUtc = new Date();
  const end = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  return {
    since: toUtcDateString(start),
    until: toUtcDateString(end),
  };
}

function buildInsightsMap(rows: MetaAccountInsightsRow[], label: string): Map<string, MetaAccountInsightsRow> {
  const map = new Map<string, MetaAccountInsightsRow>();

  for (const row of rows) {
    const campaignId = typeof row.campaign_id === 'string' ? row.campaign_id : '';
    if (!campaignId) {
      throw new Error(`${label}_ROW_MISSING_CAMPAIGN_ID`);
    }

    map.set(campaignId, row);
  }

  return map;
}

function createProvenanceBlockedRow(row: CampaignDecisionRow): CampaignDecisionRow {
  return {
    ...row,
    why: [...row.why, 'Live resume blocked because this campaign was not paused by this tool.'],
    blockers: [
      ...row.blockers,
      {
        code: 'PROVENANCE_REQUIRED',
        message: 'Live resume requires pausedByTool provenance.',
        blocking: true,
      },
    ],
  };
}

interface ProvenanceCheckResult {
  ok: boolean;
  allowed: boolean;
  error: ClassifiedError | null;
}

function classifyProvenanceLookupError(error: unknown): ClassifiedError {
  return {
    category: 'config',
    code: 'PROVENANCE_LOOKUP_FAILED',
    message: getErrorMessage(error),
    retryable: true,
  };
}

async function hasToolPauseProvenance(env: Env, campaignId: string): Promise<ProvenanceCheckResult> {
  if (!env.AUDIT_DB) {
    return {
      ok: true,
      allowed: false,
      error: null,
    };
  }

  try {
    const state = await env.AUDIT_DB
      .prepare('SELECT pausedByTool FROM campaign_states WHERE campaignId = ? LIMIT 1')
      .bind(campaignId)
      .first<{ pausedByTool: number | null }>();

    return {
      ok: true,
      allowed: state?.pausedByTool === 1,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      allowed: false,
      error: classifyProvenanceLookupError(error),
    };
  }
}

export function createSystemLogEntry(input: {
  runId: string | null;
  decision: DecisionType;
  why: string[];
  status: ActionLogEntry['status'];
  source: ActionLogEntry['source'];
  error?: ClassifiedError | null;
}): ActionLogEntry {
  return {
    id: `${input.runId ?? 'system'}-${input.decision}-${crypto.randomUUID()}`,
    runId: input.runId,
    campaignId: null,
    campaignName: null,
    decision: input.decision,
    source: input.source,
    status: input.status,
    occurredAt: getNowIso(),
    why: [...input.why],
    blockers: [],
    warnings: [],
    error: input.error ?? null,
    evidence: null,
  };
}

export async function evaluateCampaigns(env: Env, config: RuleConfig): Promise<CampaignDecisionRow[]> {
  const normalizedConfig = normalizeRuleConfig(config);
  const campaigns = await fetchActiveCampaigns(env);

  if (campaigns.length === 0) {
    return [];
  }

  const todayInsightsRows = await fetchAccountCampaignInsights(env, {
    datePreset: 'today',
  });
  const trailingThreeDayRows = await fetchAccountCampaignInsights(env, {
    timeRange: getTrailingDateRange(3),
  });

  const todayByCampaignId = buildInsightsMap(todayInsightsRows, 'TODAY_INSIGHTS');
  const threeDayByCampaignId = buildInsightsMap(trailingThreeDayRows, 'THREE_DAY_INSIGHTS');

  return campaigns.map((campaign): CampaignDecisionRow => {
    const todayRow = todayByCampaignId.get(campaign.id);
    const threeDayRow = threeDayByCampaignId.get(campaign.id);

    if (!todayRow || !threeDayRow) {
      throw new Error(`MISSING_REQUIRED_CAMPAIGN_INSIGHT_ROW:${campaign.id}`);
    }

    const todaySummary = createInsightsSummary(todayRow);
    const threeDayEvidence = createThreeDayEvidence(threeDayRow);
    const warnings = [...todaySummary.warnings];

    if (!threeDayEvidence.hasPurchaseMetric3d) {
      warnings.push({
        code: 'MISSING_OMNI_PURCHASE',
        message: 'Meta 3-day insights payload does not include omni_purchase.',
        severity: 'warning',
      });
    }

    const decision = determineDecision(campaign, normalizedConfig, {
      summary: todaySummary.insights,
      warnings,
      purchasesToday: todaySummary.purchasesToday,
      purchases3d: threeDayEvidence.purchases3d,
      hasPurchaseMetric3d: threeDayEvidence.hasPurchaseMetric3d,
    });

    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      decision: decision.decision,
      why: decision.why,
      evidence: createEvidence(
        normalizedConfig,
        campaign.id,
        todaySummary.insights,
        threeDayEvidence.purchases3d
      ),
      blockers: decision.blockers,
      campaignSnapshot: createCampaignSnapshot(
        campaign,
        todaySummary.insights,
        todaySummary.purchasesToday,
        threeDayEvidence.purchases3d
      ),
      warnings,
      error: null,
      insights: todaySummary.insights,
    };
  });
}

export async function executeCampaignActions(
  env: Env,
  rows: CampaignDecisionRow[],
  options?: { runId?: string | null }
): Promise<ExecutionResult> {
  const runId = options?.runId ?? null;
  const actions: RuleAction[] = [];
  const logs: ActionLogEntry[] = [];
  const campaignStateUpdates: ExecutionResult['campaignStateUpdates'] = [];

  for (const row of rows) {
    if (row.decision === 'MONITORING') {
      continue;
    }

    if (row.decision === 'WOULD_PAUSE' || row.decision === 'WOULD_RESUME') {
      logs.push(createLogEntry(row, 'skipped', 'dry_run', runId));
      continue;
    }

    if (row.decision === 'PAUSE' || row.decision === 'RESUME') {
      if (row.decision === 'RESUME') {
        const provenanceCheck = await hasToolPauseProvenance(env, row.id);
        if (!provenanceCheck.ok) {
          logs.push(
            createLogEntry(
              {
                ...row,
                decision: 'ERROR',
                why: [...row.why, 'Failed to verify pause provenance from audit store.'],
                blockers: [...row.blockers],
                error: provenanceCheck.error,
              },
              'failed',
              'system',
              runId,
              provenanceCheck.error
            )
          );
          continue;
        }

        if (!provenanceCheck.allowed) {
          logs.push(createLogEntry(createProvenanceBlockedRow(row), 'skipped', 'system', runId, null));
          continue;
        }
      }

      try {
        if (row.decision === 'PAUSE') {
          await pauseCampaign(env, row.id);
        } else {
          await resumeCampaign(env, row.id);
        }

        const action = createRuleAction(row);
        actions.push(action);
        logs.push(createLogEntry(row, 'applied', 'live', runId));
        campaignStateUpdates.push({
          campaignId: row.id,
          lastDecision: row.decision,
          lastAction: action.action,
          lastActionAt: action.timestamp,
          lastRunId: runId,
          pausedByTool: action.action === 'PAUSE',
        });
      } catch (error: unknown) {
        logs.push(createLogEntry(row, 'failed', 'live', runId, classifyMutationError(error)));
      }

      continue;
    }

    if (row.decision === 'ERROR') {
      logs.push(createLogEntry(row, 'failed', 'system', runId));
      continue;
    }

    logs.push(createLogEntry(row, 'skipped', 'system', runId));
  }

  return {
    actions,
    logs,
    campaignStateUpdates,
  };
}

export async function evaluateAndExecuteRules(
  env: Env,
  config: RuleConfig
): Promise<RuleAction[]> {
  const rows = await evaluateCampaigns(env, config);
  const execution = await executeCampaignActions(env, rows);
  return execution.actions;
}
