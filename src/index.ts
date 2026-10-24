#!/usr/bin/env node
/**
 * garmin-personal-api-mcp
 *   (no args) | serve   start the MCP server on stdio (what Claude runs)
 *   setup               interactive wizard: create, verify and save your key; connect apps
 *   status              check the saved key against Garmin
 *   logout              remove the saved key and token cache
 */
import { VERSION } from "./constants.js";

const HELP = `garmin-personal-api-mcp ${VERSION}
MCP server for your own Garmin Connect data, via Garmin's official Personal API.

Usage:
  npx garmin-personal-api-mcp setup      Interactive setup: key + connect Claude
  npx garmin-personal-api-mcp status     Check the saved key still works
  npx garmin-personal-api-mcp logout     Remove the saved key
  npx garmin-personal-api-mcp            Run the server on stdio (used by MCP clients)

Setup flags:
  --key-stdin           Read the key from stdin (e.g. pbpaste | ... setup --key-stdin)
  --storage <kind>      keychain | file
  --no-clients          Don't register with any apps

Key lookup order: $GARMIN_PERSONAL_API_KEY, macOS Keychain, ~/.config/garmin/connect-personal-api-key`;

async function main(): Promise<void> {
  const [cmd = "serve", ...rest] = process.argv.slice(2);
  const flag = (name: string) => rest.includes(`--${name}`);
  const value = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };

  switch (cmd) {
    case "serve": {
      const { startStdio } = await import("./server.js");
      startStdio();
      return;
    }
    case "setup": {
      const storage = value("storage");
      if (storage && storage !== "keychain" && storage !== "file") throw new Error("--storage must be keychain or file");
      const { runSetup } = await import("./cli/setup.js");
      await runSetup({ keyStdin: flag("key-stdin"), storage: storage as "keychain" | "file" | undefined, noClients: flag("no-clients") });
      return;
    }
    case "status": {
      const { runStatus } = await import("./cli/status.js");
      process.exitCode = await runStatus();
      return;
    }
    case "logout": {
      const { runLogout } = await import("./cli/status.js");
      runLogout();
      return;
    }
    case "-v":
    case "--version":
      console.log(VERSION);
      return;
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command "${cmd}".\n\n${HELP}`);
      process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
