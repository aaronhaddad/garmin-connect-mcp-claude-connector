import * as p from "@clack/prompts";
import { exchangeKey, jwtClaims } from "../auth.js";
import { DEFAULT_KEY_FILE, SERVER_NAME, TOKEN_CACHE_FILE, VERSION } from "../constants.js";
import { daysUntilKeyExpiry, deleteKeychain, deleteKeyFile, maskKey, readSettings, resolveKey, writeSettings } from "../keystore.js";
import { claudeDesktopConfigPath } from "./clients.js";
import { existsSync, readFileSync, rmSync } from "node:fs";

export async function runStatus(): Promise<number> {
  p.intro(` Garmin Connect MCP · status v${VERSION} `);
  const key = resolveKey();
  if (!key) {
    p.log.error("No key saved. Run `npx garmin-personal-api-mcp setup`.");
    p.outro("");
    return 1;
  }
  p.log.info(`Key ${maskKey(key.key)} from ${key.location}`);
  const days = daysUntilKeyExpiry();
  if (days !== undefined) {
    const msg = `Key expires ${readSettings().keyExpiresOn} (${days < 0 ? "expired" : `in ${days} days`})`;
    if (days < 0) p.log.error(msg);
    else if (days <= 14) p.log.warn(msg);
    else p.log.info(msg);
  }

  const s = p.spinner();
  s.start("Checking with Garmin");
  let ok = true;
  try {
    const t = await exchangeKey(key.key);
    const claims = jwtClaims(t.accessToken);
    s.stop(`Garmin accepted the key · token valid until ${new Date(t.expiresAt).toLocaleString()}`);
    const scope = claims.scope ?? claims.authorities;
    if (scope) p.log.info(`Scopes: ${Array.isArray(scope) ? scope.join(", ") : String(scope)}`);
  } catch (e) {
    ok = false;
    s.error((e as Error).message);
  }

  const desktop = claudeDesktopConfigPath();
  const inDesktop = existsSync(desktop) && readFileSync(desktop, "utf8").includes(`"${SERVER_NAME}"`);
  p.log.info(`Claude Desktop: ${inDesktop ? "connected" : "not connected"} (${desktop})`);
  p.outro(ok ? "Healthy." : "Fix the key with `npx garmin-personal-api-mcp setup`.");
  return ok ? 0 : 1;
}

export function runLogout(): void {
  const kc = deleteKeychain();
  const file = deleteKeyFile();
  if (existsSync(TOKEN_CACHE_FILE)) rmSync(TOKEN_CACHE_FILE);
  writeSettings({});
  console.error(
    kc || file
      ? `Removed the saved key${kc ? " from the Keychain" : ""}${file ? ` and ${DEFAULT_KEY_FILE}` : ""}, and the cached token.\nAlso delete the key in Garmin Connect (Settings → Personal API) if you no longer need it.`
      : "No saved key found. Nothing to remove.",
  );
}
