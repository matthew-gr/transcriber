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

`transcribe_audio` takes the audio one of three ways:

- `audioBase64` (+ optional `filename`) — base64 file bytes. Use this for a file
  the client has locally (e.g. an upload in Claude.ai) that this remote server
  can't reach by path or url. Best for files under ~30 MB; use `url` for larger.
- `path` — an absolute path to an audio file **on the server**.
- `url` — an https URL to an audio file (downloaded, transcribed, then deleted).
  Redirects are followed, so share links from Google Drive / Dropbox / S3 work
  as long as the file is publicly reachable. This is the best route for larger
  files, since it costs no tokens (unlike `audioBase64`).

Optional `provider` (`whisper` | `assemblyai`) picks the engine; otherwise the
server default is used. `whisper` auto-falls back to AssemblyAI for files it
can't handle (over 25 MB or formats like 3gp). Returns the transcript as text.

## Authentication

The endpoint spends OpenAI credits per call, so it is gated by the same
`ACCESS_TOKEN` shared secret as the web portal. The token is accepted three ways:

1. **`/mcp/<token>` path** (capability URL) — the reliable form for the
   Claude.ai / Claude Desktop connector UI. The path is always forwarded by the
   client, and to Claude the endpoint looks like a plain no-auth URL, so it
   connects without needing OAuth.
2. **`Authorization: Bearer <token>` header** — for Claude Code, programmatic
   clients, and anything that lets you set request headers.
3. **`?token=<token>` query param** — fallback.

When `ACCESS_TOKEN` is unset the endpoint is open (local dev only); the server
logs a warning on boot.

> Why the path form for Claude.ai: its custom-connector UI only supports **no
> auth** or **OAuth** (Client ID / Secret) — there is no header/API-key field. A
> plain `/mcp` with a token gate returns 401 with no OAuth metadata, which makes
> the connector hang on "checking connection". Baking the token into the path
> makes the URL look like a no-auth endpoint, which connects cleanly. The token
> travels in the URL, so treat the whole URL as the secret and rotate it by
> changing `ACCESS_TOKEN`. Full OAuth can be added later for per-user auth.

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
embedded in the **path**. Leave the OAuth Client ID / Secret fields blank.

```
https://<domain>/mcp/<token>
```

Once connected, Claude can call `transcribe_audio` with a `path` or `url`.

## Hosting

See `../DEPLOY.md` for standing this up as a second Railway service from the same
repo (it shares the core in `../src`, so it builds from the repo root, not from
an isolated `mcp/` root directory).
