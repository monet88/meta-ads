import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { ApiErrorResponse, Env } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

class FakeKVNamespace {
  private readonly store = new Map<string, string>();

  async get(key: string, type?: "text" | "json"): Promise<string | unknown | null> {
    const value = this.store.get(key);
    if (typeof value !== "string") {
      return null;
    }

    if (type === "json") {
      return JSON.parse(value) as unknown;
    }

    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    META_ACCESS_TOKEN: "test-token",
    META_ACCOUNT_ID: "test-account",
    CONFIG_KV: (overrides.CONFIG_KV ?? new FakeKVNamespace()) as unknown as Env["CONFIG_KV"],
    AUDIT_DB: overrides.AUDIT_DB,
    FRONTEND_URL: "https://dashboard.example.com",
    API_AUTH_TOKEN: "api-test-token",
    ALLOW_LOCAL_DEV: "false",
  };
}

describe("auth guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects unauthenticated API requests", async () => {
    const request = new Request("https://api.example.com/api/config");
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, createEnv(), ctx);

    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);

    const body = (await response.json()) as ApiErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.category).toBe("auth");
    expect(body.error.code).toBe("ACCESS_UNAUTHORIZED");
  });

  it("rejects config writes from disallowed origin even when authenticated", async () => {
    const request = new Request("https://api.example.com/api/config", {
      method: "PUT",
      headers: {
        Authorization: "Bearer api-test-token",
        Origin: "https://evil.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        dryRun: true,
        pauseThreshold: 170000,
        pauseThreshold2: 200000,
        resumeThreshold: 150000,
        cooldownHours: 24,
        maxActionsPerRun: 0,
        maxActionsPerDay: 0,
        allowlistCampaignIds: [],
        excludeCampaignIds: [],
        emergencyStop: false,
        arming: {
          status: "not_armed",
          adAccountConfirmed: false,
          recentDryRunRunId: null,
          recentDryRunReviewedAt: null,
          reviewedBy: null,
          reliabilityScore: null,
          evidenceWindowDays: 3,
        },
        version: null,
      }),
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, createEnv(), ctx);

    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(403);

    const body = (await response.json()) as ApiErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.category).toBe("auth");
    expect(body.error.code).toBe("ORIGIN_FORBIDDEN");
  });

  it("uses Authorization Bearer header for health check without access_token in URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "me" }), {
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://api.example.com/api/health", {
      headers: {
        Authorization: "Bearer api-test-token",
      },
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, createEnv(), ctx);

    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("https://graph.facebook.com/v21.0/me");
    expect(url).not.toContain("access_token=");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
  });

  it("persists config_versions row on successful config save", async () => {
    const kv = new FakeKVNamespace();
    const db = env.AUDIT_DB!;
    const request = new Request("https://api.example.com/api/config", {
      method: "PUT",
      headers: {
        Authorization: "Bearer api-test-token",
        Origin: "https://dashboard.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        dryRun: true,
        pauseThreshold: 170000,
        pauseThreshold2: 200000,
        resumeThreshold: 150000,
        cooldownHours: 24,
        maxActionsPerRun: 0,
        maxActionsPerDay: 0,
        allowlistCampaignIds: [],
        excludeCampaignIds: [],
        emergencyStop: false,
        arming: {
          status: "not_armed",
          adAccountConfirmed: false,
          recentDryRunRunId: null,
          recentDryRunReviewedAt: null,
          reviewedBy: null,
          reliabilityScore: null,
          evidenceWindowDays: 3,
        },
        version: null,
      }),
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, createEnv({ CONFIG_KV: kv as unknown as Env["CONFIG_KV"], AUDIT_DB: db }), ctx);

    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);

    const versions = await db.prepare("SELECT version, createdBy FROM config_versions").all();
    expect(versions.results).toHaveLength(1);
    expect(versions.results[0]).toMatchObject({
      version: 1,
      createdBy: "dashboard",
    });
  });
});
