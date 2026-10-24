/**
 * Thin client for the Garmin Connect Personal API (read-only, GET only).
 * Endpoint paths follow Garmin's official client: github.com/garmin/connect-personal-api-python
 */
import { BASE_URL, PACKAGE_NAME, REQUEST_TIMEOUT_MS, VERSION } from "./constants.js";
import { TokenManager } from "./auth.js";
import { keyFixHint } from "./keystore.js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Params = Record<string, string | number | boolean | undefined>;

export class GarminApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail?: string,
  ) {
    super(httpErrorMessage(status, path, detail));
    this.name = "GarminApiError";
  }
}

function httpErrorMessage(status: number, path: string, detail?: string): string {
  switch (status) {
    case 400:
      return `Garmin rejected the request for ${path} (HTTP 400). Check the dates are YYYY-MM-DD and the range is not too long.${detail ? ` Garmin said: ${detail.slice(0, 200)}` : ""}`;
    case 401:
    case 403:
      return `Garmin rejected the Personal API key. It has probably expired or been deleted. Ask the user to ${keyFixHint()}.`;
    case 404:
      return `Not found: ${path}. The ID may be wrong, or the Personal API does not expose this endpoint. Use garmin_list_activities to find valid activity IDs.`;
    case 429:
      return "Garmin's rate limit was hit. Wait a minute, then retry with a narrower date range.";
    default:
      return status >= 500
        ? `Garmin's servers returned HTTP ${status}. This is usually temporary; try again shortly.`
        : `Garmin returned HTTP ${status} for ${path}.`;
  }
}

/** Paths the raw tool may call. Mirrors the documented Personal API services. */
export const ALLOWED_PATH_PREFIXES = [
  "/activity-service/",
  "/activitylist-service/",
  "/biometric-service/",
  "/fitnessage-service/",
  "/goal-service/",
  "/hrv-service/",
  "/nutrition-service/",
  "/periodichealth-service/",
  "/sleep-service/",
  "/usersummary-service/",
  "/userprofile-service/",
  "/weight-service/",
  "/wellness-service/",
  "/wellnessactivity-service/",
] as const;

export class GarminClient {
  constructor(private readonly tokens: TokenManager) {}

  private async request(path: string, params: Params | undefined, accept: string, signal?: AbortSignal): Promise<Response> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const send = async (force: boolean) => {
      const token = await this.tokens.getToken(force, signal);
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      try {
        return await fetch(url, {
          headers: {
            Accept: accept,
            Authorization: `Bearer ${token}`,
            "User-Agent": `${PACKAGE_NAME}/${VERSION}`,
          },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          throw new Error(`Garmin did not respond within ${REQUEST_TIMEOUT_MS / 1000}s for ${path}. Try again or narrow the date range.`);
        }
        throw err;
      }
    };

    let res = await send(false);
    // A token can be revoked before its exp; retry once with a fresh one.
    if (res.status === 401) res = await send(true);
    if (!res.ok) throw new GarminApiError(res.status, path, await res.text().catch(() => undefined));
    return res;
  }

  async get(path: string, params?: Params, signal?: AbortSignal): Promise<Json> {
    const res = await this.request(path, params, "application/json", signal);
    const text = await res.text();
    return text ? (JSON.parse(text) as Json) : null;
  }

  async getBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    const res = await this.request(path, undefined, "application/zip, application/x-zip-compressed, application/octet-stream", signal);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ---- Profile ----
  profileSettings = (s?: AbortSignal) => this.get("/userprofile-service/userprofile/settings", undefined, s);
  heartRateZones = (s?: AbortSignal) => this.get("/biometric-service/heartRateZones/v2", undefined, s);

  // ---- Activities ----
  searchActivities = (
    p: { start?: number; limit?: number; startDate?: string; endDate?: string; activityType?: string },
    s?: AbortSignal,
  ) =>
    this.get(
      "/activitylist-service/activities/search/activities",
      { start: p.start ?? 0, limit: p.limit ?? 20, startDate: p.startDate, endDate: p.endDate, activityType: p.activityType },
      s,
    );
  activity = (id: string, s?: AbortSignal) => this.get(`/activity-service/activity/${id}`, undefined, s);
  activityWorkouts = (id: string, s?: AbortSignal) => this.get(`/activity-service/activity/${id}/workouts`, undefined, s);
  downloadActivity = (id: string, s?: AbortSignal) => this.getBytes(`/download-service/files/activity/${id}`, s);

  // ---- Single-day wellness ----
  dailySleep = (date: string, s?: AbortSignal) => this.get("/sleep-service/sleep/dailySleep", { date }, s);
  dailyHrv = (date: string, s?: AbortSignal) => this.get(`/hrv-service/hrv/${date}`, undefined, s);
  dailyHeartRate = (date: string, s?: AbortSignal) => this.get("/wellness-service/wellness/dailyHeartRate", { date }, s);
  dailySpo2 = (date: string, s?: AbortSignal) => this.get(`/wellness-service/wellness/daily/spo2acclimation/${date}`, undefined, s);
  fitnessAge = (date: string, s?: AbortSignal) => this.get(`/fitnessage-service/fitnessage/v2/${date}`, undefined, s);
  foodLogs = (date: string, s?: AbortSignal) => this.get(`/nutrition-service/food/logs/${date}`, undefined, s);

