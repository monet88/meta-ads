import { Env, CampaignInsight } from './types';

export async function fetchActiveCampaigns(env: Env) {
  const url = `https://graph.facebook.com/v21.0/act_${env.META_ACCOUNT_ID}/campaigns?fields=id,name,status&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]&access_token=${env.META_ACCESS_TOKEN}`;
  
  const response = await fetch(url);
  const data: any = await response.json();
  
  if (data.error) {
    throw new Error(`Meta API Error: ${data.error.message}`);
  }
  
  return data.data || [];
}

export async function fetchCampaignInsights(env: Env, campaignId: string) {
  const url = `https://graph.facebook.com/v21.0/${campaignId}/insights?date_preset=today&fields=spend,actions&access_token=${env.META_ACCESS_TOKEN}`;
  
  const response = await fetch(url);
  const data: any = await response.json();
  
  if (data.error) {
    throw new Error(`Meta API Error: ${data.error.message}`);
  }
  
  if (!data.data || data.data.length === 0) {
    return { spend: '0', actions: [] };
  }
  
  return data.data[0];
}

export async function pauseCampaign(env: Env, campaignId: string) {
  const url = `https://graph.facebook.com/v21.0/${campaignId}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'PAUSED',
      access_token: env.META_ACCESS_TOKEN
    })
  });
  
  const data: any = await response.json();
  if (data.error) {
    throw new Error(`Meta API Error pausing campaign: ${data.error.message}`);
  }
  
  return data;
}

export async function resumeCampaign(env: Env, campaignId: string) {
  const url = `https://graph.facebook.com/v21.0/${campaignId}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'ACTIVE',
      access_token: env.META_ACCESS_TOKEN
    })
  });
  
  const data: any = await response.json();
  if (data.error) {
    throw new Error(`Meta API Error resuming campaign: ${data.error.message}`);
  }
  
  return data;
}

export function extractPurchaseCount(actions: any[]): number {
  if (!actions || !Array.isArray(actions)) return 0;
  
  const purchaseAction = actions.find((a: any) => a.action_type === 'omni_purchase') || 
                         actions.find((a: any) => a.action_type === 'purchase');
                         
  return purchaseAction ? parseInt(purchaseAction.value, 10) : 0;
}
