# WPI Audio Transcriber

Audio-to-text tool built on **OpenAI Whisper** and **AssemblyAI**. Two entry
points share one transcription core.

## What it is

- **Web portal** (`src/server.js` + `public/index.html`) — browser upload → text.
- **MCP server** (`mcp/server.js`) — exposes a `transcribe_audio` tool over MCP
  Streamable HTTP so Claude (Desktop / Claude.ai / Claude Code) can transcribe.
- Both route through the single shared core `src/transcribe.js`. Keep it that way
  — no duplicated provider logic in two places.

## Layout

```
src/transcribe.js   shared core: providers, size caps, auto-flip
src/server.js       Express web portal + upload API (uses root package.json)
public/index.html   upload UI (access-token field + engine selector)
mcp/server.js       MCP server, Streamable HTTP (mcp/package.json for local dev)
railway.json        Railway config for the WEB PORTAL service
railway.mcp.json    Railway config for the MCP service
DEPLOY.md           Railway deploy guide (two services)
mcp/README.md       MCP run + client-connect notes
.env.example        copy to .env (gitignored) and fill in
```

## Providers & auto-flip

- `transcribeFile(filePath, { provider })` → `whisper` | `assemblyai`. Provider
  resolves: argument → `TRANSCRIPTION_PROVIDER` env → `whisper`.
- Size caps are provider-specific (`PROVIDER_MAX_BYTES`): Whisper 25 MB,
  AssemblyAI 2.2 GB — validated against the active provider.
- **Auto-flip** (`resolveEffectiveProvider`): choosing `whisper` falls back to
  AssemblyAI for files Whisper can't take (>25 MB, or non-Whisper formats like
  `3gp`). Choosing `assemblyai` always uses AssemblyAI. Whisper is never used for
  a file it cannot handle.
- AssemblyAI call uses `speech_models: ["universal-3-pro","universal-2"]`; the
  SDK handles upload + polling. Whisper's 25 MB ceiling is intentional — do not
  raise it; chunking long files is a future task.

## Auth

- A shared secret `ACCESS_TOKEN` gates `POST /api/transcribe` (portal) and `/mcp`
  (MCP). `/health` is open for platform checks.
- Accepted via `/mcp/<token>` path (capability URL — the reliable form for the
  Claude.ai connector UI, which exposes only no-auth or OAuth), `Authorization:
  Bearer <token>` header, or `?token=<token>` query. Unset token = open endpoint
  (local dev only).

## Deployment — Railway, two services, one repo

- **Web portal service**: root directory = repo root, config `railway.json`,
  start `npm start`.
- **MCP service**: root directory = repo root (**not** `mcp`), config
  `railway.mcp.json`, start `node mcp/server.js`. It imports `../src`, so it must
  build from the repo root; all its runtime deps (MCP SDK, `openai`, `assemblyai`)
  are declared in the **root** `package.json` so one root `npm ci` covers it.
- Do **not** let Railway auto-edit `railway.json` for the MCP service — that file
  belongs to the web portal.
- Per-service variables: `OPENAI_API_KEY`, `ACCESS_TOKEN`, `ASSEMBLYAI_API_KEY`,
  optional `TRANSCRIPTION_PROVIDER` and `WHISPER_MODEL`. Never set `PORT` (Railway
  injects it). Both servers bind `0.0.0.0`.

## Connecting Claude to the MCP server

- **Claude Code**: `claude mcp add --transport http wpi-transcriber https://<host>/mcp --header "Authorization: Bearer <token>"`
- **Claude.ai / Desktop connector**: URL `https://<host>/mcp/<token>` (token in
  the path), leave OAuth Client ID/Secret blank.

## Conventions & constraints

- Never hardcode API keys; never commit `.env` (gitignored). Node 18+.
- Don't rename or restructure files. No new dependencies beyond what the
  `package.json` files list unless something is broken and it's explained first.
  Current deps: `express`, `multer`, `openai`, `assemblyai`, `dotenv`,
  `@modelcontextprotocol/sdk`.

## AssemblyAI docs rule

Always fetch https://www.assemblyai.com/docs/llms.txt before writing AssemblyAI
code — the API changes, so do not rely on memorized parameter names. Narrow to
Node with https://www.assemblyai.com/docs/llms-full.txt?lang=typescript

## Status (2026-07-02)

Web portal, remote MCP server, AssemblyAI backend, and Whisper→AssemblyAI
auto-flip are all built, verified end-to-end, and on `main`. Web portal is
deployed on Railway. MCP service deploy is being brought up (needs root-directory
cleared + config file set to `railway.mcp.json` on that service).
