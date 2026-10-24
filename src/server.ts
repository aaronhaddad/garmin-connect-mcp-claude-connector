import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { GarminClient } from "./api.js";
import { TokenManager } from "./auth.js";
import { SERVER_NAME, VERSION } from "./constants.js";
import { daysUntilKeyExpiry, resolveKey } from "./keystore.js";
import { registerTools } from "./tools.js";

const NO_KEY =
  "No Garmin Personal API key is set up on this computer. Ask the user to run `npx garmin-personal-api-mcp setup` in a terminal (it walks them through creating and saving the key), then restart this app.";

/** Key is resolved per token refresh, so a key added by `setup` works without restarting. */
function getKey(): string {
  const found = resolveKey();
  if (!found) throw new Error(NO_KEY);
  return found.key;
}

const client = new GarminClient(new TokenManager(getKey));

export function createServer(): McpServer {
  const days = daysUntilKeyExpiry();
  const expiryNote =
    days === undefined ? "" : days < 0 ? " The saved key has expired; tell the user to run `npx garmin-personal-api-mcp setup`." : days <= 7 ? ` The key expires in ${days} day(s); mention that the user should renew it with \`npx garmin-personal-api-mcp setup\`.` : "";

  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    {
      instructions:
        "Read-only access to the user's own Garmin Connect data through Garmin's official Personal API: activities (with exact splits from the .FIT file), sleep, HRV, Body Battery, stress, steps, weight and nutrition. Start with garmin_get_day for recovery questions and garmin_list_activities → garmin_get_activity_splits for training questions. Dates accept YYYY-MM-DD, 'today', 'yesterday' or 'N days ago'. Garmin's derived metrics such as VO2 max, training readiness and recovery time are not exposed by this API." +
        expiryNote,
    },
  );
  registerTools(server, client);
  return server;
}

export function startStdio(): void {
  serveStdio(createServer);
  const key = resolveKey();
  console.error(`garmin-personal-api-mcp ${VERSION} on stdio · key: ${key ? key.location : "not set (run `garmin-personal-api-mcp setup`)"}`);
}
