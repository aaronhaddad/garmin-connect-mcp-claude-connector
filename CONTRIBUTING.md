# Contributing

Thanks for helping. This is a small project, so the rules below are short, but they matter.

## Ground rules

These come from Garmin's terms and from how the extension is reviewed. Pull requests that break them won't be merged.

- **Read-only.** The Personal API has no write endpoints, and this server must never call anything but GET.
- **Local, one user, their own key.** No hosted, shared or multi-user version, and nothing that sends data anywhere except between Garmin and the user's own MCP app.
- **No login scraping.** Metrics Garmin doesn't expose through the Personal API (training readiness, training status, race predictions) stay out, even if an unofficial route exists.
- **Never log the key, print it or put it on a command line.** Use `maskKey()` when you need to show it.

## Setup

You need Node.js 22.12 or later to run the tests (the server itself supports 20.3+), and a Garmin Connect account with a [Personal API key](https://connect.garmin.com/app/settings/personalApiToken) if you want to try it against real data.

```bash
git clone https://github.com/aaronhaddad/garmin-connect-mcp-claude-connector.git
cd garmin-connect-mcp-claude-connector
npm install
npm run check
```

| Command | What it does |
|---|---|
| `npm run check` | Type-check, unit tests and an end-to-end smoke test that runs the built server against a fake Garmin API. No key needed. |
| `npm run setup` | Build, then run the setup wizard with your own key |
| `npm run pack:mcpb` | Build the Claude Desktop extension (`.mcpb`) into the repo root |
| `npx @modelcontextprotocol/inspector node dist/index.js` | Try tools by hand |

To test the extension, double-click the `.mcpb` you packed, then add your key in Claude Desktop → Settings → Extensions → Personal Data for Garmin Connect.

## Where things live

| Path | What it is |
|---|---|
| `src/tools.ts` | All MCP tools |
| `src/api.ts` | `GarminClient`, endpoint paths, date-range chunking and HTTP error messages |
| `src/auth.ts` | Key → 24-hour token exchange and the token cache |
| `src/keystore.ts` | Key lookup (env var → macOS Keychain → key file) and `keyFixHint()` |
| `src/fit.ts` | `.FIT` decoding: splits, pacing verdict and `performanceMetrics()` |
| `src/format.ts` | Activity summaries and trimming responses to fit the model's limits |
| `src/cli/` | The setup wizard, `status` and `logout` |
| `manifest.json`, `icon.png`, `PRIVACY.md` | The Claude Desktop extension |
| `plugin/`, `.claude-plugin/marketplace.json` | The Claude plugin for Claude Code and Cowork: manifest, `.mcp.json` (runs the npm package, pinned) and the `garmin-training-insights` skill |
| `scripts/smoke.mjs` | The end-to-end smoke test and its fake Garmin API |

[CLAUDE.md](CLAUDE.md) has more detail on conventions.

## Common changes

### Adding an endpoint

Check Garmin's official [connect-personal-api-python](https://github.com/garmin/connect-personal-api-python) client (`src/garmin_personal_api/client.py`) first. The Personal API returns 404 for anything it doesn't document, so guessing paths wastes time. Add the path to `GarminClient` in `src/api.ts`, and if it takes a date range, give it the maximum span Garmin accepts so long ranges are split correctly.

### Adding a tool

A new tool has to be added in four places:

1. **`src/tools.ts`:** register it with a `title`, a description that tells the model when to use it, and `annotations: READ_ONLY`. All three are required for the Claude extension directory.
2. **`manifest.json`:** add it to the `tools` list. This is what the install screen shows.
3. **`README.md`:** add a row to both collapsible tables: what it gives Claude, and an example prompt.
4. **`scripts/smoke.mjs`:** if it's a core tool, add it to the list of names the smoke test requires, and call it against the fake API.

If the tool answers a new kind of question, add it to the table in `plugin/skills/garmin-training-insights/SKILL.md` too, and run `claude plugin validate ./plugin`.

If the tool changes which tool Claude should reach for first, update the instructions in `src/server.ts` too.

### Errors about the key

Messages the user or model sees must tell them how to fix the key using `keyFixHint()`, never a hardcoded "run setup". In the Claude Desktop extension the fix is "Settings → Extensions", not a terminal command. End them with `KEY_STOP_NOTE`, so the model tells the user instead of looking for the data some other way.

### Metrics from FIT files

VO2 max, training effect and recovery time come from undocumented messages in Garmin's activity files; the field map is in `src/fit.ts` and CLAUDE.md. If you decode a new field, **check its values against what Garmin Connect shows** for a few real activities before claiming it's accurate, and say in the PR which activities you checked. Anything unverified must be labelled approximate in the tool output.

## Pull requests

- `npm run check` passes. CI runs it on Ubuntu, macOS and Windows with Node 22 and 24.
- New behaviour has a test next to the code it covers (`test/*.test.ts`).
- Don't bump the version or edit release files; the maintainer does that when releasing.
- Keep PRs focused: one change per PR is easier to review.

Found a bug? Open an issue with what you asked, what you expected and what came back. **Never paste your API key** or raw personal data into an issue.

## Releasing (maintainer)

```bash
npm version patch            # or minor / major; bumps package.json and manifest.json together
git push --follow-tags
```

The `v*` tag runs `.github/workflows/release.yml`, which checks, packs the extension and publishes a GitHub Release with `garmin-personal-api-mcp-<version>.mcpb` and the unversioned copy the README's download button points to, then publishes the package to npm. npm trusts the workflow directly (trusted publishing), so there's no npm token in the repo secrets.
