import { afterEach, describe, expect, it, vi } from "vitest";
import { GarminApiError } from "../src/api.js";
import { daysUntilKeyExpiry, keyFixHint } from "../src/keystore.js";
import { keyExpiryNote } from "../src/server.js";

afterEach(() => vi.unstubAllEnvs());

describe("keyFixHint", () => {
  it("points CLI users at setup", () => {
    vi.stubEnv("GARMIN_MCP_RUNTIME", "");
    expect(keyFixHint()).toMatch(/npx garmin-personal-api-mcp setup/);
    expect(new GarminApiError(401, "/x").message).toMatch(/setup/);
  });
  it("points extension users at Claude Desktop settings, never setup", () => {
    vi.stubEnv("GARMIN_MCP_RUNTIME", "mcpb");
    expect(keyFixHint()).toMatch(/Settings → Extensions/);
    expect(keyFixHint()).toContain("connect.garmin.com/app/settings/personalApiToken");
    expect(new GarminApiError(403, "/x").message).not.toMatch(/setup/);
  });
  it("tells the model to stop instead of finding another route to the data", () => {
    expect(new GarminApiError(401, "/x").message).toMatch(/don't try to get the data another way/);
  });
});

describe("keyExpiryNote", () => {
  it("warns about a saved key that is expiring or expired", () => {
    expect(keyExpiryNote("keychain", 3)).toMatch(/expires in 3 day/);
    expect(keyExpiryNote("file", -1)).toMatch(/has expired/);
    expect(keyExpiryNote("keychain", 30)).toBe("");
  });
  it("stays quiet for an env key, whose expiry setup never recorded", () => {
    expect(keyExpiryNote("env", -5)).toBe("");
    expect(keyExpiryNote(undefined, 3)).toBe("");
  });
  it("counts days to the end of the expiry date", () => {
    expect(daysUntilKeyExpiry({ keyExpiresOn: "2026-10-31" }, new Date("2026-10-24T10:00:00"))).toBe(7);
  });
});
