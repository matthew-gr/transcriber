# WPI Transcriber MCP Server

Exposes one tool, `transcribe_audio`, that runs an audio file through OpenAI Whisper and returns plain text. It shares the same Whisper backend as the web portal.

## Install and run

```bash
cd mcp
npm install
npm start
```

The server reads `OPENAI_API_KEY` from the `.env` file in the project root, or from the environment. It runs over stdio by default.

## The tool

`transcribe_audio` takes one of:

- `path` - an absolute path to a local audio file, or
- `url` - an https URL to an audio file (it gets downloaded, transcribed, then deleted).

Returns the transcript as text. Supports mp3, mp4, mpeg, mpga, m4a, wav, and webm up to 25 MB.

## Connecting Claude (desktop / Claude Code)

Add this to your MCP client config. Adjust the path to where the repo lives.

```json
{
  "mcpServers": {
    "wpi-transcriber": {
      "command": "node",
      "args": ["/absolute/path/to/wpi-transcriber/mcp/server.js"],
      "env": {
        "OPENAI_API_KEY": "sk-your-key-here"
      }
    }
  }
}
```

Once connected, Claude can call `transcribe_audio` with a path or url and get the transcript back inline.

## Hosting remotely

The stdio transport is meant for a local client. To host this for a remote client, swap `StdioServerTransport` for the SDK's Streamable HTTP transport and run it behind a URL on Railway or Render. The tool logic in `server.js` stays the same. This is left as a follow-up so the first version stays simple.
