import { describe, expect, it } from "vitest";
import { analysePacing, extractFit, fmtDuration, fmtPace, summarizeFit } from "../src/fit.js";
import { makeRunFit, zipFit } from "./fixtures.js";

describe("summarizeFit", () => {
  it("computes exact per-km splits from a zipped FIT", () => {
    // Aaron's September 5K: out fast, then a big fade.
    const paces = [333, 365, 426, 440, 442];
    const out = summarizeFit(extractFit(zipFit(makeRunFit(paces))));
    // FIT stores distance in cm, so allow sub-second rounding.
    out.splits.forEach((s, i) => expect(s.pace_s_per_km).toBeCloseTo(paces[i], 0));
    expect(out.splits.every((s) => !s.partial)).toBe(true);
    expect(out.session?.sport).toBe("running");
    expect(out.session?.avg_cadence).toBe(170); // per-leg 85 doubled to steps/min
    expect(out.splits[0].avg_hr).toBe(140);
    expect(out.pacing?.verdict).toMatch(/too fast/);
    expect(out.pacing?.fastest_split).toBe(1);
    expect(out.pacing?.slowest_split).toBe(5);
    expect(out.laps).toHaveLength(5);
  });

  it("excludes paused time using timer events", () => {
    const out = summarizeFit(makeRunFit([360, 360, 360], { pauseAtKm: 1.5, pauseSeconds: 90 }));
    out.splits.forEach((s) => expect(s.pace_s_per_km).toBeCloseTo(360, 0));
    expect(out.paused_s).toBeCloseTo(90, 0);
    expect(out.pacing?.verdict).toBe("Even pacing.");
  });

  it("reports a partial final split", () => {
    const out = summarizeFit(makeRunFit([300, 300, 300]), 1609);
    expect(out.splits).toHaveLength(2);
    expect(out.splits[1].partial).toBe(true);
    expect(out.splits[1].distance_m).toBeCloseTo(3000 - 1609, 0);
  });

  it("rejects a ZIP without a .fit", () => {
    expect(() => extractFit(zipFit(new Uint8Array([1, 2, 3]), "track.gpx"))).toThrow(/no .fit file/);
  });
});

describe("analysePacing", () => {
  const split = (i: number, pace: number) => ({ index: i, distance_m: 1000, moving_s: pace, pace_s_per_km: pace, partial: false });
  it("detects a negative split", () => {
    expect(analysePacing([360, 355, 345, 335].map((p, i) => split(i + 1, p)))?.verdict).toMatch(/Negative/);
  });
  it("needs two full splits", () => {
    expect(analysePacing([split(1, 300)])).toBeUndefined();
  });
});

describe("formatters", () => {
  it("formats pace and duration", () => {
    expect(fmtPace(333)).toBe("5:33/km");
    expect(fmtPace(359.6)).toBe("6:00/km");
    expect(fmtDuration(2033)).toBe("33:53");
    expect(fmtDuration(7199)).toBe("1:59:59");
  });
});
