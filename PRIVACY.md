# Privacy Policy

_Last updated: 2026-10-25_

This policy covers **garmin-personal-api-mcp**, also distributed as the Claude Desktop extension **Personal Data for Garmin Connect** ("the software"). It is an independent open-source project, not made or endorsed by Garmin.

## Summary

The software runs entirely on your computer. The author operates no servers and collects nothing: no analytics, no telemetry, no crash reports, no accounts.

## How your data flows

```
Garmin Connect  ──HTTPS (read-only GET)──▶  the software, on your computer  ──▶  your MCP client (e.g. Claude Desktop)
```

1. **Your Personal API key** is stored on your computer: in Claude Desktop's extension settings when installed as an extension, or in the macOS Keychain or `~/.config/garmin/connect-personal-api-key` (permissions 0600) when set up from the command line. It is only ever sent to Garmin, to exchange it for a 24-hour access token.
2. **Garmin data** (activities, sleep, HRV, Body Battery, weight and so on) is requested from Garmin's Personal API (`personal.connectapi.garmin.com`) only when your MCP client calls one of the tools, and is returned straight to that client. It never passes through any server operated by the author.
3. **Data your MCP client receives** is handled by that client and its provider under their own terms. For example, Claude Desktop sends tool results to Anthropic as part of your conversation, governed by Anthropic's privacy policy.

## What is stored on your computer

| What | Where | Why |
|---|---|---|
| Access token (24 h) | `~/.config/garmin-personal-api-mcp/token.json`, 0600 | Avoids a token exchange on every request |
| Setup preferences (key storage choice, optional key expiry date) | `~/.config/garmin-personal-api-mcp/settings.json` | Command-line setup only |
| A server entry in your MCP clients' config files | e.g. `claude_desktop_config.json` | Command-line setup only, for the apps you pick |
| Activity files | A folder you choose | Only when you ask to download an activity's original file |

Activity `.FIT` files used for split analysis are decoded in memory and not kept.

## Third parties

- **Garmin** receives your API requests, as with any use of its Personal API. See Garmin's privacy policy. Your use of the API, including your key, is governed by Garmin's Personal API Supplemental Terms and Terms of Use: the key is for your own use only and must not be shared.
- **Your MCP client's provider** receives the data you ask it to retrieve, as described above.

No other party receives anything from the software.

## Removing your data

- Command line: `npx garmin-personal-api-mcp logout` removes the saved key and the token cache.
- Extension: uninstall it in Claude Desktop, then delete `~/.config/garmin-personal-api-mcp/`.
- To revoke access entirely, delete the key in Garmin Connect under Settings → Personal API.

## Changes and contact

Changes to this policy are published in this file, with its history in the repository. Questions: open an issue at https://github.com/aaronhaddad/garmin-connect-mcp-claude-connector/issues.
