/**
 * Turns the original activity file (a ZIP holding a .fit) into per-distance splits,
 * laps and a pacing analysis, using Garmin's own FIT SDK.
 */
import { unzipSync } from "fflate";
import { Decoder, Stream } from "@garmin/fitsdk";

export interface FitRecord {
  t: number; // epoch ms
  dist?: number; // metres
  hr?: number;
  cad?: number; // steps/min for running, rpm otherwise
  alt?: number; // metres
}

export interface Split {
  index: number;
  distance_m: number;
  moving_s: number;
  pace_s_per_km: number;
  avg_hr?: number;
  max_hr?: number;
  avg_cadence?: number;
  elev_gain_m?: number;
  partial: boolean;
}

export interface Lap {
  index: number;
  distance_m: number;
  timer_s: number;
  pace_s_per_km?: number;
  avg_hr?: number;
  max_hr?: number;
}

export interface Session {
  sport?: string;
  sub_sport?: string;
  start_time?: string;
  distance_m?: number;
  timer_s?: number;
  elapsed_s?: number;
  avg_hr?: number;
  max_hr?: number;
  avg_cadence?: number;
  total_ascent_m?: number;
  calories?: number;
  training_effect_aerobic?: number;
  training_effect_anaerobic?: number;
}

export interface PacingAnalysis {
  first_split_pace_s_per_km: number;
  last_split_pace_s_per_km: number;
  fastest_split: number;
  slowest_split: number;
  /** Second half minus first half average pace, s/km. Positive means you slowed down. */
  half_split_delta_s_per_km: number;
  /** Coefficient of variation of full-split paces, %. Under ~3% is very even. */
  pace_variability_pct: number;
  verdict: string;
}

export interface FitSummary {
  session?: Session;
  splits: Split[];
  laps: Lap[];
  pacing?: PacingAnalysis;
  /** Seconds removed from split times because the device was stopped. */
  paused_s: number;
  record_count: number;
}

/** Pulls the first .fit out of Garmin's download ZIP. Accepts a bare .fit too. */
export function extractFit(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => n.toLowerCase().endsWith(".fit"));
    if (!name) {
      const names = Object.keys(files).join(", ") || "nothing";
      throw new Error(`The activity download has no .fit file (it contains ${names}). Manually uploaded GPX/TCX activities can't be split.`);
    }
    return files[name];
  }
  return bytes;
}

type Mesg = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const time = (v: unknown) => (v instanceof Date ? v.getTime() : undefined);

export function decodeFit(fit: Uint8Array): Record<string, Mesg[]> {
  const stream = Stream.fromArrayBuffer(fit.slice().buffer);
  if (!Decoder.isFIT(stream)) throw new Error("The file is not a FIT file.");
  const { messages, errors } = new Decoder(stream).read({ convertDateTimesToDates: true, expandSubFields: true, expandComponents: true, mergeHeartRates: true });
  if (errors.length && !messages.recordMesgs?.length) {
    throw new Error(`Could not decode the FIT file: ${String(errors[0])}`);
  }
  return messages as unknown as Record<string, Mesg[]>;
}

