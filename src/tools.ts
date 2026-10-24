import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  ALLOWED_PATH_PREFIXES,
  fetchRange,
  type GarminClient,
  type Json,
  type RangeEndpoint,
  resolveDate,
  resolveRange,
} from "./api.js";
import { decodeFit, extractFit, fmtDuration, fmtPace, type PerformanceMetrics, performanceMetrics, summarizeFit } from "./fit.js";
import { activityLine, isObj, jsonResult, summarizeActivity, textResult } from "./format.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const DateArg = z
  .string()
  .min(1)
  .describe('Date as YYYY-MM-DD, or "today", "yesterday", "N days ago" (local time)');
const StartArg = DateArg.describe('First day, inclusive: YYYY-MM-DD, "today", "yesterday" or "N days ago"');
const EndArg = z.string().optional().describe('Last day, inclusive. Defaults to today. Same formats as start_date');
const ActivityId = z
  .union([z.string().regex(/^\d+$/), z.number().int().positive()])
  .transform(String)
  .describe("Numeric Garmin activity ID, from garmin_list_activities");
const Format = z.enum(["markdown", "json"]).default("markdown").describe("'markdown' for a readable summary, 'json' for every field");

export function registerTools(server: McpServer, client: GarminClient): void {
  // ---------------- Profile ----------------
  server.registerTool(
    "garmin_get_profile",
    {
      title: "Profile & heart-rate zones",
      description:
        "The user's Garmin profile settings (units, weight, height, birth year, lactate threshold where set) plus their heart-rate zones. Call this first when you need zones or units to interpret other data.",
      inputSchema: z.strictObject({}),
      annotations: READ_ONLY,
    },
    async (_args, ctx) => {
      const s = ctx.mcpReq.signal;
      const [profile, zones] = await Promise.all([client.profileSettings(s), client.heartRateZones(s).catch((e: Error) => ({ error: e.message }))]);
      return jsonResult({ profile, heart_rate_zones: zones as Json });
    },
  );

  // ---------------- Activities ----------------
  server.registerTool(
    "garmin_list_activities",
    {
      title: "List activities",
      description: `List recorded activities (runs, gym sessions, rides…), newest first, with distance, time, pace and heart rate.

Examples:
  - "my runs this month" -> start_date="2026-10-01", activity_type="running"
  - "last 5 activities" -> limit=5
Use garmin_get_activity_splits on an activity_id for per-km splits and pacing.`,
      inputSchema: z.strictObject({
        start_date: z.string().optional().describe("Only activities on/after this day (YYYY-MM-DD, 'today', 'N days ago')"),
        end_date: z.string().optional().describe("Only activities on/before this day"),
        activity_type: z
          .string()
          .optional()
          .describe("Garmin type key, e.g. running, treadmill_running, trail_running, cycling, indoor_cycling, strength_training, walking"),
        limit: z.number().int().min(1).max(100).default(20).describe("Max activities to return"),
        offset: z.number().int().min(0).default(0).describe("Skip this many, for paging"),
        response_format: Format,
      }),
      annotations: READ_ONLY,
    },
    async ({ start_date, end_date, activity_type, limit, offset, response_format }, ctx) => {
      const raw = await client.searchActivities(
        {
          start: offset,
          limit,
          startDate: start_date ? resolveDate(start_date) : undefined,
          endDate: end_date ? resolveDate(end_date) : undefined,
          activityType: activity_type,
        },
        ctx.mcpReq.signal,
      );
      const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.activityList) ? raw.activityList : [];
      if (response_format === "json") return jsonResult({ offset, count: list.length, has_more: list.length === limit, activities: list });
      const items = list.map(summarizeActivity).filter((a) => a !== undefined);
      if (!items.length) return textResult("No activities match. Widen the date range or drop activity_type.");
      const lines = [`# ${items.length} activities`, "", ...items.map(activityLine)];
      if (list.length === limit) lines.push("", `More may exist: call again with offset=${offset + limit}.`);
      return textResult(lines.join("\n"));
    },
  );

  server.registerTool(
    "garmin_get_activity",
    {
      title: "Activity details",
      description:
        "Garmin's computed summary for one activity: distance, durations, pace/speed, HR, cadence, elevation, training effect, calories. For per-km splits use garmin_get_activity_splits.",
      inputSchema: z.strictObject({ activity_id: ActivityId, response_format: Format }),
      annotations: READ_ONLY,
    },
    async ({ activity_id, response_format }, ctx) => {
      const raw = await client.activity(activity_id, ctx.mcpReq.signal);
      if (response_format === "json") return jsonResult(raw);
      const a = summarizeActivity(raw);
      if (!a) return jsonResult(raw, "Could not summarise this activity; raw data follows.");
      return textResult(
        [
          `# ${a.name ?? "Activity"} (${a.type ?? "?"})`,
          ...Object.entries(a)
            .filter(([k, v]) => v !== undefined && k !== "name" && k !== "type")
            .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`),
          "",
          "Call again with response_format='json' for every field Garmin returns.",
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "garmin_get_activity_splits",
    {
      title: "Splits & pacing analysis",
      description: `Downloads the original .FIT recording and computes exact distance splits (default 1 km, interpolated at each boundary, pauses excluded), per-split HR, cadence and climb, the device laps, and a pacing verdict (even, negative split, faded).

Use this for "how was my pacing", "did I go out too fast", "compare km 1 to km 5". Works for any GPS or footpod activity recorded on a Garmin device.`,
      inputSchema: z.strictObject({
        activity_id: ActivityId,
        split_meters: z.number().int().min(100).max(10_000).default(1000).describe("Split length in metres: 1000 for km, 1609 for miles, 400 for track laps"),
        response_format: Format,
      }),
      annotations: READ_ONLY,
    },
    async ({ activity_id, split_meters, response_format }, ctx) => {
      const bytes = await client.downloadActivity(activity_id, ctx.mcpReq.signal);
      const summary = summarizeFit(extractFit(bytes), split_meters);
      if (response_format === "json") return jsonResult(summary as unknown as Json);
      const s = summary.session;
      const unit = split_meters === 1000 ? "km" : `${split_meters} m`;
      const lines = [`# Activity ${activity_id}${s?.sport ? ` (${s.sport})` : ""}`];
      if (s) {
        lines.push(
          [
            s.distance_m !== undefined ? `${(s.distance_m / 1000).toFixed(2)} km` : undefined,
            `moving ${fmtDuration(s.timer_s)}`,
            s.distance_m && s.timer_s ? `avg ${fmtPace((s.timer_s / s.distance_m) * 1000)}` : undefined,
            s.avg_hr ? `HR ${s.avg_hr} avg / ${s.max_hr} max` : undefined,
            s.avg_cadence ? `cadence ${Math.round(s.avg_cadence)}` : undefined,
            s.total_ascent_m ? `+${s.total_ascent_m} m` : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
        );
      }
      if (summary.paused_s > 5) lines.push(`Paused ${fmtDuration(summary.paused_s)} (excluded from split times).`);
      lines.push("", `| ${unit} | dist | time | pace | avg HR | max HR | cadence | climb |`, "|---|---|---|---|---|---|---|---|");
      for (const sp of summary.splits) {
        lines.push(
          `| ${sp.index}${sp.partial ? "*" : ""} | ${(sp.distance_m / 1000).toFixed(2)} | ${fmtDuration(sp.moving_s)} | ${fmtPace(sp.pace_s_per_km)} | ${sp.avg_hr ?? "–"} | ${sp.max_hr ?? "–"} | ${sp.avg_cadence ?? "–"} | ${sp.elev_gain_m !== undefined ? `+${sp.elev_gain_m}` : "–"} |`,
        );
      }
      if (summary.splits.some((x) => x.partial)) lines.push("", "\\* partial split");
      const p = summary.pacing;
      if (p) {
        lines.push(
          "",
          "## Pacing",
          `- ${p.verdict}`,
          `- First ${fmtPace(p.first_split_pace_s_per_km)}, last ${fmtPace(p.last_split_pace_s_per_km)}; fastest split ${p.fastest_split}, slowest ${p.slowest_split}`,
          `- Second half vs first half: ${p.half_split_delta_s_per_km > 0 ? "+" : ""}${p.half_split_delta_s_per_km} s/km`,
          `- Split-to-split variability: ${p.pace_variability_pct}% (under 3% is very even)`,
        );
      }
      if (summary.laps.length > 1) {
        lines.push("", "## Device laps", "| lap | dist | time | pace | avg HR |", "|---|---|---|---|---|");
        for (const l of summary.laps) {
          lines.push(`| ${l.index} | ${(l.distance_m / 1000).toFixed(2)} | ${fmtDuration(l.timer_s)} | ${fmtPace(l.pace_s_per_km)} | ${l.avg_hr ?? "–"} |`);
        }
      }
      if (!summary.splits.length) lines.push("", "No distance data in this recording (e.g. a gym session), so there are no splits.");
      return textResult(lines.join("\n"));
    },
  );

  server.registerTool(
    "garmin_get_performance_metrics",
    {
      title: "VO2 max, training effect & recovery",
      description: `Garmin's own VO2 max, read the way Garmin Connect shows it, plus per-activity aerobic/anaerobic training effect, recovery time and performance condition. Decoded from the original .FIT files, since the Personal API has no VO2 max endpoint.

Returns the current VO2 max (whole number, as Garmin's apps round it, plus the precise value), every new VO2 max reading in the window (Garmin only updates it on qualifying runs and power-meter rides), and a row per activity.

Examples:
  - "what's my VO2 max?" / "how is my VO2 max trending?" -> last_n=20
  - "how hard was today's workout, how long to recover?" -> last_n=1
Each activity costs one file download, so keep last_n small unless a trend is asked for.`,
      inputSchema: z.strictObject({
        activity_id: ActivityId.optional().describe("One activity, from garmin_list_activities. Omit to scan recent activities"),
        last_n: z.number().int().min(1).max(30).default(10).describe("How many recent activities to scan (all types)"),
        activity_type: z.string().optional().describe("Only this Garmin type key, e.g. running, cycling"),
        response_format: Format,
      }),
      annotations: READ_ONLY,
    },
    async ({ activity_id, last_n, activity_type, response_format }, ctx) => {
      const signal = ctx.mcpReq.signal;
      const targets: { id: string; name?: string; type?: string; start?: string }[] = [];
      if (activity_id) {
        const a = summarizeActivity(await client.activity(activity_id, signal));
        targets.push({ id: activity_id, name: a?.name, type: a?.type, start: a?.start_local });
      } else {
        const raw = await client.searchActivities({ limit: last_n, activityType: activity_type }, signal);
        const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.activityList) ? raw.activityList : [];
        for (const a of list.map(summarizeActivity)) if (a) targets.push({ id: String(a.activity_id), name: a.name, type: a.type, start: a.start_local });
      }
      const rows = await mapLimit(targets, 3, async (t) => {
        try {
          return { ...t, m: performanceMetrics(decodeFit(extractFit(await client.downloadActivity(t.id, signal)))) };
        } catch (e) {
          return { ...t, skipped: (e as Error).message };
        }
      });
      const ok = rows.filter((r): r is typeof r & { m: PerformanceMetrics } => "m" in r && !!r.m);
      const readings = ok.filter((r) => r.m.new_vo2max_reading && r.m.vo2max_after);
      const newest = ok[0];
      const current = newest?.m.new_vo2max_reading ? newest.m.vo2max_after : (newest?.m.vo2max_before ?? readings[0]?.m.vo2max_after);
      const result = {
        vo2max: current === undefined ? undefined : { value: Math.round(current), precise: current, as_of: newest?.start?.slice(0, 10), last_reading: readings[0]?.start?.slice(0, 10) },
        vo2max_readings: readings.map((r) => ({
          date: r.start?.slice(0, 10),
          activity_id: r.id,
          type: r.type,
          vo2max: Math.round(r.m.vo2max_after!),
          precise: r.m.vo2max_after,
          change: r.m.vo2max_before !== undefined ? Math.round((r.m.vo2max_after! - r.m.vo2max_before) * 100) / 100 : undefined,
        })),
        activities: ok.map((r) => ({ date: r.start, activity_id: r.id, name: r.name, type: r.type, ...r.m })),
        skipped: rows.filter((r) => "skipped" in r).map((r) => ({ activity_id: r.id, type: r.type, reason: (r as { skipped: string }).skipped })),
        note: "VO2 max and training effect match Garmin Connect. Recovery time and performance condition come from undocumented FIT fields; treat them as approximate.",
      };
      if (response_format === "json") return jsonResult(result as unknown as Json);

      const lines: string[] = [];
      if (result.vo2max) {
        const v = result.vo2max;
        lines.push(`# VO2 max: ${v.value} ml/kg/min`, `Precise ${v.precise.toFixed(2)} as of ${v.as_of}${v.last_reading ? `; last updated by the ${v.last_reading} activity` : "; no new reading in this window"}.`);
      } else {
        lines.push("# VO2 max: not available", "None of these activities carry a VO2 max. Garmin needs a qualifying outdoor run (or a ride with a power meter) to estimate one.");
      }
      if (result.vo2max_readings.length) {
        lines.push("", "## VO2 max readings", "| date | activity | VO2 max | change |", "|---|---|---|---|");
        for (const r of result.vo2max_readings) lines.push(`| ${r.date} | ${r.type ?? "?"} | ${r.vo2max} (${r.precise?.toFixed(2)}) | ${r.change === undefined ? "–" : `${r.change > 0 ? "+" : ""}${r.change.toFixed(2)}`} |`);
      }
      if (ok.length) {
        lines.push("", "## Per activity", "| date | activity | aerobic TE | anaerobic TE | recovery | perf. condition |", "|---|---|---|---|---|---|");
        for (const r of ok) {
          const m = r.m;
          lines.push(`| ${r.start?.slice(0, 16) ?? "?"} | ${r.name ?? r.type ?? r.id} | ${m.training_effect_aerobic ?? "–"} | ${m.training_effect_anaerobic ?? "–"} | ${m.recovery_time_h !== undefined ? `${m.recovery_time_h} h` : "–"} | ${m.performance_condition !== undefined ? `${m.performance_condition > 0 ? "+" : ""}${m.performance_condition}` : "–"} |`);
        }
      }
      if (result.skipped.length) lines.push("", `Skipped ${result.skipped.length} without a FIT file (e.g. manual entries): ${result.skipped.map((s) => s.type ?? s.activity_id).join(", ")}.`);
      lines.push("", `_${result.note}_`);
      return textResult(lines.join("\n"));
    },
  );

  server.registerTool(
    "garmin_download_activity_fit",
    {
      title: "Save original activity file",
      description:
        "Saves an activity's original file (Garmin's ZIP containing the .fit) to a folder on this computer, for import into other tools such as Runalyze or Golden Cheetah. Returns the saved path.",
      inputSchema: z.strictObject({
        activity_id: ActivityId,
        directory: z.string().optional().describe("Folder to save into. Defaults to ~/Downloads/garmin"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ activity_id, directory }, ctx) => {
      const bytes = await client.downloadActivity(activity_id, ctx.mcpReq.signal);
      const dir = resolve((directory ?? join(homedir(), "Downloads", "garmin")).replace(/^~(?=$|\/)/, homedir()));
      mkdirSync(dir, { recursive: true });
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const file = join(dir, `${activity_id}.${isZip ? "zip" : "fit"}`);
      writeFileSync(file, bytes);
      return textResult(`Saved ${(bytes.length / 1024).toFixed(0)} KB to ${file}`);
    },
  );

  // ---------------- Day overview ----------------
  server.registerTool(
    "garmin_get_day",
    {
      title: "One day at a glance",
      description:
        "Everything for one day in one call: daily summary (steps, calories, resting HR, stress, intensity minutes), sleep, overnight HRV, Body Battery and activities. Best first call for 'how recovered am I today' or 'how was yesterday'. Parts Garmin has no data for are omitted.",
      inputSchema: z.strictObject({ date: DateArg.default("today") }),
      annotations: READ_ONLY,
    },
    async ({ date }, ctx) => {
      const d = resolveDate(date);
      const s = ctx.mcpReq.signal;
      const settle = async (p: Promise<Json>) => p.catch((e: Error) => ({ unavailable: e.message }) as Json);
      const [summary, sleep, hrv, bodyBattery, activities] = await Promise.all([
        settle(client.range("dailySummaries", d, d, s)),
        settle(client.dailySleep(d, s)),
        settle(client.dailyHrv(d, s)),
        settle(client.range("bodyBattery", d, d, s)),
        settle(client.searchActivities({ startDate: d, endDate: d, limit: 20 }, s)),
      ]);
      const acts = (Array.isArray(activities) ? activities : []).map(summarizeActivity).filter(Boolean) as unknown as Json[];
      return jsonResult({ date: d, daily_summary: summary, sleep, hrv, body_battery: bodyBattery, activities: acts.length ? acts : activities });
    },
  );

  // ---------------- Ranges ----------------
  const rangeTool = (name: string, endpoint: RangeEndpoint, title: string, description: string) =>
    server.registerTool(
      name,
      {
        title,
        description: `${description}\n\nLong ranges are fetched in chunks automatically (up to 366 days).`,
        inputSchema: z.strictObject({ start_date: StartArg, end_date: EndArg }),
        annotations: READ_ONLY,
      },
      async ({ start_date, end_date }, ctx) => {
        const [a, b] = resolveRange(start_date, end_date);
        return jsonResult(await fetchRange(client, endpoint, a, b, ctx.mcpReq.signal), `${title}, ${a} to ${b}.`);
      },
    );

  rangeTool(
    "garmin_get_daily_summaries",
    "dailySummaries",
    "Daily summaries",
    "Per-day totals: steps, distance, active and total calories, resting/min/max heart rate, average and max stress, intensity minutes, floors, Body Battery high/low. Best tool for trends across weeks.",
  );
  rangeTool("garmin_get_sleep", "sleep", "Sleep", "Per-night sleep: duration, deep/light/REM/awake time, sleep score, and timing.");
  rangeTool("garmin_get_hrv", "hrv", "HRV", "Per-night heart-rate variability: last-night average, weekly average, baseline range and status (balanced, unbalanced, low).");
  rangeTool("garmin_get_body_battery", "bodyBattery", "Body Battery", "Per-day Body Battery: charged, drained, highest and lowest values.");
  rangeTool("garmin_get_stress", "stress", "Stress", "Per-day all-day stress levels.");
  rangeTool("garmin_get_steps", "steps", "Steps", "Per-day step totals and goals.");
  rangeTool("garmin_get_hydration", "hydration", "Hydration", "Per-day logged water intake and goal.");
  rangeTool(
    "garmin_get_weight",
    "weight",
    "Weight & body composition",
    "Every weigh-in in the range (Garmin usually reports weight in grams: divide by 1000 for kg), with BMI, body fat, muscle mass and water where a smart scale recorded them. Use for bulk/cut progress.",
  );
  rangeTool("garmin_get_weight_goals", "weightGoals", "Weight goals", "Weight goals in effect during the range.");
  rangeTool(
    "garmin_get_wellness_activities",
    "wellnessActivities",
    "Wellness activities",
    "Wellness activity summaries (e.g. breathwork and relaxation sessions) for the range.",
  );

  // ---------------- Single-day detail ----------------
  const dayTool = (name: string, title: string, description: string, fn: (d: string, s: AbortSignal) => Promise<Json>) =>
    server.registerTool(
      name,
      { title, description, inputSchema: z.strictObject({ date: DateArg.default("today") }), annotations: READ_ONLY },
      async ({ date }, ctx) => {
        const d = resolveDate(date);
        return jsonResult(await fn(d, ctx.mcpReq.signal), `${title}, ${d}.`);
      },
    );

  dayTool("garmin_get_sleep_detail", "Sleep detail", "One night's sleep in full: stages timeline, sleep score breakdown, respiration, restless moments, SpO2 and HR during sleep.", client.dailySleep);
  dayTool("garmin_get_heart_rate", "Heart rate (all day)", "One day's resting HR and the all-day heart-rate samples.", client.dailyHeartRate);
  dayTool("garmin_get_spo2", "Pulse Ox", "One day's SpO2 readings and acclimation.", client.dailySpo2);
  dayTool("garmin_get_fitness_age", "Fitness age", "Garmin's fitness age estimate and its inputs for a date.", client.fitnessAge);
  dayTool("garmin_get_nutrition", "Food log", "Foods and macros logged in Garmin Connect's nutrition log for one day.", client.foodLogs);

  // ---------------- Escape hatch ----------------
  server.registerTool(
    "garmin_api_get",
    {
      title: "Raw Personal API GET",
      description: `Call any documented Personal API endpoint directly, for data the other tools don't cover (e.g. menstrual cycle summaries, activity workouts).
Path must start with one of: ${ALLOWED_PATH_PREFIXES.join(", ")}.
Example: path="/activity-service/activity/123456/workouts"`,
      inputSchema: z.strictObject({
        path: z.string().startsWith("/").describe("API path beginning with /"),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Query parameters"),
      }),
      annotations: READ_ONLY,
    },
    async ({ path, params }, ctx) => {
      if (path.includes("..") || !ALLOWED_PATH_PREFIXES.some((p) => path.startsWith(p))) {
        throw new Error(`Path not allowed. It must start with one of ${ALLOWED_PATH_PREFIXES.join(", ")}.`);
      }
      return jsonResult(await client.get(path, params, ctx.mcpReq.signal));
    },
  );
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
