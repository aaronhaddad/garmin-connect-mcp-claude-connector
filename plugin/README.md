# Personal Data for Garmin Connect

Ask Claude about your own Garmin Connect data: how your last run was paced, what your VO2 max is and how it has moved, how much training load you've done this week, and how you slept and recovered. The plugin uses Garmin's **official, read-only Personal API**, so there's no password and no scraping.

It works in **Claude Code** and in **Cowork sessions on your computer**. For Claude Desktop chats, install the [desktop extension](https://github.com/aaronhaddad/garmin-connect-mcp-claude-connector#install-in-claude-desktop) instead.

## What's included

- **A local MCP server** with 23 read-only tools: activities with exact per-km splits from the original `.FIT` file, VO2 max, training effect and load, sleep, HRV, Body Battery, stress, steps, weight and nutrition.
- **A skill**, `garmin-training-insights`, that tells Claude which tool answers which question, how to report numbers the way Garmin Connect shows them, and which metrics Garmin doesn't expose.

## Set up

1. Create a Personal API key in Garmin Connect: Settings → [Personal API](https://connect.garmin.com/app/settings/personalApiToken) → Create Key.
2. Install the plugin. In Claude Code, run:

   ```
   /plugin install garmin-personal-api-mcp --marketplace aaronhaddad/garmin-connect-mcp-claude-connector
   ```

   Claude Code asks for the key; paste it there. It's stored in your system's secure credential store.
3. Cowork doesn't ask for plugin settings. To use the plugin there, save the key on your computer once by running `npx garmin-personal-api-mcp setup` in a terminal; the plugin falls back to that key whenever its own setting is empty.

When the key expires, create a new one and paste it in Claude Code under `/plugin` → Installed → Personal Data for Garmin Connect → Configure, or run the setup command again.

## Use it

Ask in plain language, for example:

- "How was my pacing on my last run? Did I fade?"
- "What's my VO2 max, and how has it moved this month?"
- "What was my training load this week, activity by activity?"
- "How recovered am I today?"
- "Compare my sleep and HRV this week with last week."

## What it runs and sends

- **What runs:** the plugin starts the [`garmin-personal-api-mcp`](https://www.npmjs.com/package/garmin-personal-api-mcp) package from npm with `npx`, pinned to an exact version. Its source is in [this repository](https://github.com/aaronhaddad/garmin-connect-mcp-claude-connector), and each npm release is built and signed by this repository's GitHub Actions workflow.
- **Where data goes:** the server sends your API key to Garmin (`personal.connectapi.garmin.com`) to get a 24-hour access token, then makes read-only GET requests there when Claude calls a tool. Results go only to your Claude session. Nothing is sent anywhere else; there's no analytics or telemetry.
- **What's stored on your computer:** the access token in `~/.config/garmin-personal-api-mcp/token.json` (permissions 0600). If you use `setup`, the key goes in the macOS Keychain or in `~/.config/garmin/connect-personal-api-key` (0600). Activity files are decoded in memory and not kept, unless you ask Claude to save one to a folder.

Full details: [Privacy Policy](https://github.com/aaronhaddad/garmin-connect-mcp-claude-connector/blob/main/PRIVACY.md).

This is an independent project, not made or endorsed by Garmin. "Garmin" and "Garmin Connect" are trademarks of Garmin Ltd.
