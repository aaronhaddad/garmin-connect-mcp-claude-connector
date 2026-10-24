import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findDesktopExtension } from "../src/cli/clients.js";

describe("findDesktopExtension", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gmcp-desktop-"));
    mkdirSync(join(dir, "Claude Extensions Settings"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const install = (id: string, name: string, version = "1.0.2") =>
    writeFileSync(join(dir, "extensions-installations.json"), JSON.stringify({ extensions: { [id]: { id, version, manifest: { name } } } }));
  const settings = (id: string, s: object) => writeFileSync(join(dir, "Claude Extensions Settings", `${id}.json`), JSON.stringify(s));

  it("finds the extension by manifest name, whatever its ID", () => {
    install("ant.dir.some-other-id", "garmin-personal-api-mcp");
    settings("ant.dir.some-other-id", { isEnabled: true, userConfig: { api_key: "abc" } });
    expect(findDesktopExtension(dir)).toEqual({ version: "1.0.2", enabled: true, hasKey: true });
  });
  it("reports a fresh install as off with no key", () => {
    install("local.mcpb.x.garmin-personal-api-mcp", "garmin-personal-api-mcp");
    expect(findDesktopExtension(dir)).toEqual({ version: "1.0.2", enabled: false, hasKey: false });
  });
  it("ignores other extensions and a missing Claude Desktop", () => {
    install("local.mcpb.spark", "Spark");
    expect(findDesktopExtension(dir)).toBeUndefined();
    expect(findDesktopExtension(join(dir, "nope"))).toBeUndefined();
  });
});
