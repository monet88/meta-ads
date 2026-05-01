import { Env } from './types';

type Handler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>;

export class Router {
  private routes: { method: string; pattern: RegExp; handler: Handler; paramNames: string[] }[] = [];

  private addRoute(method: string, path: string, handler: Handler) {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const pattern = new RegExp(`^${patternStr}$`);
    this.routes.push({ method, pattern, handler, paramNames });
  }

  get(path: string, handler: Handler) { this.addRoute('GET', path, handler); }
  put(path: string, handler: Handler) { this.addRoute('PUT', path, handler); }

  async handle(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method && route.method !== 'ALL') continue;
      
      const match = path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, idx) => {
          params[name] = match[idx + 1];
        });
        
        try {
          return await route.handler(req, env, params);
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), { 
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
