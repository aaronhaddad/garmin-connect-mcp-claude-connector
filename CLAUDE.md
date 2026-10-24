# garmin-personal-api-mcp

MCP server for a user's own Garmin Connect data via Garmin's official **Personal API** (read-only, GET only, key → 24 h bearer token). TypeScript, MCP TypeScript SDK **v2** (`@modelcontextprotocol/server`, Zod 4), stdio transport.

## Commands

- `npm run build`: tsc to `dist/`, marks `dist/index.js` executable
- `npm run check`: type-check + vitest + end-to-end smoke test (`scripts/smoke.mjs` runs the built server against a fake Garmin API on localhost)
- `npm run setup`: build, then run the interactive setup wizard
- `npm run pack:mcpb`: build the Claude Desktop extension (`scripts/pack-mcpb.mjs` stages `dist/` with production-only deps, validates `manifest.json`, writes `garmin-personal-api-mcp-<version>.mcpb`)
- `npm version patch && git push --follow-tags`: release. The `version` hook copies the version into `manifest.json`; the `v*` tag triggers `.github/workflows/release.yml`, which checks, packs, attaches the `.mcpb` to a GitHub Release and publishes to npm via trusted publishing (OIDC, no token; configured on npmjs.com for `release.yml`)
- `npx @modelcontextprotocol/inspector node dist/index.js`: manual tool testing

Run `npm run check` after every change.

Gotchas on this machine: Node lives in nvm (`~/.nvm/versions/node/v24.16.0/bin`), which non-interactive shells don't load, so prepend it to PATH. The global `~/.npmrc` sets `legacy-peer-deps=true`; `vite` is pinned in devDependencies so vitest still installs correctly.

## Layout

