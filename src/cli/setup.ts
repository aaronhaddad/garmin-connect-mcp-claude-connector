import * as p from "@clack/prompts";
import { GarminClient, type Json } from "../api.js";
import { exchangeKey, GarminAuthError, jwtClaims, TokenManager } from "../auth.js";
import { DEFAULT_KEY_FILE, DOCS_URL, KEY_PAGE_URL, VERSION } from "../constants.js";
import { isObj, summarizeActivity } from "../format.js";
import {
  daysUntilKeyExpiry,
  deleteKeychain,
  deleteKeyFile,
  keychainAvailable,
  maskKey,
  readSettings,
  resolveKey,
  writeKeychain,
  writeKeyFile,
  writeSettings,
  type Settings,
} from "../keystore.js";
import { configSnippet, detectClients, launchCommand, registerClient, type ClientTarget } from "./clients.js";
import { canReadClipboard, clearClipboard, openUrl, readClipboard, readStdin } from "./system.js";

export interface SetupFlags {
  keyStdin?: boolean;
  storage?: "keychain" | "file";
  noClients?: boolean;
}

/** Exits cleanly on Ctrl-C at any prompt. */
function must<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled. Nothing was changed.");
    process.exit(130);
  }
  return value as Exclude<T, symbol>;
}

const looksLikeKey = (s: string) => s.length >= 16 && !/\s/.test(s);

interface Verified {
  scopes: string[];
  profileName?: string;
  latest?: string;
}

async function verify(key: string): Promise<Verified> {
  const token = await exchangeKey(key);
  const claims = jwtClaims(token.accessToken);
  const scopeClaim = claims.scope ?? claims.scopes ?? claims.authorities;
  const scopes = Array.isArray(scopeClaim) ? scopeClaim.map(String) : typeof scopeClaim === "string" ? scopeClaim.split(/[\s,]+/) : [];

  // Same client the server uses, pinned to this key and without touching the disk cache.
  const client = new GarminClient(new TokenManager(() => key, null));
  const [profile, recent] = await Promise.all([client.profileSettings().catch(() => null), client.searchActivities({ limit: 1 }).catch(() => null)]);
  const name = pickName(profile);
  const first = Array.isArray(recent) ? summarizeActivity(recent[0]) : undefined;
  const latest = first
    ? `${first.name ?? first.type ?? "activity"}${first.distance_km ? `, ${first.distance_km} km` : ""}${first.start_local ? ` on ${first.start_local.slice(0, 10)}` : ""}`
    : undefined;
  return { scopes: scopes.filter(Boolean), profileName: name, latest };
}

function pickName(profile: Json): string | undefined {
  if (!isObj(profile)) return undefined;
  for (const k of ["displayName", "fullName", "userName"]) if (typeof profile[k] === "string") return profile[k] as string;
  if (isObj(profile.userData)) return pickName(profile.userData);
  return undefined;
}

