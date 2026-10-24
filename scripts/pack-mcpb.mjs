/**
 * Builds the Claude Desktop extension: stages the built server with production-only
 * dependencies, validates manifest.json and packs `garmin-personal-api-mcp-<version>.mcpb`.
 * Run: npm run pack:mcpb
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
if (manifest.version !== pkg.version) {
  console.error(`manifest.json version ${manifest.version} does not match package.json ${pkg.version}`);
  process.exit(1);
}

function run(cmd, args, cwd = root) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

run("npm", ["run", "build"]);
const stage = mkdtempSync(join(tmpdir(), "gmcp-mcpb-"));
try {
  for (const f of ["manifest.json", "icon.png", "package.json", "package-lock.json", "LICENSE", "README.md", "PRIVACY.md", "dist"]) {
    cpSync(join(root, f), join(stage, f), { recursive: true });
  }
  // The bundle runs on Claude Desktop's own Node, so ship only runtime deps. --ignore-scripts skips `prepare` (tsc isn't installed).
  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], stage);
  const mcpb = join(root, "node_modules", ".bin", "mcpb");
  run(mcpb, ["validate", join(stage, "manifest.json")]);
  run(mcpb, ["pack", stage, join(root, `${pkg.name}-${pkg.version}.mcpb`)]);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