- `src/index.ts`: CLI router (`serve` default, `setup`, `status`, `logout`)
- `src/server.ts`: `createServer()` factory; resolves the key lazily so a key added by setup works without restart
- `src/tools.ts`: all 23 tools. Every tool has `title`, `description` and annotations (directory requirement)
- `src/api.ts`: `GarminClient`, endpoint paths, range chunking (`RANGE_ENDPOINTS.maxDays`), relative-date parsing, actionable HTTP error messages
- `src/auth.ts`: key → token exchange, memory + disk cache (0600), single in-flight refresh, retry once on 401
- `src/fit.ts`: unzip Garmin's download, decode with `@garmin/fitsdk` (with `includeUnknownData`), interpolated distance splits with pause removal, pacing verdict, and `performanceMetrics()` for Garmin's undocumented messages 79/140 (VO2 max, training effect, recovery)
- `src/format.ts`: activity summaries, null-stripping, downsampling to stay under the 25k character limit
- `src/keystore.ts`: key lookup order `$GARMIN_PERSONAL_API_KEY` → macOS Keychain (`security -i`, never on argv) → `~/.config/garmin/connect-personal-api-key` (shared with Garmin's Python client)
- `src/cli/`: clack wizard, client registration (Claude Desktop / Claude Code / Cursor), status/logout
- `plugin/`: the Claude plugin (Claude Code, Cowork): `.claude-plugin/plugin.json` with a sensitive `userConfig.api_key` (default `""`, because Cowork skips servers whose options have no default), `.mcp.json` running `npx -y garmin-personal-api-mcp@<exact version>` with `GARMIN_MCP_RUNTIME=plugin`, and the `garmin-training-insights` skill. `.claude-plugin/marketplace.json` at the repo root makes the repo installable as a marketplace. `npm version` keeps the plugin's version and npx pin in step (`scripts/sync-manifest-version.mjs`). Validate with `claude plugin validate ./plugin`
- `manifest.json`, `icon.png`, `PRIVACY.md`: the MCPB extension. Bump `manifest.json` `version` with `package.json` (the pack script refuses a mismatch). `display_name` must match `EXTENSION_DISPLAY_NAME` in `src/constants.ts`
- Key-fix messages go through `keyFixHint()` in `src/keystore.ts`: "run setup" for the CLI, "Claude Desktop → Settings → Extensions" when `GARMIN_MCP_RUNTIME=mcpb` (set by the manifest). Never hardcode "run setup" in a message the model or user sees

Endpoint paths come from Garmin's Apache-2.0 client, github.com/garmin/connect-personal-api-python (`src/garmin_personal_api/client.py`). Check there before adding endpoints; the Personal API host returns 404 for anything undocumented.

## Constraints

- **Read-only.** No write endpoints exist; don't add any.
- **Derived metrics only from FIT files.** The API has no endpoints for them (`/metrics-service/*` returns 404), but watches write some into each activity file: msg 79 field 17 = VO2 max before the activity, msg 140 field 7 = after, field 27 > 0 = new reading, 4/20 = training effect ×10, 9 = recovery minutes, 17 = performance condition. VO2 max = raw × 3.5 / 65536. VO2 max and training effect were verified against Garmin Connect (2026-10-24); recovery and performance condition are not. Training readiness, training status and race predictions are server-side only; don't add login scraping to get them
- **Personal use only.** Garmin's FAQ says the Personal API is not for commercial multi-user apps. Never build a hosted/multi-tenant version; distribution is "each user runs it locally with their own key".
- **stdout is the MCP protocol** in serve mode. Log only to stderr.
- **Never log, print or put the key on a command line.** Use `maskKey()` for display.

## Status (2026-10-25)

- Built, unit tested and smoke tested. Repo: github.com/aaronhaddad/garmin-connect-mcp-claude-connector (public since 2026-10-25). Released as v1.0.1 on GitHub (with `.mcpb`) and npm (`garmin-personal-api-mcp`, account `aaronhaddad_`, 2FA required)
- MCPB extension installed and working in Claude Desktop on macOS (2026-10-25); demo GIF and walkthrough video are in the README
- **Verified against a real key** (2026-10-24): setup, activity list, FIT splits and the performance-metrics tool all work on real data, and the list's field names match `summarizeActivity()`
- npm name `garmin-connect-mcp` is taken, hence `garmin-personal-api-mcp`

## Distribution: desktop extension (.mcpb), npm, and the Claude plugin

Decided path: a local MCPB extension, not a remote connector (Garmin's terms, GDPR health data). Steps:

1. ~~Push to GitHub, publish to npm~~ (done: v1.0.1)
2. ~~Add `manifest.json`~~ (done; `@anthropic-ai/mcpb` is a devDependency, no global install) (manifest_version 0.3):
   - `server`: node, entry `dist/index.js`
   - `user_config.api_key`: `{ type: string, sensitive: true, required: true }`, with a description holding the key-creation steps and link `https://connect.garmin.com/app/settings/personalApiToken`
   - `env`: `GARMIN_PERSONAL_API_KEY: ${user_config.api_key}`
   - `tools` list, `compatibility` (darwin, win32), `privacy_policies` (HTTPS URL)
3. ~~`PRIVACY.md`~~ (done): collects nothing; data flows Garmin → user's machine → their MCP client. Link it from the README and manifest (both required, or the submission is rejected)
4. ~~Icon~~ (done: watch-face ring with a heartbeat line, v1.0.3): an original 512×512 PNG. Not Garmin's logo; follow Garmin brand guidelines, and keep the display name descriptive ("…for Garmin Connect")
5. ~~Example prompts per tool~~ (done) in the README for reviewers
6. ~~Add `windows-latest` to the CI matrix~~ (done; Node matrix is 22/24 because vitest 5 needs 22.12+, plus a job that packs the `.mcpb` as a CI artifact). Keychain code is macOS-only; on Windows the env var/file paths are used
7. ~~`mcpb pack`, install by double-click in Claude Desktop~~ (done on macOS: installs disabled until the key is saved in Settings → Extensions, then works). Windows not tested
8. ~~Extension-aware errors~~ (done): all five "run setup" sites (`NO_KEY`, expiry note and stderr banner in `server.ts`, 401 in `api.ts`, token exchange in `auth.ts`) use `keyFixHint()`. The expiry note is skipped for env-var keys, because `settings.keyExpiresOn` belongs to the key `setup` saved, not the extension's
9. **Changed (2026-10-25):** the directory no longer accepts `.mcpb` extensions (desktop extension listings are deprecated); local servers are listed only inside a plugin. Submit `plugin/` at claude.ai/directory/manage → Submit new → **Plugin bundle**, repo `aaronhaddad/garmin-connect-mcp-claude-connector`, plugin path `plugin`. A pinned npx package is always held for a human reviewer, and the Garmin name likely triggers a brand hold; both are expected. The plugin's local server runs in Claude Code and Cowork on the user's computer, not in plain chat, so the `.mcpb` download stays for Claude Desktop chat users

## How the extension works (target behaviour)

- The user installs the `.mcpb` from the directory or by double-clicking it. Claude Desktop's install screen is generated from `manifest.json`: name, icon, description, privacy link and one masked field for the API key, whose help text has the key page link and steps.
- Claude Desktop stores the key and launches `dist/index.js` with **its bundled Node**, passing `GARMIN_PERSONAL_API_KEY` in the environment. The server already checks that variable first, so `keystore.ts` needs no change. Our Keychain code is only for the CLI path.
- The rest is unchanged: stdio, token exchange and cache, GET to Garmin, FIT parsing on the user's machine. No data passes through any server of ours.
- Claude Desktop only (macOS and Windows), one install per machine, each user with their own key.
- The CLI wizard (`setup`/`status`/`logout`) stays for Claude Code, Cursor and npm users.
