export interface RuleConfig {
  pauseThreshold: number;
  pauseThreshold2?: number;
  resumeThreshold: number;
  enabled: boolean;
}

export interface CampaignInsight {
  campaignId: string;
  campaignName: string;
  status: 'ACTIVE' | 'PAUSED';
  spend: number;
  purchaseCount: number;
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

export interface Campaign extends CampaignInsight {
  id: string;
  name: string;
  insights?: {
    spend: number;
    purchases: number;
  };
}
