/**
 * Registers this server with MCP clients: Claude Desktop (JSON config), Claude Code (`claude mcp add`),
 * Cursor (JSON config), or prints a snippet for anything else.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_NAME, SERVER_NAME } from "../constants.js";

export interface LaunchCommand {
  command: string;
  args: string[];
  /** "npx" when launched from the npm cache, "local" when run from a clone/global install. */
  kind: "npx" | "local";
}

/**
 * How a client should start the server. From `npx` we register `npx -y <pkg>` so updates
 * flow in; from a git clone or global install we register the absolute node + script path,
 * which also works for GUI apps that don't inherit your shell PATH (nvm, fnm, Homebrew).
 */
export function launchCommand(): LaunchCommand {
  const entry = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.js"));
  if (/[\\/]_npx[\\/]/.test(entry)) return { command: "npx", args: ["-y", PACKAGE_NAME], kind: "npx" };
  return { command: process.execPath, args: [entry], kind: "local" };
}

export interface ClientTarget {
  id: "claude-desktop" | "claude-code" | "cursor";
  label: string;
  detected: boolean;
  hint: string;
}

export function claudeDesktopConfigPath(): string {
  const home = homedir();
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude", "claude_desktop_config.json");
}

const cursorConfigPath = () => join(homedir(), ".cursor", "mcp.json");

export interface DesktopExtension {
  version: string;
  enabled: boolean;
  hasKey: boolean;
}

/**
 * Our Claude Desktop extension, if installed. Matched by manifest name, because the extension ID
 * differs between a double-clicked .mcpb (`local.mcpb.…`) and a directory install. Only reports
 * whether a key is set; never reads the key itself out of the settings file.
 */
export function findDesktopExtension(appDir = dirname(claudeDesktopConfigPath())): DesktopExtension | undefined {
  try {
    const installs = JSON.parse(readFileSync(join(appDir, "extensions-installations.json"), "utf8")) as {
      extensions?: Record<string, { id: string; version: string; manifest?: { name?: string } }>;
    };
    const ext = Object.values(installs.extensions ?? {}).find((e) => e.manifest?.name === PACKAGE_NAME);
    if (!ext) return undefined;
    let settings: { isEnabled?: boolean; userConfig?: { api_key?: unknown } } = {};
    const settingsPath = join(appDir, "Claude Extensions Settings", `${ext.id}.json`);
    if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const key = settings.userConfig?.api_key;
    return { version: ext.version, enabled: settings.isEnabled === true, hasKey: typeof key === "string" && key.trim() !== "" };
  } catch {
    return undefined;
  }
}

export function hasCommand(cmd: string): boolean {
  const probe = process.platform === "win32" ? spawnSync("where", [cmd]) : spawnSync("sh", ["-c", `command -v ${cmd}`]);
  return probe.status === 0;
}

export function detectClients(): ClientTarget[] {
  const desktop = claudeDesktopConfigPath();
  return [
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      detected: existsSync(dirname(desktop)),
      hint: "also makes it available to claude.ai chats linked to this computer",
    },
    { id: "claude-code", label: "Claude Code", detected: hasCommand("claude"), hint: "via `claude mcp add --scope user`" },
    { id: "cursor", label: "Cursor", detected: existsSync(dirname(cursorConfigPath())), hint: "~/.cursor/mcp.json" },
  ];
}

/** Adds/replaces our entry in an `mcpServers` JSON file, keeping a .bak of the previous file. */
export function upsertJsonConfig(path: string, launch: LaunchCommand): { backup?: string; replaced: boolean } {
  let config: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = {};
  let backup: string | undefined;
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    if (raw.trim()) {
      try {
        config = JSON.parse(raw);
      } catch {
        throw new Error(`${path} is not valid JSON, so I left it alone. Fix it or add the snippet by hand.`);
      }
    }
    backup = `${path}.bak`;
    copyFileSync(path, backup);
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }
  config.mcpServers ??= {};
  const replaced = SERVER_NAME in config.mcpServers;
  config.mcpServers[SERVER_NAME] = { command: launch.command, args: launch.args };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return { backup, replaced };
}

export function registerClaudeCode(launch: LaunchCommand): string {
  // Replace any previous registration so re-running setup is safe.
  spawnSync("claude", ["mcp", "remove", "--scope", "user", SERVER_NAME], { encoding: "utf8" });
  const res = spawnSync("claude", ["mcp", "add", "--scope", "user", SERVER_NAME, "--", launch.command, ...launch.args], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`\`claude mcp add\` failed: ${(res.stderr || res.stdout).trim()}`);
  return "added to Claude Code (user scope)";
}

export function registerClient(id: ClientTarget["id"], launch: LaunchCommand): string {
  switch (id) {
    case "claude-desktop": {
      const path = claudeDesktopConfigPath();
      const { backup, replaced } = upsertJsonConfig(path, launch);
      return `${replaced ? "updated" : "added to"} ${path}${backup ? ` (backup: ${backup})` : ""}`;
    }
    case "cursor": {
      const path = cursorConfigPath();
      const { replaced } = upsertJsonConfig(path, launch);
      return `${replaced ? "updated" : "added to"} ${path}`;
    }
    case "claude-code":
      return registerClaudeCode(launch);
  }
}

export function configSnippet(launch: LaunchCommand): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: launch.command, args: launch.args } } }, null, 2);
}
