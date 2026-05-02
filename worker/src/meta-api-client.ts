import { Env } from './types';

interface MetaApiError {
  message: string;
}

interface MetaPaging {
  next?: string;
}

interface MetaApiResponse<T> {
  data?: T;
  error?: MetaApiError;
  paging?: MetaPaging;
}

export interface MetaCampaignRecord {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED';
}

export interface MetaActionRecord {
  action_type: string;
  value: string;
}

export interface MetaInsightsResponseRow {
  spend?: string;
  actions?: MetaActionRecord[];
}

export interface MetaAccountInsightsRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  actions?: MetaActionRecord[];
  date_start?: string;
  date_stop?: string;
}

interface InsightsTimeRange {
  since: string;
  until: string;
}

function metaHeaders(env: Env, includeJsonContentType = false): HeadersInit {
  return {
    Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
    ...(includeJsonContentType ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function parseMetaEnvelope<T>(response: Response, errorPrefix: string): Promise<MetaApiResponse<T>> {
  const data = (await response.json()) as MetaApiResponse<T>;

  if (data.error) {
    throw new Error(`${errorPrefix}: ${data.error.message}`);
  }

  return data;
}

function buildAccountInsightsUrl(
  env: Env,
  options: {
    datePreset?: 'today';
    timeRange?: InsightsTimeRange;
  }
): string {
  const params = new URLSearchParams();
  params.set('fields', 'campaign_id,campaign_name,spend,actions');
  params.set('level', 'campaign');
  params.set('limit', '200');

  if (options.timeRange) {
    params.set('time_range', JSON.stringify(options.timeRange));
    params.set('time_increment', 'all_days');
  } else {
    params.set('date_preset', options.datePreset ?? 'today');
  }

  return `https://graph.facebook.com/v21.0/act_${env.META_ACCOUNT_ID}/insights?${params.toString()}`;
}

export async function fetchActiveCampaigns(env: Env): Promise<MetaCampaignRecord[]> {
  let nextUrl: string | null = `https://graph.facebook.com/v21.0/act_${env.META_ACCOUNT_ID}/campaigns?fields=id,name,status&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]`;
  const campaigns: MetaCampaignRecord[] = [];

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: metaHeaders(env),
    });

    const envelope = await parseMetaEnvelope<MetaCampaignRecord[]>(response, 'Meta API Error');
    campaigns.push(...(envelope.data || []));
    nextUrl = envelope.paging?.next ?? null;
  }

  return campaigns;
}

export async function fetchAccountCampaignInsights(
  env: Env,
  options: {
    datePreset?: 'today';
    timeRange?: InsightsTimeRange;
  }
): Promise<MetaAccountInsightsRow[]> {
  let nextUrl: string | null = buildAccountInsightsUrl(env, options);
  const rows: MetaAccountInsightsRow[] = [];

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: metaHeaders(env),
    });

    const envelope = await parseMetaEnvelope<MetaAccountInsightsRow[]>(response, 'Meta API Insights Error');
    rows.push(...(envelope.data || []));
    nextUrl = envelope.paging?.next ?? null;
  }

  return rows;
}

export async function fetchCampaignInsights(env: Env, campaignId: string): Promise<MetaInsightsResponseRow> {
  const url = `https://graph.facebook.com/v21.0/${campaignId}/insights?date_preset=today&fields=spend,actions`;

  const response = await fetch(url, {
    headers: metaHeaders(env),
  });

  const envelope = await parseMetaEnvelope<MetaInsightsResponseRow[]>(response, 'Meta API Error');
  const data = envelope.data;

  if (!data || data.length === 0) {
    return { spend: '0', actions: [] };
  }

  return data[0];
}

export async function pauseCampaign(env: Env, campaignId: string): Promise<unknown> {
  const url = `https://graph.facebook.com/v21.0/${campaignId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: metaHeaders(env, true),
    body: JSON.stringify({
      status: 'PAUSED',
    }),
  });

  const envelope = await parseMetaEnvelope<unknown>(response, 'Meta API Error pausing campaign');
  return envelope.data;
}

export async function resumeCampaign(env: Env, campaignId: string): Promise<unknown> {
  const url = `https://graph.facebook.com/v21.0/${campaignId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: metaHeaders(env, true),
    body: JSON.stringify({
      status: 'ACTIVE',
    }),
  });

  const envelope = await parseMetaEnvelope<unknown>(response, 'Meta API Error resuming campaign');
  return envelope.data;
}

export function extractPurchaseCount(actions: MetaActionRecord[] | undefined): number {
  if (!actions || !Array.isArray(actions)) return 0;

  const purchaseAction = actions.find((a) => a.action_type === 'omni_purchase');

  return purchaseAction ? parseInt(purchaseAction.value, 10) : 0;
}
