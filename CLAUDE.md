# garmin-personal-api-mcp

MCP server for a user's own Garmin Connect data via Garmin's official **Personal API** (read-only, GET only, key → 24 h bearer token). TypeScript, MCP TypeScript SDK **v2** (`@modelcontextprotocol/server`, Zod 4), stdio transport.

## Commands

- `npm run build`: tsc to `dist/`, marks `dist/index.js` executable
- `npm run check`: type-check + vitest + end-to-end smoke test (`scripts/smoke.mjs` runs the built server against a fake Garmin API on localhost)
- `npm run setup`: build, then run the interactive setup wizard
- `npx @modelcontextprotocol/inspector node dist/index.js`: manual tool testing

Run `npm run check` after every change.

## Layout

- `src/index.ts`: CLI router (`serve` default, `setup`, `status`, `logout`)
- `src/server.ts`: `createServer()` factory; resolves the key lazily so a key added by setup works without restart
- `src/tools.ts`: all 22 tools. Every tool has `title`, `description` and annotations (directory requirement)
- `src/api.ts`: `GarminClient`, endpoint paths, range chunking (`RANGE_ENDPOINTS.maxDays`), relative-date parsing, actionable HTTP error messages
- `src/auth.ts`: key → token exchange, memory + disk cache (0600), single in-flight refresh, retry once on 401
- `src/fit.ts`: unzip Garmin's download, decode with `@garmin/fitsdk`, interpolated distance splits with pause removal, pacing verdict
- `src/format.ts`: activity summaries, null-stripping, downsampling to stay under the 25k character limit
- `src/keystore.ts`: key lookup order `$GARMIN_PERSONAL_API_KEY` → macOS Keychain (`security -i`, never on argv) → `~/.config/garmin/connect-personal-api-key` (shared with Garmin's Python client)
- `src/cli/`: clack wizard, client registration (Claude Desktop / Claude Code / Cursor), status/logout

Endpoint paths come from Garmin's Apache-2.0 client, github.com/garmin/connect-personal-api-python (`src/garmin_personal_api/client.py`). Check there before adding endpoints; the Personal API host returns 404 for anything undocumented.

## Constraints

- **Read-only.** No write endpoints exist; don't add any.
- **No derived metrics** such as VO2 max, training readiness or recovery time. Garmin doesn't expose them.
- **Personal use only.** Garmin's FAQ says the Personal API is not for commercial multi-user apps. Never build a hosted/multi-tenant version; distribution is "each user runs it locally with their own key".
- **stdout is the MCP protocol** in serve mode. Log only to stderr.
- **Never log, print or put the key on a command line.** Use `maskKey()` for display.

## Status (2026-10-24)

- Built, unit tested and smoke tested; committed locally as the initial release
- **Not yet verified against a real key.** First thing to do: `npm run setup` with a real key, then `node dist/index.js status`, then ask "how was my last run?" in Claude. `summarizeActivity()` in `src/format.ts` assumes Garmin Connect's usual field names (`activityId`, `distance`, `duration`, `averageSpeed`, `averageHR`…). Adjust them if the real responses differ.
- npm name `garmin-connect-mcp` is taken, hence `garmin-personal-api-mcp`
- README still has `OWNER` placeholders in the clone URL and `package.json` `repository`

## Next: Claude Connectors Directory as a desktop extension (.mcpb)

Decided path: a local MCPB extension, not a remote connector (Garmin's terms, GDPR health data). Steps:

1. Push to GitHub (replace `OWNER`), publish to npm
2. `npm i -g @anthropic-ai/mcpb`, then add `manifest.json` (manifest_version 0.3):
   - `server`: node, entry `dist/index.js`
   - `user_config.api_key`: `{ type: string, sensitive: true, required: true }`, with a description holding the key-creation steps and link `https://connect.garmin.com/app/settings/personalApiToken`
   - `env`: `GARMIN_PERSONAL_API_KEY: ${user_config.api_key}`
   - `tools` list, `compatibility` (darwin, win32), `privacy_policies` (HTTPS URL)
3. `PRIVACY.md`: collects nothing; data flows Garmin → user's machine → their MCP client. Link it from the README and manifest (both required, or the submission is rejected)
4. Icon: an original 512×512 PNG. Not Garmin's logo; follow Garmin brand guidelines, and keep the display name descriptive ("…for Garmin Connect")
5. Example prompts per tool in the README for reviewers
6. Add `windows-latest` to the CI matrix. Keychain code is macOS-only; on Windows the env var/file paths are used
7. `mcpb pack`, install by double-click in Claude Desktop, test on macOS and Windows
8. Submit via the MCP Directory Submission Form (linked from support.claude.com article 11596036). Reviewers will need test access: a Garmin account with some activities, plus a key
