export type CampaignStatus = 'ACTIVE' | 'PAUSED';
export type PurchaseMetric = 'omni_purchase';
export type DecisionType =
  | 'WOULD_PAUSE'
  | 'WOULD_RESUME'
  | 'PAUSE'
  | 'RESUME'
  | 'MONITORING'
  | 'SKIPPED_COOLDOWN'
  | 'SKIPPED_CAP'
  | 'SKIPPED_LOCK'
  | 'BLOCKED_NOT_ARMED'
  | 'UNKNOWN_DATA'
  | 'ERROR';
export type RunStatus = 'started' | 'completed' | 'failed' | 'skipped_overlap' | 'blocked_live_gate';
export type HealthStatus = 'ok' | 'degraded' | 'error';
export type ConfigWriteStatus = 'saved' | 'validation_error' | 'version_conflict' | 'blocked_live_gate';
export type ActivitySource = 'dry_run' | 'live' | 'system';
export type DataState = 'complete' | 'partial' | 'missing' | 'error';
export type WarningSeverity = 'info' | 'warning' | 'error';
export type ArmingStatus = 'not_armed' | 'eligible' | 'armed' | 'blocked';
export type BlockerCode =
  | 'AD_ACCOUNT_CONFIRMATION_REQUIRED'
  | 'ALLOWLIST_REQUIRED'
  | 'ACTION_CAPS_REQUIRED'
  | 'RECENT_DRY_RUN_REVIEW_REQUIRED'
  | 'EMERGENCY_STOP'
  | 'COOLDOWN_ACTIVE'
  | 'RUN_CAP_REACHED'
  | 'DAY_CAP_REACHED'
  | 'CAMPAIGN_NOT_ALLOWED'
  | 'CAMPAIGN_EXCLUDED'
  | 'LOCK_ACTIVE'
  | 'PROVENANCE_REQUIRED'
  | 'GLOBAL_INSIGHTS_UNAVAILABLE'
  | 'MISSING_OMNI_PURCHASE';
export type WarningCode = 'MISSING_OMNI_PURCHASE' | 'PARTIAL_INSIGHTS' | 'INSIGHTS_UNAVAILABLE';

export interface ApiValidationErrorDetail {
  field: string;
  code: string;
  message: string;
}

export interface ClassifiedError {
  category: 'auth' | 'config' | 'global_insights' | 'campaign_mutation' | 'validation';
  code: string;
  message: string;
  retryable: boolean;
  details?: ApiValidationErrorDetail[];
}

export interface BlockerReason {
  code: BlockerCode;
  message: string;
  blocking: boolean;
}

export interface DataWarning {
  code: WarningCode;
  message: string;
  severity: WarningSeverity;
}

export interface ArmingState {
  status: ArmingStatus;
  adAccountConfirmed: boolean;
  recentDryRunRunId: string | null;
  recentDryRunReviewedAt: string | null;
  reviewedBy: string | null;
  reliabilityScore: number | null;
  evidenceWindowDays: number;
}

export interface RuleConfig {
  enabled: boolean;
  dryRun?: boolean;
  pauseThreshold: number;
  pauseThreshold2?: number | null;
  resumeThreshold: number;
  cooldownHours?: number;
  maxActionsPerRun?: number;
  maxActionsPerDay?: number;
  allowlistCampaignIds?: string[];
  excludeCampaignIds?: string[];
  emergencyStop?: boolean;
  arming?: Partial<ArmingState>;
}

export interface NormalizedRuleConfig extends RuleConfig {
  dryRun: boolean;
  pauseThreshold2: number | null;
  cooldownHours: number;
  maxActionsPerRun: number;
  maxActionsPerDay: number;
  allowlistCampaignIds: string[];
  excludeCampaignIds: string[];
  emergencyStop: boolean;
  arming: ArmingState;
}

export interface CampaignInsight {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  spend: number;
  purchaseCount: number;
  purchaseMetric: PurchaseMetric;
  hasPurchaseMetric: boolean;
  dataState: DataState;
}

export interface CampaignInsightsSummary {
  spend: number;
  purchases: number;
  purchaseMetric: PurchaseMetric;
  hasPurchaseMetric: boolean;
  dataState: DataState;
}

export interface CampaignSnapshot {
  id: string;
  name: string;
  status: CampaignStatus;
  spendToday: number | null;
  purchasesToday: number | null;
  purchases3d: number | null;
  purchaseMetric: PurchaseMetric;
  hasPurchaseMetric: boolean;
  dataState: DataState;
}

export interface DecisionEvidence {
  spendToday: number | null;
  purchasesToday: number | null;
  purchases3d: number | null;
  purchaseMetric: PurchaseMetric;
  dataState: DataState;
  dryRun: boolean;
  cooldownHours: number;
  maxActionsPerRun: number;
  maxActionsPerDay: number;
  allowlisted: boolean;
  excluded: boolean;
  emergencyStop: boolean;
  armingStatus: ArmingStatus;
  reliabilityScore: number | null;
}

export interface CampaignDecisionRow {
  id: string;
  name: string;
  status: CampaignStatus;
  decision: DecisionType;
  why: string[];
  evidence: DecisionEvidence;
  blockers: BlockerReason[];
  campaignSnapshot: CampaignSnapshot;
  warnings: DataWarning[];
  error: ClassifiedError | null;
  insights: CampaignInsightsSummary | null;
}

export interface ActivityTimelineItem {
  id: string;
  runId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  decision: DecisionType;
  source: ActivitySource;
  status: 'applied' | 'skipped' | 'failed';
  occurredAt: string;
  why: string[];
  blockers: BlockerReason[];
  warnings: DataWarning[];
  error: ClassifiedError | null;
  evidence: DecisionEvidence | null;
}

export interface RunHealthSummary {
  currentStatus: RunStatus | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  nextScheduledAt: string | null;
  activeLock: boolean;
  activeRunId: string | null;
}

export interface ConfigReadModel extends NormalizedRuleConfig {
  dryRun: boolean;
  pauseThreshold2: number | null;
  cooldownHours: number;
  maxActionsPerRun: number;
  maxActionsPerDay: number;
  allowlistCampaignIds: string[];
  excludeCampaignIds: string[];
  emergencyStop: boolean;
  arming: ArmingState;
  version: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  liveArmingEligible: boolean;
  armingBlockers: BlockerReason[];
}

export interface ConfigVersionConflictMetadata {
  currentVersion: number | null;
  submittedVersion: number | null;
  latestConfig: ConfigReadModel;
}

export interface HealthPayload {
  status: HealthStatus;
  message: string;
  checkedAt: string;
  metaAccountId: string;
}

export interface ApiResponseMeta {
  generatedAt: string;
  total?: number;
  version?: number | null;
  run?: RunHealthSummary | null;
}

export interface ApiSuccessResponse<T, M = ApiResponseMeta> {
  success: true;
  data: T;
  error: null;
  message?: string;
  meta?: M;
}

export interface ApiErrorResponse<T = null, M = ApiResponseMeta> {
  success: false;
  data: T;
  error: ClassifiedError;
  message: string;
  meta?: M;
}

export interface RuleAction {
  campaignId: string;
  campaignName: string;
  action: 'PAUSE' | 'RESUME';
  reason: string;
  timestamp: string;
  spend: number;
  purchaseCount: number;
}

export interface LegacyCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  insights?: {
    spend: string;
    purchases: number;
  } | null;
}

export type Campaign = LegacyCampaign;
export type CampaignEnriched = CampaignDecisionRow;
