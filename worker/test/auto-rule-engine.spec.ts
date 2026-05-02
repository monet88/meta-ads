import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluateCampaigns, executeCampaignActions } from "../src/auto-rule-engine";
import worker from "../src/index";
import type { CampaignDecisionRow, Env, RuleConfig } from "../src/types";

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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createConfig(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return {
    enabled: true,
    dryRun: true,
    pauseThreshold: 170000,
    pauseThreshold2: 200000,
    resumeThreshold: 150000,
    cooldownHours: 24,
    maxActionsPerRun: 1,
    maxActionsPerDay: 1,
    allowlistCampaignIds: [],
    excludeCampaignIds: [],
    emergencyStop: false,
    arming: {
      status: "armed",
      adAccountConfirmed: true,
      recentDryRunRunId: "run_dry_1",
      recentDryRunReviewedAt: "2026-05-01T00:00:00.000Z",
      reviewedBy: "operator",
      reliabilityScore: 0.9,
      evidenceWindowDays: 3,
    },
    ...overrides,
  };
}

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    META_ACCESS_TOKEN: "meta-test-token",
    META_ACCOUNT_ID: "123456789",
    CONFIG_KV: (overrides.CONFIG_KV ?? new FakeKVNamespace()) as unknown as Env["CONFIG_KV"],
    AUDIT_DB: overrides.AUDIT_DB,
    FRONTEND_URL: "https://dashboard.example.com",
    API_AUTH_TOKEN: "api-test-token",
    ALLOW_LOCAL_DEV: "false",
  };
}

