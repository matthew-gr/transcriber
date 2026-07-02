# WPI Audio Transcriber

A small audio-to-text tool built on OpenAI Whisper. It has two ways in:

1. **Web portal** - upload a WAV or MP3, get back the transcript. Short transcripts show inline with a copy button. Long ones download as a `.txt` file.
2. **MCP server** - lets Claude (or any MCP client) transcribe an audio file programmatically by pointing at the same Whisper backend.

Both share one transcription core (`src/transcribe.js`), so behavior stays consistent.

## Build brief for the agent

Stand this up in three steps:

1. Install dependencies and set the API key (see Setup).
2. Run the web server and confirm a test upload returns text.
3. Run the MCP server and confirm a client can call the `transcribe_audio` tool.

Target hosting is Railway or Render. Both pieces can run as separate processes from the same repo. The web server is a standard Node web service. The MCP server runs over stdio by default and can be switched to HTTP for remote hosting (see `mcp/README.md`).

Keep the code as-is unless something breaks. The structure is intentionally simple so it can be extended later (batch uploads, speaker labels, storage).

## Project layout

```
wpi-transcriber/
  README.md              this file
  package.json           web portal + shared deps
  .env.example           copy to .env and fill in
  src/
    server.js            Express web portal and upload API
    transcribe.js        shared Whisper transcription core
  public/
    index.html           upload UI
  mcp/
    README.md            MCP-specific run notes
    package.json         MCP server deps
    server.js            MCP server exposing transcribe_audio
```

## Setup

```bash
cd wpi-transcriber
cp .env.example .env
# open .env and paste your OpenAI API key
npm install
```

## Run the web portal

```bash
npm start
# visit http://localhost:3000
```

Upload a WAV or MP3. Files up to 25 MB (Whisper's per-file limit) are accepted. Anything longer than roughly 2,000 characters of output is offered as a download instead of inline text.

## Run the MCP server

```bash
cd mcp
npm install
npm start
```

See `mcp/README.md` for connecting Claude to it.

## Notes

- Whisper accepts mp3, mp4, mpeg, mpga, m4a, wav, and webm.
- The 25 MB ceiling is per file. For longer recordings, the file needs to be chunked before sending. That is left out of this first version on purpose. A follow-up can add ffmpeg-based splitting.
- Cost is roughly $0.006 per minute of audio at current Whisper pricing. Verify before any high-volume use.
