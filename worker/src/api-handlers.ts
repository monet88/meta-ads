import { Env, RuleConfig } from './types';
import { fetchActiveCampaigns, fetchCampaignInsights } from './meta-api-client';

const DEFAULT_CONFIG: RuleConfig = {
  pauseThreshold: 170000,
  pauseThreshold2: 200000,
  resumeThreshold: 155000,
  enabled: true
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function handleGetCampaigns(req: Request, env: Env): Promise<Response> {
  const campaigns = await fetchActiveCampaigns(env);
  
  // Enrich with today's insights
  const enrichedCampaigns = await Promise.all(
    campaigns.map(async (c: any) => {
      try {
        const insights = await fetchCampaignInsights(env, c.id);
        const spend = parseFloat(insights.spend || '0');
        // Need to extract purchases here or return raw actions
        const actions = insights.actions || [];
        const purchaseAction = actions.find((a: any) => a.action_type === 'omni_purchase') || 
                               actions.find((a: any) => a.action_type === 'purchase');
        const purchases = purchaseAction ? parseInt(purchaseAction.value, 10) : 0;
        
        return {
          ...c,
          insights: {
            spend,
            purchases
          }
        };
      } catch (err) {
        return { ...c, insights: null, error: 'Failed to load insights' };
      }
    })
  );
  
  return jsonResponse({ data: enrichedCampaigns });
}

export async function handleGetCampaignInsights(req: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;
  if (!id) return jsonResponse({ error: 'Missing campaign id' }, 400);
  
  const insights = await fetchCampaignInsights(env, id);
  return jsonResponse({ data: insights });
}

export async function handleGetConfig(req: Request, env: Env): Promise<Response> {
  const configRaw = await env.CONFIG_KV.get('RULE_CONFIG', 'json') as Partial<RuleConfig> | null;
  const mergedConfig: RuleConfig = {
    pauseThreshold: configRaw?.pauseThreshold || DEFAULT_CONFIG.pauseThreshold,
    pauseThreshold2: configRaw?.pauseThreshold2 || DEFAULT_CONFIG.pauseThreshold2,
    resumeThreshold: configRaw?.resumeThreshold || DEFAULT_CONFIG.resumeThreshold,
    enabled: configRaw?.enabled ?? DEFAULT_CONFIG.enabled
  };
  return jsonResponse({ data: mergedConfig });
}

export async function handlePutConfig(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // Very basic validation
  if (typeof body.pauseThreshold !== 'number' || typeof body.resumeThreshold !== 'number') {
    return jsonResponse({ error: 'Invalid threshold types. Must be numbers.' }, 400);
  }

  const newConfig: RuleConfig = {
    pauseThreshold: body.pauseThreshold,
    pauseThreshold2: body.pauseThreshold2 ?? 200000,
    resumeThreshold: body.resumeThreshold,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true
  };

  await env.CONFIG_KV.put('RULE_CONFIG', JSON.stringify(newConfig));
  return jsonResponse({ data: newConfig, message: 'Config updated successfully' });
}

export async function handleGetLogs(req: Request, env: Env): Promise<Response> {
  const logsRaw = await env.CONFIG_KV.get('RULE_LOGS', 'json');
  return jsonResponse({ data: logsRaw || [] });
}

export async function handleHealth(req: Request, env: Env): Promise<Response> {
  try {
    // Quick token test by calling graph api me
    const url = `https://graph.facebook.com/v21.0/me?access_token=${env.META_ACCESS_TOKEN}`;
    const response = await fetch(url);
    const data: any = await response.json();
    
    if (data.error) {
      return jsonResponse({ status: 'error', message: data.error.message }, 401);
    }
    
    return jsonResponse({ status: 'ok', message: 'System healthy and token valid' });
  } catch (err: any) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}
