# Deploying

Two services run from this one repo: the **web portal** (`src/server.js`) and
the **remote MCP server** (`mcp/server.js`). Both are standard Node services —
no build step. `railway.json` in the repo root configures the web portal
(start command + `/health` check).

The web portal section below is the primary path. The MCP server is a second
service; its recipe is at the end.

## Before you deploy

1. **Generate an access token.** The `/api/transcribe` endpoint spends OpenAI
   credits per call, so a public deploy must be gated. Generate a strong secret:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

   Keep it out of git. You will paste it into the host's dashboard, not `.env`.

## Railway

1. Push this repo to GitHub (already done for this project).
2. In Railway: **New Project → Deploy from GitHub repo**, pick `transcriber`.
   Railway detects Node via Nixpacks and uses `npm start`.
3. Add service **Variables**:
   - `OPENAI_API_KEY` — your OpenAI key.
   - `ACCESS_TOKEN` — the secret you generated above.
   - `WHISPER_MODEL` — optional, defaults to `whisper-1`.
   - Do **not** set `PORT`. Railway injects it; the server reads `process.env.PORT`.
4. Under **Settings → Networking**, click **Generate Domain** to get a public URL.
5. Verify:
   - `https://<your-domain>/health` returns `{"ok":true}`.
   - Open `https://<your-domain>/`, paste the access token, upload a short clip.

## Render (alternative)

1. **New → Web Service**, connect the repo.
2. Build command `npm install`, start command `npm start`.
3. Add the same environment variables as above (again, no `PORT`).
4. Render provides the URL and can health-check `/health`.

## Giving the client access

Send the client the domain and the access token over a secure channel (not
email in plain text if you can avoid it). They paste the token once on the page;
the browser remembers it. To revoke access, change `ACCESS_TOKEN` in the host
dashboard and redeploy — the old token stops working immediately.

## API use (optional)

Callers can also hit the endpoint directly with the token in a header:

```bash
curl -X POST https://<your-domain>/api/transcribe \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "audio=@clip.wav"
```

`x-access-token: <token>` works too. `/health` is intentionally left open for
platform health checks.

---

# Deploying the MCP server (second Railway service)

The MCP server (`mcp/server.js`) runs the same shared core as the portal, so it
imports `../src/transcribe.js`. That means it must build from the **repo root**,
not from an isolated `mcp/` root directory — otherwise `../src` and the root
`node_modules` (which hold the transcription core and its `openai` dependency)
would not be present.

In the **same Railway project** as the portal:

1. **New → GitHub Repo**, pick `transcriber` again (same repo, a second service).
2. Leave **Root Directory** at the repo root (do **not** set it to `mcp`).
3. Set a **custom Install Command** so both dependency sets are installed:
   ```
   npm install && npm install --prefix mcp
   ```
4. Set a **custom Start Command**:
   ```
   node mcp/server.js
   ```
5. **Variables**: `OPENAI_API_KEY` and `ACCESS_TOKEN` (same values as the portal,
   or a separate token if you want to revoke them independently). No manual `PORT`.
6. **Settings → Networking → Generate Domain** to get the public HTTPS URL. The
   MCP endpoint is `https://<mcp-domain>/mcp`.
7. Verify `https://<mcp-domain>/health` returns `{"ok":true}`, then connect a
   client per `mcp/README.md`.

Result: two services, one repo — the portal on its domain, the MCP server on its
own, each with its own injected `PORT`.
