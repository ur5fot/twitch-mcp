# Twitch MCP

Local read-only MCP server for Twitch stream context. The tool is account
neutral: the channel comes from `TWITCH_CHANNEL_LOGIN` of the owning project,
not from a default baked into the code.

The first version is intentionally conservative:

- reads public/channel-scoped Twitch context through the Helix API;
- checks whether the channel is live;
- reads recent videos and channel schedule;
- validates the configured OAuth token;
- returns sanitized public fields instead of raw Helix objects;
- does not send chat messages, moderate chat, create clips, raids, polls, or predictions.

## Status

```text
MCP package: ready
Node runtime: brew /opt/homebrew/bin/node (stable path, not tied to nvm)
config: --env-file with the owning project env file
TWITCH_CLIENT_ID: pending Twitch Developer App
TWITCH_ACCESS_TOKEN: pending Twitch Developer App
Default channel: none, TWITCH_CHANNEL_LOGIN is required
Current blocker: Twitch requires 2FA before app registration
```

The blocker is outside this package. Twitch Developer Console requires 2FA on
the account that creates the app. For read-only channel status, the app can be
created from any Twitch account with working 2FA; the channel being read is set
by `TWITCH_CHANNEL_LOGIN` in the env file of the owning project. Until the
credentials exist the server is not registered in any MCP client.

## Tools

```text
twitch_validate_token
twitch_get_channel_info
twitch_get_stream_status
twitch_get_recent_videos
twitch_get_channel_schedule
```

## Setup

```bash
cd /Users/dim/code/tools/twitch-mcp
npm install
npm test
```

Export variables in your shell, or point the server at an env file of the
owning project with `--env-file`:

```bash
export TWITCH_CLIENT_ID="..."
export TWITCH_ACCESS_TOKEN="..."
export TWITCH_CHANNEL_LOGIN="..."
```

`TWITCH_BROADCASTER_LOGIN` works as an alias of `TWITCH_CHANNEL_LOGIN`. With
neither set and no explicit `login` argument, a tool fails with a clear error
instead of reading someone else's channel.

The server does not read any `.env` on its own: configuration comes from the
process environment, normally through `node --env-file=<path> src/server.js`.
Secrets live in the owning project, not in this repo.

For the initial read-only tools, an app access token is enough for most Helix
reads. User-scoped chat/moderation features should be added later with explicit
OAuth scopes and separate safety gates.

## MCP Client Config

The instance name belongs to the account, not to the tool: register the same
`src/server.js` once per account, each with its own env file.

Claude Code, `.mcp.json` of the owning project:

```json
{
  "mcpServers": {
    "<account>-twitch": {
      "command": "/opt/homebrew/bin/node",
      "args": [
        "--env-file=<abs path to the project env file>",
        "/Users/dim/code/tools/twitch-mcp/src/server.js"
      ]
    }
  }
}
```

Codex, `~/.codex/config.toml`:

```toml
[mcp_servers.<account>-twitch]
command = "/opt/homebrew/bin/node"
args = [
  "--env-file=<abs path to the project env file>",
  "/Users/dim/code/tools/twitch-mcp/src/server.js",
]
```

```json
{ "enabledMcpjsonServers": ["<account>-twitch"] }
```

No `env` block on purpose — a placeholder key there would override the real one
from the env file. `command` uses the stable Homebrew node path so it survives
node upgrades (unlike a version-pinned nvm path). `.mcp.json` is read at session
start: restart Claude Code, then check `/mcp`.

Two traps: `--env-file` (unlike `--env-file-if-exists`) **fails** when the file
is missing — that is the first thing to check when the server does not come up;
and `/opt/homebrew/bin/node` is not the same runtime as `node` from a nvm PATH,
so `npm install` and the server can end up on different versions.

## Safe Workflow

```text
1. Enable Twitch 2FA or use another Twitch account with working 2FA.
2. Create a Twitch Developer App.
3. Generate an app access token.
4. Fill the project env file with TWITCH_CLIENT_ID, TWITCH_ACCESS_TOKEN, TWITCH_CHANNEL_LOGIN.
5. Register the instance in the MCP client and restart it.
6. twitch_validate_token
7. twitch_get_channel_info
8. twitch_get_stream_status
9. twitch_get_recent_videos or twitch_get_channel_schedule when needed
```

## Current Limits

- No chat buffer yet.
- No EventSub subscriptions yet.
- No write actions.
- No OAuth token generation or refresh flow.
- No secrets in docs; use local env or MCP client config only.

Good next step: add EventSub WebSocket read-only chat/event buffer with explicit
scopes, then add write actions only behind confirm tokens.
