import { Env, RuleConfig, RuleAction } from './types';
import { evaluateAndExecuteRules } from './auto-rule-engine';
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

const DEFAULT_CONFIG: RuleConfig = {
  pauseThreshold: 170000,
  resumeThreshold: 150000,
  enabled: true
};

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

async function logActions(kv: KVNamespace, actions: RuleAction[]) {
  try {
    const currentLogsString = await kv.get('RULE_LOGS', 'text');
    let logs: RuleAction[] = [];
    if (currentLogsString) {
      logs = JSON.parse(currentLogsString);
    }
    
    // Prepend new actions and keep last 1000 logs
    logs = [...actions, ...logs].slice(0, 1000);
    
    await kv.put('RULE_LOGS', JSON.stringify(logs));
  } catch (error) {
    console.error('Failed to save logs to KV', error);
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const config = await loadConfig(env.CONFIG_KV);
    if (!config.enabled) return;
    
    try {
      const actions = await evaluateAndExecuteRules(env, config);
      if (actions.length > 0) {
        ctx.waitUntil(logActions(env.CONFIG_KV, actions));
      }
    } catch (error) {
      console.error('Error executing rules:', error);
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method === 'OPTIONS') return handleOptions(request, env);

    const router = new Router();
    router.get('/api/campaigns', handleGetCampaigns);
    router.get('/api/campaigns/:id/insights', handleGetCampaignInsights);
    router.get('/api/config', handleGetConfig);
    router.put('/api/config', handlePutConfig);
    router.get('/api/logs', handleGetLogs);
    router.get('/api/health', handleHealth);

    const response = await router.handle(request, env);
    return withCors(response, env, request);
  }
} satisfies ExportedHandler<Env>;