describe("auto rule engine", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns decision, why, and evidence without mutating Meta during evaluation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if ((init?.method ?? "GET") === "POST") {
        throw new Error("evaluator must not mutate Meta");
      }

      if (url.includes("/campaigns?fields=id,name,status")) {
        return jsonResponse({
          data: [{ id: "camp_1", name: "Campaign 1", status: "ACTIVE" }],
        });
      }

      if (url.includes("/insights?") && url.includes("date_preset=today") && url.includes("level=campaign")) {
        return jsonResponse({
          data: [
            {
              campaign_id: "camp_1",
              campaign_name: "Campaign 1",
              spend: "180000",
              actions: [{ action_type: "omni_purchase", value: "0" }],
            },
          ],
        });
      }

      if (url.includes("/insights?") && url.includes("time_range=") && url.includes("level=campaign")) {
        return jsonResponse({
          data: [
            {
              campaign_id: "camp_1",
              campaign_name: "Campaign 1",
              spend: "200000",
              actions: [{ action_type: "omni_purchase", value: "0" }],
            },
          ],
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const rows = await evaluateCampaigns(
      createEnv(),
      createConfig({
        dryRun: false,
        allowlistCampaignIds: ["camp_1"],
      })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe("PAUSE");
    expect(rows[0].why.length).toBeGreaterThan(0);
    expect(rows[0].evidence.dryRun).toBe(false);
    expect(rows[0].evidence.allowlisted).toBe(true);
    expect(rows[0].campaignSnapshot.spendToday).toBe(180000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });

  it("lets executor perform Meta mutations only for actionable decisions", async () => {
    const fetchMock = vi.fn(async () => {
      return jsonResponse({ data: { success: true } });
    });

    vi.stubGlobal("fetch", fetchMock);

    const row: CampaignDecisionRow = {
      id: "camp_1",
      name: "Campaign 1",
      status: "ACTIVE",
      decision: "PAUSE",
      why: ["Spend is above threshold with 0 omni_purchase."],
      evidence: {
        spendToday: 180000,
        purchasesToday: 0,
        purchases3d: null,
        purchaseMetric: "omni_purchase",
        dataState: "complete",
        dryRun: false,
        cooldownHours: 24,
        maxActionsPerRun: 1,
        maxActionsPerDay: 1,
        allowlisted: true,
        excluded: false,
        emergencyStop: false,
        armingStatus: "armed",
        reliabilityScore: 0.9,
      },
      blockers: [],
      campaignSnapshot: {
        id: "camp_1",
        name: "Campaign 1",
        status: "ACTIVE",
        spendToday: 180000,
        purchasesToday: 0,
        purchases3d: null,
        purchaseMetric: "omni_purchase",
        hasPurchaseMetric: true,
        dataState: "complete",
      },
      warnings: [],
      error: null,
      insights: {
        spend: 180000,
        purchases: 0,
        purchaseMetric: "omni_purchase",
        hasPurchaseMetric: true,
        dataState: "complete",
      },
    };

    const execution = await executeCampaignActions(createEnv(), [row]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    expect(requestInit?.method).toBe("POST");
    expect(execution.actions).toHaveLength(1);
    expect(execution.actions[0].action).toBe("PAUSE");
    expect(execution.logs).toHaveLength(1);
    expect(execution.logs[0].status).toBe("applied");
    expect(execution.logs[0].source).toBe("live");
    expect(execution.campaignStateUpdates).toEqual([
      expect.objectContaining({
        campaignId: "camp_1",
        lastDecision: "PAUSE",
        lastAction: "PAUSE",
        pausedByTool: true,
      }),
    ]);
  });

  it("runs scheduled flow in dry-run, writes audit rows to real D1, and skips Meta mutations", async () => {
    const kv = new FakeKVNamespace();
    const db = env.AUDIT_DB!;

    await kv.put(
      "RULE_CONFIG::123456789",
      JSON.stringify(
        createConfig({
          dryRun: true,
          allowlistCampaignIds: ["camp_1"],
        })
      )
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if ((init?.method ?? "GET") === "POST") {
        throw new Error("dry-run must not mutate Meta");
      }

      if (url.includes("/campaigns?fields=id,name,status")) {
        return jsonResponse({
          data: [{ id: "camp_1", name: "Campaign 1", status: "ACTIVE" }],
        });
      }

      if (url.includes("/insights?") && url.includes("date_preset=today") && url.includes("level=campaign")) {
        return jsonResponse({
          data: [
            {
              campaign_id: "camp_1",
              campaign_name: "Campaign 1",
              spend: "180000",
              actions: [{ action_type: "omni_purchase", value: "0" }],
            },
          ],
        });
      }

      if (url.includes("/insights?") && url.includes("time_range=") && url.includes("level=campaign")) {
        return jsonResponse({
          data: [
            {
              campaign_id: "camp_1",
              campaign_name: "Campaign 1",
              spend: "200000",
              actions: [{ action_type: "omni_purchase", value: "0" }],
            },
          ],
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const ctx = createExecutionContext();
    await worker.scheduled(
      {} as ScheduledController,
      createEnv({ CONFIG_KV: kv as unknown as Env["CONFIG_KV"], AUDIT_DB: db }),
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);

    const runs = await db.prepare("SELECT id, status FROM automation_runs").all();
    const logs = await db.prepare("SELECT decision, source, status FROM action_logs").all();

    expect(runs.results).toHaveLength(1);
    expect((runs.results[0] as { status: string }).status).toBe("completed");
    expect(logs.results).toHaveLength(1);
    expect((logs.results[0] as { decision: string }).decision).toBe("WOULD_PAUSE");

    const storedLogs = (await kv.get("RULE_LOGS::123456789", "text")) as string;
    expect(storedLogs).toContain("WOULD_PAUSE");
  });

  it("persists campaign_states for live applied actions", async () => {
    const kv = new FakeKVNamespace();
    const db = env.AUDIT_DB!;

    await kv.put(
      "RULE_CONFIG::123456789",
      JSON.stringify(
        createConfig({
          dryRun: false,
          allowlistCampaignIds: ["camp_1"],
        })
      )
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/campaigns?fields=id,name,status")) {
        return jsonResponse({
          data: [{ id: "camp_1", name: "Campaign 1", status: "ACTIVE" }],
        });
      }

      if (url.includes("/insights?") && url.includes("date_preset=today") && url.includes("level=campaign")) {
        return jsonResponse({
          data: [
            {
              campaign_id: "camp_1",
              campaign_name: "Campaign 1",
              spend: "180000",
              actions: [{ action_type: "omni_purchase", value: "0" }],
            },
          ],
        });
      }

      if (url.includes("/insights?") && url.includes("time_range=") && url.includes("level=campaign")) {
        return jsonResponse({
          data: [
            {
              campaign_id: "camp_1",
              campaign_name: "Campaign 1",
              spend: "200000",
              actions: [{ action_type: "omni_purchase", value: "0" }],
            },
          ],
        });
      }

      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse({ data: { success: true } });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const ctx = createExecutionContext();
    await worker.scheduled(
      {} as ScheduledController,
      createEnv({ CONFIG_KV: kv as unknown as Env["CONFIG_KV"], AUDIT_DB: db }),
      ctx
    );
    await waitOnExecutionContext(ctx);

    const states = await db
      .prepare("SELECT campaignId, lastDecision, lastAction, pausedByTool FROM campaign_states")
      .all();

    expect(states.results).toHaveLength(1);
    expect(states.results[0]).toMatchObject({
      campaignId: "camp_1",
      lastDecision: "PAUSE",
      lastAction: "PAUSE",
      pausedByTool: 1,
    });
  });

  it("skips overlapping scheduled runs behind lock and records audit trail in real D1", async () => {
    const kv = new FakeKVNamespace();
    const db = env.AUDIT_DB!;

    await kv.put("RULE_CONFIG::123456789", JSON.stringify(createConfig()));
    await kv.put("AUTOMATION_RUN_LOCK", JSON.stringify({ runId: "existing-run" }));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const ctx = createExecutionContext();
    await worker.scheduled(
      {} as ScheduledController,
      createEnv({ CONFIG_KV: kv as unknown as Env["CONFIG_KV"], AUDIT_DB: db }),
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(fetchMock).not.toHaveBeenCalled();

    const runs = await db.prepare("SELECT status FROM automation_runs").all();
    const logs = await db.prepare("SELECT decision FROM action_logs").all();

    expect(runs.results).toHaveLength(1);
    expect((runs.results[0] as { status: string }).status).toBe("skipped_overlap");
    expect(logs.results).toHaveLength(1);
    expect((logs.results[0] as { decision: string }).decision).toBe("SKIPPED_LOCK");

    const storedLogs = (await kv.get("RULE_LOGS::123456789", "text")) as string;
    expect(storedLogs).toContain("SKIPPED_LOCK");
  });

  it("fails closed and writes run-level error when global insights layer is unavailable", async () => {
    const kv = new FakeKVNamespace();
    const db = env.AUDIT_DB!;

    await kv.put(
      "RULE_CONFIG::123456789",
      JSON.stringify(
        createConfig({
          dryRun: false,
          allowlistCampaignIds: ["camp_1"],
        })
      )
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if ((init?.method ?? "GET") === "POST") {
        throw new Error("live mutation must be blocked when insights fail closed");
      }

      if (url.includes("/campaigns?fields=id,name,status")) {
        return jsonResponse({
          data: [{ id: "camp_1", name: "Campaign 1", status: "ACTIVE" }],
        });
      }

      if (url.includes("/insights?") && url.includes("date_preset=today") && url.includes("level=campaign")) {
        throw new Error("Meta insights unavailable");
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const ctx = createExecutionContext();
    await worker.scheduled(
      {} as ScheduledController,
      createEnv({ CONFIG_KV: kv as unknown as Env["CONFIG_KV"], AUDIT_DB: db }),
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);

    const runs = await db.prepare("SELECT status, errorJson FROM automation_runs").all();
    const logs = await db.prepare("SELECT decision, status, source, payloadJson FROM action_logs").all();

    expect(runs.results).toHaveLength(1);
    expect((runs.results[0] as { status: string }).status).toBe("failed");
    expect(String((runs.results[0] as { errorJson: string | null }).errorJson)).toContain("AUTOMATION_RUN_FAILED");

    expect(logs.results).toHaveLength(1);
    expect((logs.results[0] as { decision: string }).decision).toBe("ERROR");
    expect((logs.results[0] as { source: string }).source).toBe("system");
    expect((logs.results[0] as { status: string }).status).toBe("failed");

    const storedLogs = (await kv.get("RULE_LOGS::123456789", "text")) as string;
    expect(storedLogs).toContain("AUTOMATION_RUN_FAILED");
  });

  it("blocks all live mutations when joined campaign insight row is missing", async () => {
    const kv = new FakeKVNamespace();
    const db = env.AUDIT_DB!;

    await kv.put(
      "RULE_CONFIG::123456789",
      JSON.stringify(
        createConfig({
          dryRun: false,
          allowlistCampaignIds: ["camp_1"],
        })
      )
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if ((init?.method ?? "GET") === "POST") {
        throw new Error("missing joined row must block all live mutations");
      }

      if (url.includes("/campaigns?fields=id,name,status")) {
        return jsonResponse({
          data: [{ id: "camp_1", name: "Campaign 1", status: "ACTIVE" }],
        });
      }

      if (url.includes("/insights?") && url.includes("level=campaign")) {
        return jsonResponse({
          data: [],
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const ctx = createExecutionContext();
    await worker.scheduled(
      {} as ScheduledController,
      createEnv({ CONFIG_KV: kv as unknown as Env["CONFIG_KV"], AUDIT_DB: db }),
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);

    const runs = await db.prepare("SELECT status, errorJson FROM automation_runs").all();
    expect(runs.results).toHaveLength(1);
    expect((runs.results[0] as { status: string }).status).toBe("failed");
    expect(String((runs.results[0] as { errorJson: string | null }).errorJson)).toContain("AUTOMATION_RUN_FAILED");
  });


  it("requires tool-paused provenance before live resume", async () => {
    const fetchMock = vi.fn(async () => {
      return jsonResponse({ data: { success: true } });
    });

    vi.stubGlobal("fetch", fetchMock);

    const row: CampaignDecisionRow = {
      id: "camp_paused",
      name: "Paused Campaign",
      status: "PAUSED",
      decision: "RESUME",
      why: ["Spend is below resume threshold with omni_purchase evidence."],
      evidence: {
        spendToday: 100,
        purchasesToday: 1,
        purchases3d: 3,
        purchaseMetric: "omni_purchase",
        dataState: "complete",
        dryRun: false,
        cooldownHours: 24,
        maxActionsPerRun: 1,
        maxActionsPerDay: 1,
        allowlisted: true,
        excluded: false,
        emergencyStop: false,
        armingStatus: "armed",
        reliabilityScore: 0.9,
      },
      blockers: [],
      campaignSnapshot: {
        id: "camp_paused",
        name: "Paused Campaign",
        status: "PAUSED",
        spendToday: 100,
        purchasesToday: 1,
        purchases3d: 3,
        purchaseMetric: "omni_purchase",
        hasPurchaseMetric: true,
        dataState: "complete",
      },
      warnings: [],
      error: null,
      insights: {
        spend: 100,
        purchases: 1,
        purchaseMetric: "omni_purchase",
        hasPurchaseMetric: true,
        dataState: "complete",
      },
    };

    const execution = await executeCampaignActions(createEnv(), [row], { runId: "run-live-1" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(execution.actions).toHaveLength(0);
    expect(execution.logs).toHaveLength(1);
    expect(execution.logs[0].status).toBe("skipped");
    expect(execution.logs[0].decision).toBe("RESUME");
    expect(execution.logs[0].blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PROVENANCE_REQUIRED",
        }),
      ])
    );
  });

  it("allows live resume when pausedByTool provenance exists", async () => {
    const db = env.AUDIT_DB!;
    await db
      .prepare("INSERT INTO campaign_states (campaignId, lastDecision, lastAction, lastActionAt, lastRunId, pausedByTool) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("camp_paused", "PAUSE", "PAUSE", "2026-05-01T00:00:00.000Z", "run-previous", 1)
      .run();

    const fetchMock = vi.fn(async () => {
      return jsonResponse({ data: { success: true } });
    });

    vi.stubGlobal("fetch", fetchMock);

    const row: CampaignDecisionRow = {
      id: "camp_paused",
      name: "Paused Campaign",
      status: "PAUSED",
      decision: "RESUME",
      why: ["Spend is below resume threshold with omni_purchase evidence."],
      evidence: {
        spendToday: 100,
        purchasesToday: 1,
        purchases3d: 3,
        purchaseMetric: "omni_purchase",
        dataState: "complete",
        dryRun: false,
        cooldownHours: 24,
        maxActionsPerRun: 1,
        maxActionsPerDay: 1,
        allowlisted: true,
        excluded: false,
        emergencyStop: false,
        armingStatus: "armed",
        reliabilityScore: 0.9,
      },
      blockers: [],
      campaignSnapshot: {
        id: "camp_paused",
        name: "Paused Campaign",
        status: "PAUSED",
        spendToday: 100,
        purchasesToday: 1,
        purchases3d: 3,
        purchaseMetric: "omni_purchase",
        hasPurchaseMetric: true,
        dataState: "complete",
      },
      warnings: [],
      error: null,
      insights: {
        spend: 100,
        purchases: 1,
        purchaseMetric: "omni_purchase",
        hasPurchaseMetric: true,
        dataState: "complete",
      },
    };

    const execution = await executeCampaignActions(createEnv({ AUDIT_DB: db }), [row], { runId: "run-live-2" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(execution.actions).toHaveLength(1);
    expect(execution.actions[0].action).toBe("RESUME");
    expect(execution.logs).toHaveLength(1);
    expect(execution.logs[0].status).toBe("applied");
  });
});
