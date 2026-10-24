# garmin-personal-api-mcp

Talk to your own Garmin data from Claude (or any MCP client), using Garmin's **official Personal API**. No password, no scraping, no reverse-engineered login.

> "How was my pacing on yesterday's run?"
> "Compare my HRV and sleep this week with last week."
> "Has my weight moved since I started the bulk in September?"

It ships with an interactive setup wizard that walks you through creating the API key, checks it with Garmin, stores it in your macOS Keychain and wires it into Claude Desktop, Claude Code or Cursor.

```
┌   Garmin Connect MCP · setup
◇  Step 1 · Create a Personal API key
│  1. Sign in to Garmin Connect in the browser
│  2. Settings → Personal API → Create Key
│  ...
◇  Paste the key (input is hidden)
│  ••••••••••••••••••••••••
◇  Garmin accepted the key
◇  Step 2 · Verified
│  Latest:    Evening Run, 8.1 km on 2026-10-21
│  Mode:      read-only. Nothing can be written to your account.
◆  Connect it to which apps?
│  ◼ Claude Desktop
│  ◼ Claude Code
└  All set. Restart Claude, then try: "How was my pacing on my last run?"
```

## Quick start

Requires Node.js 20.3 or later and a Garmin Connect account.

```bash
git clone https://github.com/OWNER/garmin-personal-api-mcp.git
cd garmin-personal-api-mcp
npm install
npm run setup
```

Once the package is on npm, this becomes a one-liner:

```bash
npx garmin-personal-api-mcp setup
```

Restart Claude Desktop afterwards. That's it.

## What you can ask

| Tool | What it gives Claude |
|---|---|
| `garmin_list_activities` | Your activities with distance, time, pace and heart rate. Filter by date and type |
| `garmin_get_activity_splits` | Downloads the original `.FIT` file and computes **exact** km (or mile, or 400 m) splits, interpolated at each boundary with pauses removed, plus per-split HR, cadence and climb, device laps, and a pacing verdict (even, negative split, faded) |
| `garmin_get_activity` | Garmin's own summary for one activity |
| `garmin_get_day` | One call for a day: summary, sleep, HRV, Body Battery and activities |
| `garmin_get_daily_summaries` | Steps, calories, resting HR, stress and intensity minutes across a date range |
| `garmin_get_sleep`, `garmin_get_sleep_detail` | Nightly sleep summaries, or one night in full |
| `garmin_get_hrv` | Overnight HRV, baseline and status |
| `garmin_get_body_battery`, `garmin_get_stress`, `garmin_get_steps`, `garmin_get_hydration` | Daily wellness series |
| `garmin_get_weight`, `garmin_get_weight_goals` | Weigh-ins and body composition |
| `garmin_get_heart_rate`, `garmin_get_spo2`, `garmin_get_fitness_age`, `garmin_get_nutrition` | Single-day detail |
| `garmin_get_profile` | Units, profile and heart-rate zones |
| `garmin_download_activity_fit` | Save the original file locally, for Runalyze, Golden Cheetah and so on |
| `garmin_api_get` | Escape hatch for any other documented Personal API endpoint |

Dates accept `YYYY-MM-DD`, `today`, `yesterday` or `N days ago`. Long ranges are split into the chunk sizes Garmin accepts and merged for you.

## What the Personal API can't do

These limits are Garmin's, not this server's:

- **Read-only.** You can't push workouts, courses or training plans to your watch. Garmin keeps the Training and Courses APIs in its business tiers.
- **No derived metrics** such as VO2 max, training readiness, training status or recovery time. Garmin strips some of these from files delivered through its API.
- **Your account only.** The key only reads the account that created it.

## Security

- The key is stored in the **macOS Keychain** by default. On other systems it goes in `~/.config/garmin/connect-personal-api-key` with `chmod 600`, the same place Garmin's official Python client looks, so both tools share it.
- The wizard reads the key through hidden input or straight from your clipboard (and offers to clear the clipboard afterwards). It never passes the key on a command line.
- The key is exchanged for a 24-hour bearer token, cached in `~/.config/garmin-connect-mcp/token.json` (0600) and refreshed an hour before it expires.
- Every call is a GET to `personal.connectapi.garmin.com`. The raw tool only accepts paths under the documented services.
- To revoke access: `npx garmin-personal-api-mcp logout`, then delete the key in Garmin Connect under Settings → Personal API.

Key lookup order: `$GARMIN_PERSONAL_API_KEY`, then the Keychain, then the key file.

## Commands

```
garmin-personal-api-mcp setup     Interactive setup: key + connect apps
garmin-personal-api-mcp status    Check the saved key still works, and when it expires
garmin-personal-api-mcp logout    Remove the saved key and cached token
garmin-personal-api-mcp           Run the MCP server on stdio (what your MCP client launches)
```

For scripts and dotfiles: `pbpaste | garmin-personal-api-mcp setup --key-stdin --storage keychain`.

### Manual client config

If you'd rather not let the wizard edit your config, add this yourself:

```json
{
  "mcpServers": {
    "garmin-connect": {
      "command": "node",
      "args": ["/absolute/path/to/garmin-personal-api-mcp/dist/index.js"]
    }
  }
}
```

Claude Code: `claude mcp add --scope user garmin-connect -- node /absolute/path/to/dist/index.js`

## Development

```bash
npm install
npm run check      # type-check, unit tests, and an end-to-end MCP smoke test against a fake Garmin API
npx @modelcontextprotocol/inspector node dist/index.js
```

Built on the MCP TypeScript SDK v2, Garmin's [FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk) and [@clack/prompts](https://github.com/bombshell-dev/clack). Endpoint paths follow Garmin's Apache-2.0 [connect-personal-api-python](https://github.com/garmin/connect-personal-api-python) client.

## Disclaimer

This is an independent project, not made or endorsed by Garmin. It only uses Garmin's documented Personal API, and your use of that API is subject to Garmin's terms. "Garmin" and "Garmin Connect" are trademarks of Garmin Ltd.

## License

MIT