  // ---- Date ranges (chunked by the caller; see rangeEndpoints) ----
  range = (name: RangeEndpoint, start: string, end: string, s?: AbortSignal) => {
    const e: RangeSpec = RANGE_ENDPOINTS[name];
    return this.get(e.path(start, end), e.params?.(start, end), s);
  };
}

interface RangeSpec {
  path: (start: string, end: string) => string;
  params?: (start: string, end: string) => Params;
  /** Longest range one request accepts. Conservative where Garmin hasn't documented it. */
  maxDays: number;
}

export const RANGE_ENDPOINTS = {
  dailySummaries: {
    path: () => "/usersummary-service/v2/dailysummaries",
    params: (startDate, endDate) => ({ startDate, endDate }),
    maxDays: 28,
  },
  steps: { path: (a, b) => `/usersummary-service/stats/steps/daily/${a}/${b}`, maxDays: 28 },
  stress: { path: (a, b) => `/usersummary-service/stats/stress/daily/${a}/${b}`, maxDays: 28 },
  hydration: { path: (a, b) => `/usersummary-service/stats/hydration/daily/${a}/${b}`, maxDays: 28 },
  sleep: {
    path: () => "/sleep-service/sleep/dailySleepSummariesByDate",
    params: (startDate, endDate) => ({ startDate, endDate }),
    maxDays: 31,
  },
  hrv: { path: (a, b) => `/hrv-service/hrv/daily/${a}/${b}`, maxDays: 28 },
  bodyBattery: {
    path: () => "/wellness-service/wellness/bodyBattery/reports/daily",
    params: (startDate, endDate) => ({ startDate, endDate }),
    maxDays: 28,
  },
  weight: {
    path: (a, b) => `/weight-service/weight/range/${a}/${b}`,
    params: () => ({ includeAll: "true" }),
    maxDays: 90,
  },
  weightGoals: { path: (a, b) => `/goal-service/goal/user/effective/weightgoal/${a}/${b}`, maxDays: 90 },
  wellnessActivities: { path: (a, b) => `/wellnessactivity-service/activity/summary/range/${a}/${b}`, maxDays: 28 },
} satisfies Record<string, RangeSpec>;

export type RangeEndpoint = keyof typeof RANGE_ENDPOINTS;

/** Splits [start, end] (inclusive, YYYY-MM-DD) into consecutive windows of at most maxDays. */
export function chunkRange(start: string, end: string, maxDays: number): [string, string][] {
  const out: [string, string][] = [];
  let cur = parseDate(start);
  const last = parseDate(end);
  while (cur <= last) {
    const stop = new Date(Math.min(addDays(cur, maxDays - 1).getTime(), last.getTime()));
    out.push([fmtDate(cur), fmtDate(stop)]);
    cur = addDays(stop, 1);
  }
  return out;
}

/**
 * Fetches a range endpoint in chunks and merges the results: arrays are concatenated,
 * objects with a single array field (e.g. `{ data: [...] }`) have that field concatenated,
 * anything else comes back as a list of per-chunk results.
 */
export async function fetchRange(client: GarminClient, name: RangeEndpoint, start: string, end: string, signal?: AbortSignal): Promise<Json> {
  const chunks = chunkRange(start, end, RANGE_ENDPOINTS[name].maxDays);
  const results: Json[] = [];
  for (const [a, b] of chunks) results.push(await client.range(name, a, b, signal));
  if (results.length === 1) return results[0];
  if (results.every(Array.isArray)) return (results as Json[][]).flat();
  const objs = results.filter((r): r is { [k: string]: Json } => !!r && typeof r === "object" && !Array.isArray(r));
  if (objs.length === results.length) {
    const arrayKeys = Object.keys(objs[0]).filter((k) => Array.isArray(objs[0][k]));
    if (arrayKeys.length === 1) {
      const k = arrayKeys[0];
      return { ...objs[0], [k]: objs.flatMap((o) => (Array.isArray(o[k]) ? (o[k] as Json[]) : [])) };
    }
  }
  return results;
}

// ---- Dates ----

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Accepts YYYY-MM-DD, "today", "yesterday" or "N days ago", in the machine's local time zone. */
export function resolveDate(input: string, now = new Date()): string {
  const s = input.trim().toLowerCase();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  const today = fmtDate(local);
  if (s === "today") return today;
  if (s === "yesterday") return fmtDate(addDays(parseDate(today), -1));
  const ago = /^(\d+)\s*days?\s*ago$/.exec(s);
  if (ago) return fmtDate(addDays(parseDate(today), -Number(ago[1])));
  if (DATE_RE.test(s) && !Number.isNaN(parseDate(s).getTime())) return s;
  throw new Error(`"${input}" is not a date. Use YYYY-MM-DD, "today", "yesterday" or "N days ago".`);
}

export function resolveRange(start: string, end: string | undefined): [string, string] {
  const a = resolveDate(start);
  const b = resolveDate(end ?? "today");
  if (a > b) throw new Error(`start_date ${a} is after end_date ${b}. Swap them.`);
  const days = (parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000 + 1;
  if (days > 366) throw new Error(`That range is ${days} days. Ask for at most 366 days at a time.`);
  return [a, b];
}
