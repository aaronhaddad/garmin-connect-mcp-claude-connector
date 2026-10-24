import { Encoder, Profile } from "@garmin/fitsdk";
import { zipSync } from "fflate";

/**
 * Builds a synthetic running .FIT: each element of `kmPaces` is one km at that pace (s/km),
 * one record per second, with an optional pause (timer stop/start) mid-run.
 */
export function makeRunFit(kmPaces: number[], opts: { pauseAtKm?: number; pauseSeconds?: number } = {}): Uint8Array {
  const enc = new Encoder();
  const t0 = new Date("2026-10-20T06:00:00Z").getTime();
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "garmin", product: 1, timeCreated: new Date(t0), serialNumber: 42 });
  enc.onMesg(Profile.MesgNum.EVENT, { timestamp: new Date(t0), event: "timer", eventType: "start" });

  let t = t0;
  let dist = 0;
  let paused = false;
  const total = kmPaces.length * 1000;
  while (dist < total - 1e-9) {
    const km = Math.floor(dist / 1000);
    const speed = 1000 / kmPaces[km];
    if (!paused && opts.pauseAtKm !== undefined && dist >= opts.pauseAtKm * 1000) {
      paused = true;
      enc.onMesg(Profile.MesgNum.EVENT, { timestamp: new Date(t), event: "timer", eventType: "stopAll" });
      t += (opts.pauseSeconds ?? 60) * 1000;
      enc.onMesg(Profile.MesgNum.EVENT, { timestamp: new Date(t), event: "timer", eventType: "start" });
    }
    t += 1000;
    dist = Math.min(total, dist + speed);
    enc.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(t),
      distance: dist,
      enhancedSpeed: speed,
      heartRate: 140 + km * 5,
      cadence: 85,
      enhancedAltitude: 40 + (km % 2) * 5,
    });
  }
  const timer = kmPaces.reduce((a, b) => a + b, 0);
  for (let i = 0; i < kmPaces.length; i++) {
    enc.onMesg(Profile.MesgNum.LAP, {
      timestamp: new Date(t),
      startTime: new Date(t0),
      totalElapsedTime: kmPaces[i],
      totalTimerTime: kmPaces[i],
      totalDistance: 1000,
      avgHeartRate: 140 + i * 5,
    });
  }
  enc.onMesg(Profile.MesgNum.SESSION, {
    timestamp: new Date(t),
    startTime: new Date(t0),
    sport: "running",
    totalElapsedTime: (t - t0) / 1000,
    totalTimerTime: timer,
    totalDistance: total,
    avgHeartRate: 150,
    maxHeartRate: 165,
    avgCadence: 85,
    totalAscent: 10,
    totalCalories: 400,
  });
  return enc.close();
}

export const zipFit = (fit: Uint8Array, name = "123_ACTIVITY.fit") => zipSync({ [name]: fit });