function expiryFromChoice(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function runSetup(flags: SetupFlags = {}): Promise<void> {
  // ---------- Non-interactive path: pbpaste | garmin-personal-api-mcp setup --key-stdin ----------
  if (flags.keyStdin) {
    const key = await readStdin();
    if (!looksLikeKey(key)) throw new Error("stdin did not contain a Personal API key.");
    const v = await verify(key);
    const storage = flags.storage ?? (keychainAvailable() ? "keychain" : "file");
    if (storage === "keychain") writeKeychain(key);
    else writeKeyFile(key);
    writeSettings({ ...readSettings(), storage, setupAt: new Date().toISOString() });
    console.error(`Key verified${v.profileName ? ` for ${v.profileName}` : ""} and saved to ${storage === "keychain" ? "the macOS Keychain" : DEFAULT_KEY_FILE}.`);
    if (!flags.noClients) console.error(`\nAdd this to your MCP client:\n${configSnippet(launchCommand())}`);
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error("Setup is interactive. Run it in a terminal, or pipe the key in with `--key-stdin`.");
  }

  console.clear();
  p.intro(` Garmin Connect MCP · setup v${VERSION} `);

  // ---------- Existing key? ----------
  const existing = resolveKey();
  if (existing) {
    const days = daysUntilKeyExpiry();
    const status = days === undefined ? "" : days < 0 ? " · EXPIRED" : ` · expires in ${days} day${days === 1 ? "" : "s"}`;
    const choice = must(
      await p.select({
        message: `A key is already saved (${maskKey(existing.key)} in ${existing.location}${status}). What now?`,
        options: [
          { value: "replace", label: "Replace it with a new key" },
          { value: "verify", label: "Just check it still works" },
          { value: "clients", label: "Keep it, and connect Claude / other apps" },
        ],
      }),
    );
    if (choice === "verify") {
      const s = p.spinner();
      s.start("Asking Garmin");
      try {
        const v = await verify(existing.key);
        s.stop(`Working${v.profileName ? `: signed in as ${v.profileName}` : ""}${v.latest ? ` · latest: ${v.latest}` : ""}`);
      } catch (e) {
        s.error((e as Error).message);
      }
      p.outro("Done.");
      return;
    }
    if (choice === "clients") {
      await connectClients(flags);
      p.outro("Done. Restart the apps you connected.");
      return;
    }
  }

  // ---------- Step 1: create the key in Garmin Connect ----------
  p.note(
    [
      "Garmin lets you create a key for your own data, no approval needed.",
      "",
      "  1. Sign in to Garmin Connect in the browser",
      "  2. Settings → Personal API → Create Key",
      "  3. Accept the terms and pick an expiry",
      "  4. Copy the key. Garmin shows it only once.",
      "",
      `Page:  ${KEY_PAGE_URL}`,
      `Docs:  ${DOCS_URL}`,
    ].join("\n"),
    "Step 1 · Create a Personal API key",
  );

  const open = must(await p.confirm({ message: "Open the Personal API page in your browser?", initialValue: true }));
  if (open) {
    const ok = await openUrl(KEY_PAGE_URL);
    if (!ok) p.log.warn(`Couldn't open a browser here. Open this link yourself:\n${KEY_PAGE_URL}`);
  }

  const expiryDays = must(
    await p.select({
      message: "Which expiry did you pick? (so I can remind you before it runs out)",
      options: [
        { value: 30, label: "30 days" },
        { value: 90, label: "90 days" },
        { value: 180, label: "180 days" },
        { value: 365, label: "1 year" },
        { value: 0, label: "Not sure / no expiry", hint: "no reminders" },
      ],
      initialValue: 365,
    }),
  );

  // ---------- Step 2: get the key into this program without echoing it ----------
  let key = "";
  let fromClipboard = false;
  for (let attempt = 0; attempt < 3 && !key; attempt++) {
    const clip = canReadClipboard() ? readClipboard() : undefined;
    if (clip && looksLikeKey(clip)) {
      const use = must(await p.confirm({ message: `Found a key-like value on your clipboard (${maskKey(clip)}). Use it?`, initialValue: true }));
      if (use) {
        key = clip;
        fromClipboard = true;
        break;
      }
    }
    const pasted = must(
      await p.password({
        message: "Paste the key (input is hidden)",
        mask: "•",
        validate: (v) => (!v || !looksLikeKey(v.trim()) ? "That doesn't look like a key: it should be one long string without spaces." : undefined),
      }),
    ).trim();

    const s = p.spinner();
    s.start("Checking the key with Garmin");
    try {
      await exchangeKey(pasted);
      s.stop("Garmin accepted the key");
      key = pasted;
    } catch (e) {
      s.error(e instanceof GarminAuthError ? e.message : `Couldn't check the key: ${(e as Error).message}`);
      if (attempt === 2) {
        p.cancel("Three failed attempts. Create a fresh key and run setup again.");
        process.exit(1);
      }
    }
  }

  // ---------- Step 3: show what we can see ----------
  const s = p.spinner();
  s.start("Reading your account");
  const verified = await verify(key).catch((e: Error) => {
    s.error(e.message);
    p.cancel("The key was not saved.");
    return process.exit(1);
  });
  s.stop("Connected to Garmin Connect");
  p.note(
    [
      verified.profileName ? `Account:   ${verified.profileName}` : undefined,
      verified.latest ? `Latest:    ${verified.latest}` : "Latest:    no activities found yet",
      verified.scopes.length ? `Access:    ${verified.scopes.map((x) => x.replace(/^PERSONAL_API_/, "").toLowerCase()).join(", ")}` : undefined,
      "Mode:      read-only. Nothing can be written to your account.",
    ]
      .filter(Boolean)
      .join("\n"),
    "Step 2 · Verified",
  );

  // ---------- Step 4: store it ----------
  const storageOptions = [
    ...(keychainAvailable() ? [{ value: "keychain" as const, label: "macOS Keychain", hint: "recommended: encrypted, tied to your login" }] : []),
    { value: "file" as const, label: `File at ${DEFAULT_KEY_FILE}`, hint: "chmod 600, shared with Garmin's own Python client" },
  ];
  const storage = flags.storage ?? (storageOptions.length === 1 ? "file" : must(await p.select({ message: "Where should the key live?", options: storageOptions })));

  try {
    if (storage === "keychain") {
      writeKeychain(key);
      deleteKeyFile(); // don't leave a second, plain-text copy behind
    } else {
      writeKeyFile(key);
      deleteKeychain();
    }
  } catch (e) {
    p.cancel((e as Error).message);
    process.exit(1);
  }
  const settings: Settings = {
    ...readSettings(),
    storage,
    keyExpiresOn: expiryDays ? expiryFromChoice(expiryDays) : undefined,
    setupAt: new Date().toISOString(),
  };
  writeSettings(settings);
  p.log.success(`Saved to ${storage === "keychain" ? "the macOS Keychain" : DEFAULT_KEY_FILE}${settings.keyExpiresOn ? ` · expires ${settings.keyExpiresOn}` : ""}`);

  if (fromClipboard) {
    const wipe = must(await p.confirm({ message: "Clear the key from your clipboard?", initialValue: true }));
    if (wipe) clearClipboard();
  }

  // ---------- Step 5: connect apps ----------
  if (!flags.noClients) await connectClients(flags);

  p.outro("All set. Restart Claude, then try: “How was my pacing on my last run?”");
}

async function connectClients(flags: SetupFlags): Promise<void> {
  const launch = launchCommand();
  const clients = detectClients();
  const options = [
    ...clients.map((c) => ({ value: c.id as ClientTarget["id"] | "print", label: `${c.label}${c.detected ? "" : " (not detected)"}`, hint: c.hint })),
    { value: "print" as const, label: "Show me the JSON to paste elsewhere" },
  ];
  const picked = must(
    await p.multiselect({
      message: "Connect it to which apps? (space to toggle, enter to confirm)",
      options,
      initialValues: clients.filter((c) => c.detected).map((c) => c.id),
      required: false,
    }),
  );
  for (const id of picked) {
    if (id === "print") {
      p.note(configSnippet(launch), "MCP config");
      continue;
    }
    try {
      p.log.success(`${clients.find((c) => c.id === id)?.label}: ${registerClient(id, launch)}`);
    } catch (e) {
      p.log.error(`${id}: ${(e as Error).message}`);
    }
  }
  if (launch.kind === "local") {
    p.log.info(`Registered as \`${launch.command} ${launch.args.join(" ")}\`. If you move this folder, run setup again.`);
  }
  void flags;
}
