# WPI Audio Transcriber — agent notes

## AssemblyAI

Always fetch https://www.assemblyai.com/docs/llms.txt before writing AssemblyAI
code. The API has changed. Do not rely on memorized parameter names.
Narrow to Node with https://www.assemblyai.com/docs/llms-full.txt?lang=typescript

## Architecture

- One shared transcription core: `src/transcribe.js`. Both the web portal
  (`src/server.js`) and the MCP server (`mcp/server.js`) route through it. Do not
  duplicate provider logic in two places.
- Two providers behind `transcribeFile(filePath, { provider })`: `whisper`
  (OpenAI, 25 MB cap) and `assemblyai` (larger files). Default comes from
  `TRANSCRIPTION_PROVIDER`, falling back to `whisper`.
- Never hardcode API keys. Never commit `.env` (it is gitignored).
- Node 18+. No new dependencies beyond what package.json files list unless
  something is broken and it is explained first.
