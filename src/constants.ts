import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

export const PACKAGE_NAME = pkg.name;
export const VERSION = pkg.version;
export const SERVER_NAME = "garmin-connect";

export const DEFAULT_BASE_URL = "https://personal.connectapi.garmin.com";
export const BASE_URL = (process.env.GARMIN_PERSONAL_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
export const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

/** Where Garmin Connect lets you create a Personal API key. */
export const KEY_PAGE_URL = "https://connect.garmin.com/app/settings/personalApiToken";
export const DOCS_URL = "https://developer.garmin.com/gc-developer-program/personal/personal-api";

export const API_KEY_ENV_VAR = "GARMIN_PERSONAL_API_KEY";

/** Same default path as Garmin's official Python client, so either tool can reuse the key. */
export const DEFAULT_KEY_FILE = join(homedir(), ".config", "garmin", "connect-personal-api-key");
export const CONFIG_DIR = process.env.GARMIN_MCP_CONFIG_DIR ?? join(homedir(), ".config", "garmin-personal-api-mcp");
export const TOKEN_CACHE_FILE = join(CONFIG_DIR, "token.json");
export const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");

export const KEYCHAIN_SERVICE = "garmin-connect-personal-api";
export const KEYCHAIN_ACCOUNT = "garmin-personal-api-mcp";

export const REQUEST_TIMEOUT_MS = 30_000;
/** Refresh the 24 h bearer token when less than this remains. */
export const TOKEN_REFRESH_WINDOW_MS = 60 * 60 * 1000;
export const CHARACTER_LIMIT = 25_000;
