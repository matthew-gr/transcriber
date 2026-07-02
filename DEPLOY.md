# Deploying the web portal

The web portal (`src/server.js`) is a standard Node service. It runs as-is on
Railway or Render — no code changes, no build step. `railway.json` in the repo
root sets the start command and points the health check at `/health`.

The remote MCP server is a **separate** follow-up (see `mcp/README.md`); this
guide covers the web portal only.

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
