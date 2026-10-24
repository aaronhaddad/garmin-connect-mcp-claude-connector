/**
 * Copies package.json's version into manifest.json, the plugin's plugin.json, and the npm version the
 * plugin's .mcp.json pins (the directory requires an exact version). Runs from `npm version`, so a
 * version bump updates them all in the same commit and tag.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));
const write = (f, data) => writeFileSync(join(root, f), JSON.stringify(data, null, 2) + "\n");
const { name, version } = read("package.json");

const manifest = read("manifest.json");
manifest.version = version;
write("manifest.json", manifest);

const plugin = read("plugin/.claude-plugin/plugin.json");
plugin.version = version;
write("plugin/.claude-plugin/plugin.json", plugin);

const mcp = read("plugin/.mcp.json");
for (const server of Object.values(mcp.mcpServers)) {
  server.args = server.args.map((a) => (a === name || a.startsWith(`${name}@`) ? `${name}@${version}` : a));
}
write("plugin/.mcp.json", mcp);

console.log(`manifest.json, plugin.json and the plugin's npx pin → ${version}`);
