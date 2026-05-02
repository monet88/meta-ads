import { afterEach, describe, expect, it, vi } from "vitest";

import { extractPurchaseCount, fetchActiveCampaigns, pauseCampaign, resumeCampaign } from "../src/meta-api-client";
import type { Env } from "../src/types";

function createEnv(): Env {
  return {
    META_ACCESS_TOKEN: "meta-test-token",
    META_ACCOUNT_ID: "123456789",
    CONFIG_KV: {} as Env["CONFIG_KV"],
  };
}

describe("meta api client auth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses Authorization Bearer header without access_token in URL for campaign fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await fetchActiveCampaigns(createEnv());

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];

    expect(url).toContain("https://graph.facebook.com/v21.0/act_123456789/campaigns");
    expect(url).not.toContain("access_token=");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer meta-test-token",
    });
  });

  it("loads all campaign pages from paging.next", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "camp_1", name: "Campaign 1", status: "ACTIVE" }],
            paging: {
              next: "https://graph.facebook.com/v21.0/act_123456789/campaigns?after=cursor_1",
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "camp_2", name: "Campaign 2", status: "PAUSED" }],
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const campaigns = await fetchActiveCampaigns(createEnv());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(campaigns).toEqual([
      { id: "camp_1", name: "Campaign 1", status: "ACTIVE" },
      { id: "camp_2", name: "Campaign 2", status: "PAUSED" },
    ]);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit | undefined];

    expect(firstUrl).toContain("/campaigns");
    expect(secondUrl).toContain("after=cursor_1");
    expect(firstInit?.headers).toMatchObject({ Authorization: "Bearer meta-test-token" });
    expect(secondInit?.headers).toMatchObject({ Authorization: "Bearer meta-test-token" });
  });

  it("counts omni_purchase when present", () => {
    const purchases = extractPurchaseCount([
      { action_type: "purchase", value: "9" },
      { action_type: "omni_purchase", value: "2" },
    ]);

    expect(purchases).toBe(2);
  });

  it("does not fallback to purchase when omni_purchase is missing", () => {
    const purchases = extractPurchaseCount([
      { action_type: "purchase", value: "9" },
    ]);

    expect(purchases).toBe(0);
  });

  it("uses Authorization Bearer header without access_token in pause body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { success: true } }), {
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await pauseCampaign(createEnv(), "camp_1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("https://graph.facebook.com/v21.0/camp_1");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer meta-test-token",
      "Content-Type": "application/json",
    });
    expect(String(init?.body)).not.toContain("access_token");
    expect(String(init?.body)).toContain('"status":"PAUSED"');
  });

  it("uses Authorization Bearer header without access_token in resume body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { success: true } }), {
        headers: {
          "Content-Type": "application/json",
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await resumeCampaign(createEnv(), "camp_2");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("https://graph.facebook.com/v21.0/camp_2");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer meta-test-token",
      "Content-Type": "application/json",
    });
    expect(String(init?.body)).not.toContain("access_token");
    expect(String(init?.body)).toContain('"status":"ACTIVE"');
  });
});
