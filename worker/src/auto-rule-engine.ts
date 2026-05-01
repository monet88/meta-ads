import { Env, RuleConfig, RuleAction } from './types';
import { 
  fetchActiveCampaigns, 
  fetchCampaignInsights, 
  pauseCampaign, 
  resumeCampaign, 
  extractPurchaseCount 
} from './meta-api-client';

export async function evaluateAndExecuteRules(
  env: Env,
  config: RuleConfig
): Promise<RuleAction[]> {
  const campaigns = await fetchActiveCampaigns(env);
  const actions: RuleAction[] = [];

  for (const campaign of campaigns) {
    const insights = await fetchCampaignInsights(env, campaign.id);
    const spend = parseFloat(insights.spend || '0');
    const purchases = extractPurchaseCount(insights.actions);

    // PAUSE rule 1
    if (campaign.status === 'ACTIVE' && spend > config.pauseThreshold && purchases === 0) {
      await pauseCampaign(env, campaign.id);
      actions.push({ 
        campaignId: campaign.id,
        campaignName: campaign.name,
        action: 'PAUSE', 
        reason: `spend=${spend} > ${config.pauseThreshold}, purchases=0`,
        timestamp: new Date().toISOString(),
        spend,
        purchaseCount: purchases
      });
    }
    // PAUSE rule 2
    else if (campaign.status === 'ACTIVE' && config.pauseThreshold2 && spend > config.pauseThreshold2 && purchases < 2) {
      await pauseCampaign(env, campaign.id);
      actions.push({ 
        campaignId: campaign.id,
        campaignName: campaign.name,
        action: 'PAUSE', 
        reason: `spend=${spend} > ${config.pauseThreshold2}, purchases<2`,
        timestamp: new Date().toISOString(),
        spend,
        purchaseCount: purchases
      });
    }

    // RESUME rule
    if (campaign.status === 'PAUSED' && spend < config.resumeThreshold && purchases > 0) {
      await resumeCampaign(env, campaign.id);
      actions.push({ 
        campaignId: campaign.id,
        campaignName: campaign.name,
        action: 'RESUME', 
        reason: `spend=${spend} < ${config.resumeThreshold}, purchases=${purchases}`,
        timestamp: new Date().toISOString(),
        spend,
        purchaseCount: purchases
      });
    }
  }

  return actions;
}
