import { CHARACTER_LIMIT } from "./constants.js";
import type { Json } from "./api.js";
import { fmtDuration, fmtPace } from "./fit.js";

type Obj = { [k: string]: Json };
export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Drops null/undefined/empty-string fields recursively; keeps zeros and false. */
export function compact(v: Json): Json {
  if (Array.isArray(v)) return v.map(compact);
  if (isObj(v)) {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === "") continue;
      out[k] = compact(x);
    }
    return out;
  }
  return v;
}

/**
 * Keeps a JSON payload under CHARACTER_LIMIT without cutting text mid-structure:
 * long arrays (usually per-minute samples) are evenly downsampled, halving until it fits.
 */
export function fitJson(value: Json, limit = CHARACTER_LIMIT): { value: Json; text: string; downsampled: boolean } {
  let v = compact(value);
  let text = JSON.stringify(v);
  if (text.length <= limit) return { value: v, text, downsampled: false };
  for (let cap = 512; cap >= 4; cap = Math.floor(cap / 2)) {
    v = downsample(compact(value), cap);
    text = JSON.stringify(v);
    if (text.length <= limit) return { value: v, text, downsampled: true };
  }
  throw new Error(
    "The response is too large even after downsampling. Ask for a shorter date range, or use a summary tool such as garmin_get_daily_summaries.",
  );
}

function downsample(v: Json, cap: number): Json {
  if (Array.isArray(v)) {
    const arr = v.length > cap ? Array.from({ length: cap }, (_, i) => v[Math.floor((i * v.length) / cap)]) : v;
    return arr.map((x) => downsample(x, cap));
  }
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, downsample(x, cap)]));
  return v;
}

export function jsonResult(value: Json, note?: string) {
  const { text, downsampled } = fitJson(value);
  const notes = [note, downsampled ? "Long sample arrays were evenly downsampled to fit; ask for a single day for full resolution." : undefined]
    .filter(Boolean)
    .join(" ");
  return { content: [{ type: "text" as const, text: notes ? `${notes}\n\n${text}` : text }] };
}

export const textResult = (text: string) => ({ content: [{ type: "text" as const, text }] });

// ---- Activity summaries (field names as returned by Garmin Connect's activity list) ----

const g = (o: Obj, k: string) => o[k];
const n = (v: Json | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: Json | undefined) => (typeof v === "string" ? v : undefined);

export interface ActivitySummary {
  activity_id: number | string;
  name?: string;
  type?: string;
  start_local?: string;
  distance_km?: number;
  duration?: string;
  moving_time?: string;
  avg_pace?: string;
  avg_hr?: number;
  max_hr?: number;
  elevation_gain_m?: number;
  calories?: number;
  avg_cadence?: number;
  training_effect?: number;
}

export function summarizeActivity(raw: Json): ActivitySummary | undefined {
  if (!isObj(raw)) return undefined;
  const id = g(raw, "activityId");
  if (typeof id !== "number" && typeof id !== "string") return undefined;
  const summary = isObj(raw.summaryDTO) ? raw.summaryDTO : raw; // detail endpoint nests stats
  const type = isObj(raw.activityType) ? str(raw.activityType.typeKey) : isObj(raw.activityTypeDTO) ? str(raw.activityTypeDTO.typeKey) : undefined;
  const dist = n(g(summary, "distance"));
  const dur = n(g(summary, "duration"));
  const moving = n(g(summary, "movingDuration"));
  const speed = n(g(summary, "averageSpeed"));
  const isFoot = !!type && /run|walk|hik|trail|treadmill/.test(type);
  return {
    activity_id: id,
    name: str(raw.activityName),
    type,
    start_local: str(g(summary, "startTimeLocal")) ?? str(raw.startTimeLocal),
    distance_km: dist !== undefined ? Math.round(dist / 10) / 100 : undefined,
    duration: dur !== undefined ? fmtDuration(dur) : undefined,
    moving_time: moving !== undefined ? fmtDuration(moving) : undefined,
    avg_pace: isFoot && speed ? fmtPace(1000 / speed) : undefined,
    avg_hr: n(g(summary, "averageHR")),
    max_hr: n(g(summary, "maxHR")),
    elevation_gain_m: n(g(summary, "elevationGain")),
    calories: n(g(summary, "calories")),
    avg_cadence: n(g(summary, "averageRunningCadenceInStepsPerMinute")) ?? n(g(summary, "averageRunCadence")),
    training_effect: n(g(summary, "aerobicTrainingEffect")) ?? n(g(summary, "trainingEffect")),
  };
}

export function activityLine(a: ActivitySummary): string {
  const bits = [
    a.distance_km !== undefined ? `${a.distance_km} km` : undefined,
    a.duration,
    a.avg_pace,
    a.avg_hr ? `avg HR ${a.avg_hr}` : undefined,
    a.elevation_gain_m ? `+${Math.round(a.elevation_gain_m)} m` : undefined,
  ].filter(Boolean);
  return `- **${a.name ?? "Untitled"}** (${a.type ?? "activity"}, ${a.start_local ?? "?"}) · id ${a.activity_id}\n  ${bits.join(" · ")}`;
}
