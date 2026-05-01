import { Env } from './types';

export function corsHeaders(env: Env, request?: Request): HeadersInit {
  const origin = request?.headers.get('Origin');
  const isLocal = origin && origin.startsWith('http://localhost:');
  const allowedOrigin = isLocal ? origin : (env.FRONTEND_URL || '*');
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function handleOptions(request: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(env, request) });
}

export function withCors(response: Response, env: Env, request?: Request): Response {
  const newRes = new Response(response.body, response);
  Object.entries(corsHeaders(env, request)).forEach(([k, v]) => newRes.headers.set(k, v));
  return newRes;
}
