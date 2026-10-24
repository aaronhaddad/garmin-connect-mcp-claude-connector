import { describe, expect, it } from "vitest";
import { activityLine, summarizeActivity } from "../src/format.js";

// Shape of one /activitylist-service search result (trimmed), values from a real run.
const run = {
  activityId: 24806817371,
  activityName: "Berlin Running",
  startTimeLocal: "2026-10-21 20:30:40",
  activityType: { typeKey: "running" },
  distance: 5013.87,
  duration: 1721.196,
  averageSpeed: 2.913,
  averageHR: 168,
  aerobicTrainingEffect: 4.199999809265137,
  anaerobicTrainingEffect: 1.100000023841858,
  trainingEffectLabel: "LACTATE_THRESHOLD",
  activityTrainingLoad: 143.19595336914062,
};

describe("summarizeActivity", () => {
  it("adds training load and training effect as Garmin Connect shows them", () => {
    const a = summarizeActivity(run)!;
    expect(a.training_load).toBe(143);
    expect(a.training_effect).toBe(4.2);
    expect(a.anaerobic_training_effect).toBe(1.1);
    expect(a.training_effect_label).toBe("lactate threshold");
    expect(activityLine(a)).toContain("TE 4.2 (lactate threshold) · load 143");
  });
  it("leaves them out when Garmin has none (e.g. manual entries)", () => {
    const a = summarizeActivity({ activityId: 1, activityName: "Manual", activityType: { typeKey: "other" } })!;
    expect(a.training_load).toBeUndefined();
    expect(activityLine(a)).not.toContain("load");
    expect(activityLine({ ...summarizeActivity(run)!, distance_km: 0 })).not.toContain("0 km");
  });
});
