/**
 * Exchanges a Personal API key for a short-lived (24 h) bearer token and caches it,
 * in memory and on disk (0600), keyed by a fingerprint of the key so a new key
 * never reuses an old token.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  BASE_URL,
  PACKAGE_NAME,
  REQUEST_TIMEOUT_MS,
  TOKEN_CACHE_FILE,
  TOKEN_PATH,
  TOKEN_REFRESH_WINDOW_MS,
  VERSION,
} from "./constants.js";

export interface BearerToken {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export class GarminAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GarminAuthError";
  }
}

const fingerprint = (key: string) => createHash("sha256").update(`${BASE_URL}\0${key}`).digest("hex");

export function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    // fall through
  }
  // Garmin documents 24 h validity; assume that if the claim is unreadable.
  return Date.now() + 24 * 60 * 60 * 1000;
}

/** Decoded JWT payload, for showing granted scopes in `status`. Never verified, never trusted. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** One token request, no caching. Used by setup to validate a freshly pasted key. */
export async function exchangeKey(key: string, signal?: AbortSignal): Promise<BearerToken> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        Accept: "*/*",
        Authorization: `ApiKey ${key}`,
        "User-Agent": `${PACKAGE_NAME}/${VERSION}`,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new GarminAuthError("Garmin's token service did not answer within 30 seconds. Check your connection and try again.");
    }
    throw new GarminAuthError(`Could not reach Garmin (${(err as Error).message}). Check your internet connection.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new GarminAuthError(
      "Garmin rejected the Personal API key. It may be mistyped, expired or deleted. Create a new one and run `garmin-personal-api-mcp setup` again.",
      res.status,
    );
  }
  if (!res.ok) {
    throw new GarminAuthError(`Garmin's token service returned HTTP ${res.status}. Try again in a minute.`, res.status);
  }
  const accessToken = (await res.text()).trim().replace(/^"|"$/g, "");
  if (!accessToken.includes(".")) {
    throw new GarminAuthError("Garmin's token service returned something that is not a token. Try again later.");
  }
  return { accessToken, expiresAt: jwtExpiry(accessToken) };
}

export class TokenManager {
  private memory?: { fp: string; token: BearerToken };
  private inflight?: Promise<BearerToken>;

  constructor(
    private readonly getKey: () => string,
    private readonly cacheFile: string | null = TOKEN_CACHE_FILE,
  ) {}

  async getToken(forceRefresh = false, signal?: AbortSignal): Promise<string> {
    const key = this.getKey();
    const fp = fingerprint(key);
    if (!forceRefresh) {
      const cached = this.memory?.fp === fp ? this.memory.token : this.readDisk(fp);
      if (cached && cached.expiresAt - Date.now() > TOKEN_REFRESH_WINDOW_MS) {
        this.memory = { fp, token: cached };
        return cached.accessToken;
      }
    }
    // Collapse concurrent refreshes from parallel tool calls into one request.
    const pending =
      this.inflight ??
      (this.inflight = exchangeKey(key, signal).finally(() => {
        this.inflight = undefined;
      }));
    const token = await pending;
    this.memory = { fp, token };
    this.writeDisk(fp, token);
    return token.accessToken;
  }

  private readDisk(fp: string): BearerToken | undefined {
    if (!this.cacheFile) return undefined;
    try {
      const data = JSON.parse(readFileSync(this.cacheFile, "utf8")) as { fp: string } & BearerToken;
      return data.fp === fp ? { accessToken: data.accessToken, expiresAt: data.expiresAt } : undefined;
    } catch {
      return undefined;
    }
  }

  private writeDisk(fp: string, token: BearerToken): void {
    if (!this.cacheFile) return;
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true, mode: 0o700 });
      writeFileSync(this.cacheFile, JSON.stringify({ fp, ...token }), { mode: 0o600 });
    } catch {
      // A read-only home directory only costs one extra token request per start.
    }
  }
}
