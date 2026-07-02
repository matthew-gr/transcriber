import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  transcribeFile,
  PROVIDERS,
  DEFAULT_PROVIDER,
} from "../src/transcribe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the project-root .env explicitly so the MCP server picks up the same
// keys as the web portal regardless of the current working directory. On hosts
// like Railway the vars come from the environment and this is a harmless no-op.
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const PORT = process.env.PORT || 3001;
const HOST = "0.0.0.0";

// Shared-secret gate for the MCP endpoint. The transcribe tool spends OpenAI
// credits, so a public deploy must not leave it open. When ACCESS_TOKEN is set,
// callers must present it; when unset we allow through for local dev.
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
if (!ACCESS_TOKEN) {
  console.error(
    "WARNING: ACCESS_TOKEN is not set. The MCP endpoint is OPEN. Set it before exposing this server publicly."
  );
}

function tokenMatches(provided) {
  if (!provided) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(ACCESS_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

// Accept the token three ways:
//   1. /mcp/<token>          — token in the URL path (capability URL). The path
//      is always forwarded by clients, so this is the reliable form for the
//      Claude.ai / Claude Desktop connector UI, which exposes no header field.
//   2. Authorization: Bearer — Claude Code and programmatic clients.
//   3. ?token=               — query-string fallback.
function extractToken(req) {
  if (req.params && typeof req.params.token === "string") return req.params.token;
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  if (typeof req.query.token === "string") return req.query.token;
  return "";
}

function requireToken(req, res, next) {
  if (!ACCESS_TOKEN) return next();
  if (tokenMatches(extractToken(req))) return next();
  return res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Invalid or missing access token." },
    id: null,
  });
}

// Download a remote https URL to a temp file so the shared core can read a
// local stream, then the caller deletes it after transcription.
function downloadToTemp(url) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(new URL(url).pathname) || ".audio";
    const dest = path.join(os.tmpdir(), `mcp-audio-${randomUUID()}${ext}`);
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

// Build a fresh MCP server instance. One per session (see session handling
// below). The tool routes through the single shared core in src/transcribe.js,
// the same core the web portal uses, so behavior stays consistent.
function buildServer() {
  const server = new Server(
    { name: "wpi-transcriber", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "transcribe_audio",
        description:
          `Transcribe an audio file to plain text. Provide the audio one of three ways: audioBase64 (base64 file bytes — use this for a file you have locally, e.g. an upload, that this remote server can't reach by path/url), a local file path on the server, or an https url. Two engines: "whisper" prefers OpenAI Whisper (mp3/mp4/mpeg/mpga/m4a/wav/webm up to 25 MB) but automatically falls back to AssemblyAI for files it can't handle (over 25 MB or other formats like 3gp); "assemblyai" always uses AssemblyAI. Defaults to the server's configured provider (${DEFAULT_PROVIDER}).`,
        inputSchema: {
          type: "object",
          properties: {
            audioBase64: {
              type: "string",
              description:
                "Base64-encoded audio file bytes. Use this to transcribe a locally-uploaded file the server cannot reach otherwise. Best for files under ~30 MB; for larger files use url.",
            },
            filename: {
              type: "string",
              description:
                "Original filename (e.g. memo.3gp), used with audioBase64 to detect the format. Recommended.",
            },
            path: {
              type: "string",
              description: "Absolute path to an audio file on the server.",
            },
            url: {
              type: "string",
              description:
                "https URL to an audio file to download and transcribe.",
            },
            provider: {
              type: "string",
              enum: PROVIDERS,
              description: `Transcription engine: ${PROVIDERS.join(
                " or "
              )}. Optional; defaults to ${DEFAULT_PROVIDER}.`,
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

    const { path: localPath, url, provider, audioBase64, filename } =
      request.params.arguments || {};
    if (!localPath && !url && !audioBase64) {
      return {
        isError: true,
        content: [
          { type: "text", text: "Provide audioBase64, a path, or a url." },
        ],
      };
    }

    let workingPath = localPath;
    let isTemp = false;

    try {
      if (!workingPath) {
        if (audioBase64) {
          // Write the uploaded bytes to a temp file, keeping the original
          // extension so format detection and the Whisper->AssemblyAI auto-flip
          // still work.
          const ext = filename ? path.extname(filename) : "";
          workingPath = path.join(
            os.tmpdir(),
            `mcp-audio-${randomUUID()}${ext || ".audio"}`
          );
          await fs.promises.writeFile(
            workingPath,
            Buffer.from(audioBase64, "base64")
          );
        } else {
          workingPath = await downloadToTemp(url);
        }
        isTemp = true;
      }
      const text = await transcribeFile(workingPath, { provider });
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

  return server;
}

// Build the Express app directly (rather than the SDK helper) so we can raise
// the JSON body limit: the transcribe tool can receive base64 audio inline, for
// files an MCP client (e.g. Claude.ai) has locally but the server can't reach by
// path or url. Token auth protects the endpoint in place of the helper's
// localhost DNS-rebinding guard.
const app = express();
app.use(express.json({ limit: "50mb" }));

// Open health check for platform probes (Railway hits this).
app.get("/health", (_req, res) => res.json({ ok: true }));

// Stateful Streamable HTTP session management, per the MCP SDK reference:
// the initialize request creates a session and returns an Mcp-Session-Id header
// that the client echoes on subsequent requests.
const transports = {};

const postHandler = async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    let transport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) delete transports[sid];
      };
      const server = buildServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided." },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error." },
        id: null,
      });
    }
  }
};

// GET (server->client SSE stream) and DELETE (session termination) both need an
// existing session; delegate to its transport.
const sessionRequestHandler = async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
};

app.post("/mcp", requireToken, postHandler);
app.get("/mcp", requireToken, sessionRequestHandler);
app.delete("/mcp", requireToken, sessionRequestHandler);

// Capability-URL variant: same handlers, token taken from the path.
app.post("/mcp/:token", requireToken, postHandler);
app.get("/mcp/:token", requireToken, sessionRequestHandler);
app.delete("/mcp/:token", requireToken, sessionRequestHandler);

app.listen(PORT, HOST, () => {
  console.error(
    `WPI Transcriber MCP server (Streamable HTTP) listening on ${HOST}:${PORT}/mcp`
  );
});