export function summarizeFit(fit: Uint8Array, splitMeters = 1000): FitSummary {
  const m = decodeFit(fit);
  const s = (m.sessionMesgs ?? [])[0];
  const sport = typeof s?.sport === "string" ? s.sport : undefined;
  const running = sport === "running" || sport === "walking" || sport === "hiking";

  const records: FitRecord[] = (m.recordMesgs ?? [])
    .map((r) => {
      const cad = num(r.cadence);
      return {
        t: time(r.timestamp) ?? NaN,
        dist: num(r.distance),
        hr: num(r.heartRate),
        // FIT stores running cadence per leg; double it to the familiar steps/min.
        cad: cad === undefined ? undefined : running ? (cad + (num(r.fractionalCadence) ?? 0)) * 2 : cad,
        alt: num(r.enhancedAltitude) ?? num(r.altitude),
      };
    })
    .filter((r) => Number.isFinite(r.t));

  const { splits, pausedS } = computeSplits(records, splitMeters, timerPauses(m.eventMesgs ?? []));

  const laps: Lap[] = (m.lapMesgs ?? []).map((l, i) => {
    const d = num(l.totalDistance) ?? 0;
    const t = num(l.totalTimerTime) ?? 0;
    return {
      index: i + 1,
      distance_m: round(d, 1),
      timer_s: round(t, 1),
      pace_s_per_km: d > 0 ? round((t / d) * 1000, 1) : undefined,
      avg_hr: num(l.avgHeartRate),
      max_hr: num(l.maxHeartRate),
    };
  });

  const session: Session | undefined = s && {
    sport,
    sub_sport: typeof s.subSport === "string" ? s.subSport : undefined,
    start_time: s.startTime instanceof Date ? s.startTime.toISOString() : undefined,
    distance_m: num(s.totalDistance),
    timer_s: num(s.totalTimerTime),
    elapsed_s: num(s.totalElapsedTime),
    avg_hr: num(s.avgHeartRate),
    max_hr: num(s.maxHeartRate),
    avg_cadence: running ? mul(num(s.avgRunningCadence) ?? num(s.avgCadence), 2) : num(s.avgCadence),
    total_ascent_m: num(s.totalAscent),
    calories: num(s.totalCalories),
    training_effect_aerobic: num(s.totalTrainingEffect),
    training_effect_anaerobic: num(s.totalAnaerobicTrainingEffect),
  };

  return { session, splits, laps, pacing: analysePacing(splits), paused_s: round(pausedS, 1), record_count: records.length };
}

const mul = (v: number | undefined, k: number) => (v === undefined ? undefined : v * k);
const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;

/** [stopMs, startMs] windows from timer stop/start events (manual or auto-pause). */
export function timerPauses(events: Mesg[]): [number, number][] {
  const out: [number, number][] = [];
  let stoppedAt: number | undefined;
  for (const e of events) {
    if (e.event !== "timer") continue;
    const t = time(e.timestamp);
    if (t === undefined) continue;
    const type = String(e.eventType);
    if (type.startsWith("stop") && stoppedAt === undefined) stoppedAt = t;
    else if (type === "start" && stoppedAt !== undefined) {
      out.push([stoppedAt, t]);
      stoppedAt = undefined;
    }
  }
  return out;
}

/**
 * Splits by distance with linear interpolation at each boundary, so a 1 km split ends
 * exactly at 1000 m rather than at the nearest record. Paused time is excluded using the
 * timer events when present, otherwise any gap over 10 s with under 2 m of movement.
 */
