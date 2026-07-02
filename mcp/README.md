# WPI Transcriber MCP Server

Exposes one tool, `transcribe_audio`, that runs an audio file through the shared
Whisper core (`../src/transcribe.js` — the same core the web portal uses) and
returns plain text.

It runs over the MCP **Streamable HTTP** transport so a remote client (Claude
Desktop, Claude.ai, Claude Code) can reach it over a URL. The MCP endpoint is
`/mcp`; there is also an open `/health` for platform checks.

## Install and run (local)

```bash
cd mcp
npm install
# The root .env sets PORT=3000 for the web portal, so give the MCP server its
# own port locally:
PORT=3001 npm start
```

It reads `OPENAI_API_KEY` and `ACCESS_TOKEN` from the project-root `.env` (loaded
explicitly, regardless of the working directory) or from the environment. On a
host like Railway these come from the service's variables instead.

Boot line: `WPI Transcriber MCP server (Streamable HTTP) listening on 0.0.0.0:3001/mcp`.

## The tool

`transcribe_audio` takes one of:

- `path` — an absolute path to a local audio file, or
- `url` — an https URL to an audio file (downloaded, transcribed, then deleted).

Returns the transcript as text. Supports mp3, mp4, mpeg, mpga, m4a, wav, and
webm up to 25 MB (Whisper's per-file limit).

## Authentication

The endpoint spends OpenAI credits per call, so it is gated by the same
`ACCESS_TOKEN` shared secret as the web portal. The token is accepted two ways:

1. **`Authorization: Bearer <token>` header** — for Claude Code, programmatic
   clients, and anything that lets you set request headers.
2. **`?token=<token>` query param** (capability-URL style) — for the Claude.ai /
   Claude Desktop connector UI, which does not expose a custom-header field.

When `ACCESS_TOKEN` is unset the endpoint is open (local dev only); the server
logs a warning on boot.

> Note on auth mechanism: Claude.ai's custom-connector UI officially documents
> **OAuth** (Client ID / Secret), not static tokens. The `?token=` capability URL
> is a pragmatic shared-secret alternative for a single trusted client. It works,
> but the token travels in the URL (can appear in logs/history), so treat the URL
> as the secret and rotate it by changing `ACCESS_TOKEN`. Full OAuth can be added
> later if you want per-user auth.

## Connecting a client

Replace `<domain>` with your deployed URL (e.g. the Railway domain) and `<token>`
with your `ACCESS_TOKEN`.

**Claude Code (header auth — cleanest):**

```bash
claude mcp add --transport http wpi-transcriber https://<domain>/mcp \
  --header "Authorization: Bearer <token>"
```

**Claude.ai / Claude Desktop (custom connector, capability URL):**

Customize → Connectors → Add custom connector, and enter the URL with the token
embedded:

```
https://<domain>/mcp?token=<token>
```

Once connected, Claude can call `transcribe_audio` with a `path` or `url`.

## Hosting

See `../DEPLOY.md` for standing this up as a second Railway service from the same
repo (it shares the core in `../src`, so it builds from the repo root, not from
an isolated `mcp/` root directory).
