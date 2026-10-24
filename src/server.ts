import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { GarminClient } from "./api.js";
import { TokenManager } from "./auth.js";
import { SERVER_NAME, VERSION } from "./constants.js";
import { daysUntilKeyExpiry, isExtension, isPlugin, KEY_STOP_NOTE, keyFixHint, type KeySource, resolveKey } from "./keystore.js";
import { registerTools } from "./tools.js";

function noKeyMessage(): string {
  if (isPlugin()) return `No Garmin Personal API key is set for this plugin or on this computer. Ask the user to ${keyFixHint()}. ${KEY_STOP_NOTE}`;
  return isExtension()
    ? `No Garmin Personal API key is set in this extension. Ask the user to ${keyFixHint()}. ${KEY_STOP_NOTE}`
    : "No Garmin Personal API key is set up on this computer. Ask the user to run `npx garmin-personal-api-mcp setup` in a terminal (it walks them through creating and saving the key), then restart this app. " + KEY_STOP_NOTE;
}

/** Key is resolved per token refresh, so a key added by `setup` works without restarting. */
function getKey(): string {
  const found = resolveKey();
  if (!found) throw new Error(noKeyMessage());
  return found.key;
}

/** The expiry date in settings belongs to the key `setup` saved; an env key (e.g. from the extension) may be a different one. */
export function keyExpiryNote(source: KeySource | undefined, days: number | undefined): string {
  if (source === undefined || source === "env" || days === undefined) return "";
  if (days < 0) return ` The saved key has expired; tell the user to ${keyFixHint()}.`;
  if (days <= 7) return ` The key expires in ${days} day(s); mention that the user should ${keyFixHint()}.`;
  return "";
}

const client = new GarminClient(new TokenManager(getKey));

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    {
      instructions:
        "Read-only access to the user's own Garmin Connect data through Garmin's official Personal API: activities (with exact splits from the .FIT file), sleep, HRV, Body Battery, stress, steps, weight and nutrition. Start with garmin_get_day for recovery questions and garmin_list_activities → garmin_get_activity_splits for training questions. Dates accept YYYY-MM-DD, 'today', 'yesterday' or 'N days ago'. For VO2 max (as Garmin Connect shows it), training effect and recovery time use garmin_get_performance_metrics, which decodes them from the activity files. Training readiness, training status and race predictions are computed on Garmin's servers and are not available." +
        keyExpiryNote(resolveKey()?.source, daysUntilKeyExpiry()),
    },
  );
  registerTools(server, client);
  return server;
}

export function startStdio(): void {
  serveStdio(createServer);
  const key = resolveKey();
  console.error(`garmin-personal-api-mcp ${VERSION} on stdio · key: ${key ? key.location : `not set (${keyFixHint()})`}`);
}
