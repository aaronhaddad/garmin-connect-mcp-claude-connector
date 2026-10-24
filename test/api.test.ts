import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkRange, fetchRange, GarminApiError, GarminClient, resolveDate, resolveRange } from "../src/api.js";
import { jwtExpiry, TokenManager } from "../src/auth.js";
import { compact, fitJson } from "../src/format.js";

const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp, scope: ["PERSONAL_API_FITNESS_READ"] })).toString("base64url")}.y`;

describe("dates", () => {
  const now = new Date("2026-10-24T10:00:00");
  it("resolves relative dates", () => {
    expect(resolveDate("today", now)).toBe("2026-10-24");
    expect(resolveDate("yesterday", now)).toBe("2026-10-23");
    expect(resolveDate("7 days ago", now)).toBe("2026-10-17");
    expect(resolveDate("2026-01-05", now)).toBe("2026-01-05");
    expect(() => resolveDate("last tuesday", now)).toThrow(/not a date/);
  });
  it("validates ranges", () => {
    expect(() => resolveRange("2026-10-10", "2026-10-01")).toThrow(/after/);
    expect(() => resolveRange("2024-01-01", "2026-01-01")).toThrow(/366/);
  });
  it("chunks long ranges inclusively", () => {
    expect(chunkRange("2026-01-01", "2026-03-01", 28)).toEqual([
      ["2026-01-01", "2026-01-28"],
      ["2026-01-29", "2026-02-25"],
      ["2026-02-26", "2026-03-01"],
    ]);
    expect(chunkRange("2026-05-05", "2026-05-05", 28)).toEqual([["2026-05-05", "2026-05-05"]]);
  });
});

describe("GarminClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const tokenRes = () => new Response(jwt(Math.floor(Date.now() / 1000) + 86_400), { status: 200 });

  it("exchanges the key once and sends a bearer token", async () => {
    fetchMock.mockResolvedValueOnce(tokenRes()).mockImplementation(async () => new Response(JSON.stringify([{ activityId: 1 }])));
    const client = new GarminClient(new TokenManager(() => "k".repeat(32), null));
    await client.searchActivities({ limit: 1 });
    await client.searchActivities({ limit: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [tokUrl, tokInit] = fetchMock.mock.calls[0];
    expect(String(tokUrl)).toMatch(/personal-api-key\/token$/);
    expect(tokInit.headers.Authorization).toBe(`ApiKey ${"k".repeat(32)}`);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toMatch(/^Bearer x\./);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/activitylist-service/activities/search/activities?start=0&limit=1");
  });

  it("refreshes the token once on 401", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const client = new GarminClient(new TokenManager(() => "k".repeat(32), null));
    await expect(client.profileSettings()).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("turns HTTP errors into actionable messages", async () => {
    fetchMock.mockResolvedValueOnce(tokenRes()).mockImplementation(async () => new Response("nope", { status: 404 }));
    const client = new GarminClient(new TokenManager(() => "k".repeat(32), null));
    const err = await client.activity("9").catch((e) => e);
    expect(err).toBeInstanceOf(GarminApiError);
    expect(err.message).toMatch(/garmin_list_activities/);
  });

  it("merges chunked range results", async () => {
    fetchMock.mockResolvedValueOnce(tokenRes());
    fetchMock.mockImplementation(async (url: URL) => new Response(JSON.stringify([{ from: url.pathname.split("/").slice(-2)[0] }])));
    const client = new GarminClient(new TokenManager(() => "k".repeat(32), null));
    const out = await fetchRange(client, "steps", "2026-01-01", "2026-02-15");
    expect(out).toEqual([{ from: "2026-01-01" }, { from: "2026-01-29" }]);
  });
});

describe("auth helpers", () => {
  it("reads the JWT exp claim", () => {
    expect(jwtExpiry(jwt(1_800_000_000))).toBe(1_800_000_000_000);
  });
});

describe("response sizing", () => {
  it("drops nulls", () => {
    expect(compact({ a: null, b: 0, c: { d: "", e: [1, null] } })).toEqual({ b: 0, c: { e: [1, null] } });
  });
  it("downsamples long arrays to fit the limit", () => {
    const big = { samples: Array.from({ length: 5000 }, (_, i) => [i, 60 + (i % 40)]) };
    const out = fitJson(big, 5000);
    expect(out.downsampled).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(5000);
  });
});
