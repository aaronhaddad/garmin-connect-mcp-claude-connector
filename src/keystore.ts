/**
 * Where the Personal API key lives. Lookup order:
 *   1. GARMIN_PERSONAL_API_KEY environment variable
 *   2. macOS Keychain (written by `garmin-personal-api-mcp setup`)
 *   3. ~/.config/garmin/connect-personal-api-key (shared with Garmin's official Python client)
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  API_KEY_ENV_VAR,
  CONFIG_DIR,
  DEFAULT_KEY_FILE,
  EXTENSION_DISPLAY_NAME,
  KEY_PAGE_URL,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  RUNTIME_ENV_VAR,
  SETTINGS_FILE,
} from "./constants.js";

export type KeySource = "env" | "keychain" | "file";

export interface ResolvedKey {
  key: string;
  source: KeySource;
  location: string;
}

export interface Settings {
  storage?: Exclude<KeySource, "env">;
  /** ISO date the user said the key expires, for reminders. */
  keyExpiresOn?: string;
  setupAt?: string;
}

/** True when Claude Desktop runs us as a desktop extension, where the key comes from its settings, not `setup`. */
export const isExtension = (): boolean => process.env[RUNTIME_ENV_VAR] === "mcpb";

/** How the user replaces a missing or rejected key, phrased for where we're running. Completes "Ask the user to …". */
export function keyFixHint(): string {
  return isExtension()
    ? `open Claude Desktop → Settings → Extensions → ${EXTENSION_DISPLAY_NAME}, and paste a new key created at ${KEY_PAGE_URL}`
    : "run `npx garmin-personal-api-mcp setup` in a terminal to add a new key";
}

export const keychainAvailable = (): boolean =>
  process.platform === "darwin" && existsSync("/usr/bin/security");

function runSecurity(args: string[], input?: string) {
  return spawnSync("/usr/bin/security", args, { input, encoding: "utf8" });
}

export function readKeychain(): string | undefined {
  if (!keychainAvailable()) return undefined;
  const res = runSecurity(["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w"]);
  const value = res.status === 0 ? res.stdout.trim() : "";
  return value || undefined;
}

/**
 * Writes via `security -i` (commands on stdin) so the key never appears in the
 * process list the way a `-w <key>` argument would.
 */
export function writeKeychain(key: string): void {
  const escaped = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const cmd = `add-generic-password -U -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" -l "Garmin Connect Personal API key" -w "${escaped}"\n`;
  const res = runSecurity(["-i"], cmd);
  if (res.status !== 0 || /error/i.test(res.stderr)) {
    throw new Error(`Could not save the key to the macOS Keychain: ${res.stderr.trim() || `exit ${res.status}`}`);
  }
}

export function deleteKeychain(): boolean {
  if (!keychainAvailable()) return false;
  return runSecurity(["delete-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE]).status === 0;
}

export function readKeyFile(path = DEFAULT_KEY_FILE): string | undefined {
  try {
    const value = readFileSync(path, "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function writeKeyFile(key: string, path = DEFAULT_KEY_FILE): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${key}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function deleteKeyFile(path = DEFAULT_KEY_FILE): boolean {
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

export function resolveKey(): ResolvedKey | undefined {
  const env = process.env[API_KEY_ENV_VAR]?.trim();
  if (env) return { key: env, source: "env", location: `$${API_KEY_ENV_VAR}` };
  const kc = readKeychain();
  if (kc) return { key: kc, source: "keychain", location: `macOS Keychain (${KEYCHAIN_SERVICE})` };
  const file = readKeyFile();
  if (file) return { key: file, source: "file", location: DEFAULT_KEY_FILE };
  return undefined;
}

export function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function writeSettings(settings: Settings): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

/** Days until the key expires, or undefined if unknown. Negative once expired. */
export function daysUntilKeyExpiry(settings = readSettings(), now = new Date()): number | undefined {
  if (!settings.keyExpiresOn) return undefined;
  const ms = new Date(`${settings.keyExpiresOn}T23:59:59`).getTime() - now.getTime();
  return Math.floor(ms / 86_400_000);
}

/** Masked preview such as `gk_a1…9f2c`, safe to print. */
export function maskKey(key: string): string {
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
