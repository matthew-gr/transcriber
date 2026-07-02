import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";

const MODEL = process.env.WHISPER_MODEL || "whisper-1";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set. Add it to the .env file.");
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// Download a remote URL to a temp file so Whisper can read a local stream.
function downloadToTemp(url) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(new URL(url).pathname) || ".audio";
    const dest = path.join(os.tmpdir(), `mcp-audio-${Date.now()}${ext}`);
    const fileStream = fs.createWriteStream(dest);
    https
      .get(url, (resp) => {
        if (resp.statusCode && resp.statusCode >= 400) {
          reject(new Error(`Download failed with status ${resp.statusCode}.`));
          return;
        }
        resp.pipe(fileStream);
        fileStream.on("finish", () => fileStream.close(() => resolve(dest)));
      })
      .on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

async function transcribe(filePath) {
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is ${(stats.size / 1024 / 1024).toFixed(1)} MB. Whisper accepts up to 25 MB per file. Split the recording first.`
    );
  }
  const openai = getClient();
  const result = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: MODEL,
    response_format: "text",
  });
  return typeof result === "string" ? result.trim() : String(result).trim();
}

const server = new Server(
  { name: "wpi-transcriber", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "transcribe_audio",
      description:
        "Transcribe an audio file to plain text using OpenAI Whisper. Accepts either a local file path or an https URL. Supports mp3, mp4, mpeg, mpga, m4a, wav, and webm up to 25 MB.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to a local audio file.",
          },
          url: {
            type: "string",
            description: "https URL to an audio file to download and transcribe.",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "transcribe_audio") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { path: localPath, url } = request.params.arguments || {};
  if (!localPath && !url) {
    return {
      isError: true,
      content: [{ type: "text", text: "Provide either a path or a url." }],
    };
  }

  let workingPath = localPath;
  let isTemp = false;

  try {
    if (!workingPath) {
      workingPath = await downloadToTemp(url);
      isTemp = true;
    }
    const text = await transcribe(workingPath);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: err.message || "Transcription failed." }],
    };
  } finally {
    if (isTemp && workingPath) fs.unlink(workingPath, () => {});
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("WPI Transcriber MCP server running on stdio.");