export function computeSplits(records: FitRecord[], splitMeters: number, pauses: [number, number][] = []): { splits: Split[]; pausedS: number } {
  const pts = records.filter((r) => r.dist !== undefined) as (FitRecord & { dist: number })[];
  if (pts.length < 2) return { splits: [], pausedS: 0 };

  // Moving clock: real time minus paused time, so pace reflects running only.
  // The first record usually lands a few metres in; back-extrapolate to 0 m at the same
  // speed so split 1 covers the full distance.
  const d01 = pts[1].dist - pts[0].dist;
  const lead = pts[0].dist > 0 && pts[0].dist < 50 && d01 > 0 ? (pts[0].dist * (pts[1].t - pts[0].t)) / 1000 / d01 : 0;
  const moving: number[] = [lead];
  let pausedS = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    let dt = (b.t - a.t) / 1000;
    let paused = 0;
    if (pauses.length) {
      for (const [ps, pe] of pauses) paused += Math.max(0, Math.min(b.t, pe) - Math.max(a.t, ps)) / 1000;
    } else if (dt > 10 && b.dist - a.dist < 2) {
      paused = dt;
    }
    paused = Math.min(paused, dt);
    pausedS += paused;
    dt -= paused;
    moving.push(moving[i - 1] + dt);
  }

  const splits: Split[] = [];
  let boundary = splitMeters;
  let startIdx = 0;
  let startMoving = 0;
  let startDist = lead > 0 ? 0 : pts[0].dist;
  const total = pts[pts.length - 1].dist;

  const finish = (endIdx: number, endMoving: number, endDist: number, partial: boolean) => {
    const seg = pts.slice(startIdx, endIdx + 1);
    const hrs = seg.map((r) => r.hr).filter((v): v is number => v !== undefined);
    const cads = seg.map((r) => r.cad).filter((v): v is number => v !== undefined && v > 0);
    let gain = 0;
    let hasAlt = false;
    for (let j = 1; j < seg.length; j++) {
      const a = seg[j - 1].alt;
      const b = seg[j].alt;
      if (a !== undefined && b !== undefined) {
        hasAlt = true;
        if (b > a) gain += b - a;
      }
    }
    const d = endDist - startDist;
    const t = endMoving - startMoving;
    if (d < 1 || t <= 0) return;
    splits.push({
      index: splits.length + 1,
      distance_m: round(d, 1),
      moving_s: round(t, 1),
      pace_s_per_km: round((t / d) * 1000, 1),
      avg_hr: hrs.length ? Math.round(hrs.reduce((x, y) => x + y, 0) / hrs.length) : undefined,
      max_hr: hrs.length ? Math.max(...hrs) : undefined,
      avg_cadence: cads.length ? Math.round(cads.reduce((x, y) => x + y, 0) / cads.length) : undefined,
      elev_gain_m: hasAlt ? round(gain, 1) : undefined,
      partial,
    });
  };

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    while (b.dist >= boundary && a.dist < boundary) {
      const f = (boundary - a.dist) / (b.dist - a.dist);
      const tAt = moving[i - 1] + f * (moving[i] - moving[i - 1]);
      finish(i, tAt, boundary, false);
      startIdx = i;
      startMoving = tAt;
      startDist = boundary;
      boundary += splitMeters;
    }
  }
  // Remainder, ignored when it's GPS noise after stopping.
  if (total - startDist >= Math.min(50, splitMeters * 0.05)) finish(pts.length - 1, moving[pts.length - 1], total, true);
  return { splits, pausedS };
}

export function analysePacing(splits: Split[]): PacingAnalysis | undefined {
  const full = splits.filter((s) => !s.partial);
  if (full.length < 2) return undefined;
  const paces = full.map((s) => s.pace_s_per_km);
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const sd = Math.sqrt(paces.reduce((a, b) => a + (b - mean) ** 2, 0) / paces.length);
  const half = Math.floor(paces.length / 2);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const firstHalf = avg(paces.slice(0, half));
  const secondHalf = avg(paces.slice(paces.length - half));
  const delta = secondHalf - firstHalf;
  const cv = (sd / mean) * 100;
  const fastest = full[paces.indexOf(Math.min(...paces))].index;
  const slowest = full[paces.indexOf(Math.max(...paces))].index;

  let verdict: string;
  if (cv < 3 && Math.abs(delta) < 8) verdict = "Even pacing.";
  else if (delta <= -8) verdict = "Negative split: the second half was faster.";
  else if (delta >= 30 || (fastest === 1 && slowest === full[full.length - 1].index && delta >= 15))
    verdict = "Went out too fast: big fade in the second half.";
  else if (delta >= 8) verdict = "Positive split: slowed through the run.";
  else verdict = "Uneven pacing without a clear trend (hills, traffic lights or intervals?).";

  return {
    first_split_pace_s_per_km: paces[0],
    last_split_pace_s_per_km: paces[paces.length - 1],
    fastest_split: fastest,
    slowest_split: slowest,
    half_split_delta_s_per_km: round(delta, 1),
    pace_variability_pct: round(cv, 1),
    verdict,
  };
}

export function fmtPace(sPerKm: number | undefined): string {
  if (sPerKm === undefined || !Number.isFinite(sPerKm)) return "–";
  const r = Math.round(sPerKm);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}/km`;
}

export function fmtDuration(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s)) return "–";
  const r = Math.round(s);
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  const sec = r % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
