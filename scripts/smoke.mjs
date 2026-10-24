/**
 * End-to-end self-check: starts a fake Garmin Personal API on localhost, launches the built
 * server over stdio pointed at it, and calls the tools like Claude would.
 * Run: npm run build && npm run smoke
 */
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Encoder, Profile } from "@garmin/fitsdk";
import { zipSync } from "fflate";

function fit() {
  const enc = new Encoder();
  const t0 = Date.parse("2026-10-21T17:50:00Z");
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "garmin", product: 1, timeCreated: new Date(t0), serialNumber: 1 });
  let d = 0;
  for (let s = 1; d < 5000; s++) {
    const pace = d < 1000 ? 333 : d < 2000 ? 365 : 430;
    d = Math.min(5000, d + 1000 / pace);
    enc.onMesg(Profile.MesgNum.RECORD, { timestamp: new Date(t0 + s * 1000), distance: d, heartRate: 150, cadence: 82 });
  }
  enc.onMesg(Profile.MesgNum.SESSION, { timestamp: new Date(t0 + 2033e3), startTime: new Date(t0), sport: "running", totalTimerTime: 2033, totalElapsedTime: 2033, totalDistance: 5000, avgHeartRate: 158, maxHeartRate: 176 });
  return zipSync({ "1001_ACTIVITY.fit": enc.close() });
}

const exp = Math.floor(Date.now() / 1000) + 86400;
const TOKEN = `h.${Buffer.from(JSON.stringify({ exp, scope: ["PERSONAL_API_FITNESS_READ"] })).toString("base64url")}.s`;
const seen = [];
const fake = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  seen.push(url.pathname);
  const json = (v) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(v)); };
  if (url.pathname.endsWith("/personal-api-key/token")) {
    if (req.headers.authorization !== "ApiKey test-key-0123456789abcdef") { res.statusCode = 401; return res.end(); }
    return res.end(TOKEN);
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.statusCode = 401; return res.end(); }
  if (url.pathname === "/activitylist-service/activities/search/activities") {
    return json([{ activityId: 1001, activityName: "Prenzlauer Berg Run", activityType: { typeKey: "running" }, startTimeLocal: "2026-10-21 19:50:00", distance: 5000, duration: 2033, averageSpeed: 2.459, averageHR: 158, maxHR: 176 }]);
  }
  if (url.pathname === "/download-service/files/activity/1001") { res.setHeader("content-type", "application/zip"); return res.end(Buffer.from(fit())); }
  if (url.pathname.startsWith("/usersummary-service/stats/steps/daily/")) return json([{ calendarDate: url.pathname.split("/").at(-2), totalSteps: 9000 }]);
  if (url.pathname === "/usersummary-service/v2/dailysummaries") return json({ data: [{ calendarDate: url.searchParams.get("startDate"), restingHeartRate: 52 }] });
  if (url.pathname === "/sleep-service/sleep/dailySleep") return json({ dailySleepDTO: { sleepTimeSeconds: 27000 } });
  if (url.pathname.startsWith("/hrv-service/hrv/")) return json({ hrvSummary: { lastNightAvg: 61, status: "BALANCED" } });
  if (url.pathname === "/wellness-service/wellness/bodyBattery/reports/daily") return json([{ charged: 60, drained: 40 }]);
  res.statusCode = 404; res.end();
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${fake.address().port}`;

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...getDefaultEnvironment(), GARMIN_PERSONAL_API_BASE_URL: base, GARMIN_PERSONAL_API_KEY: "test-key-0123456789abcdef", GARMIN_MCP_CONFIG_DIR: mkdtempSync(join(tmpdir(), "gmcp-")) },
}));

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
for (const t of ["garmin_list_activities", "garmin_get_activity_splits", "garmin_get_performance_metrics", "garmin_get_day", "garmin_get_steps", "garmin_api_get"]) assert.ok(names.includes(t), `missing ${t}`);
assert.ok(tools.every((t) => t.annotations && t.description), "every tool needs a description and annotations");

const text = (r) => r.content.map((c) => c.text).join("\n");

const list = await client.callTool({ name: "garmin_list_activities", arguments: { limit: 5, activity_type: "running" } });
assert.ok(!list.isError, text(list));
assert.match(text(list), /Prenzlauer Berg Run[\s\S]*6:47\/km/);

const splits = await client.callTool({ name: "garmin_get_activity_splits", arguments: { activity_id: 1001 } });
assert.ok(!splits.isError, text(splits));
assert.match(text(splits), /\| 1 \| 1\.00 \| 5:33 \| 5:33\/km/);
assert.match(text(splits), /too fast/);

const perf = await client.callTool({ name: "garmin_get_performance_metrics", arguments: { last_n: 1 } });
assert.ok(!perf.isError, text(perf));
assert.match(text(perf), /VO2 max: not available[\s\S]*Prenzlauer Berg Run/, "a FIT without Garmin's physiology messages still lists the activity");

const steps = await client.callTool({ name: "garmin_get_steps", arguments: { start_date: "2026-08-01", end_date: "2026-09-15" } });
assert.ok(!steps.isError, text(steps));
assert.equal(seen.filter((p) => p.startsWith("/usersummary-service/stats/steps")).length, 2, "46 days should be two chunks");

const day = await client.callTool({ name: "garmin_get_day", arguments: { date: "yesterday" } });
assert.ok(!day.isError, text(day));
assert.match(text(day), /BALANCED/);

const badPath = await client.callTool({ name: "garmin_api_get", arguments: { path: "/download-service/files/activity/1" } });
assert.equal(badPath.isError, true, "raw tool must reject paths outside the allowlist");

const badDate = await client.callTool({ name: "garmin_get_sleep", arguments: { start_date: "next week" } });
assert.equal(badDate.isError, true);

assert.equal(seen.filter((p) => p.endsWith("/token")).length, 1, "token should be exchanged once and reused");

await client.close();
fake.close();
console.error(`Smoke test passed: ${names.length} tools`);
