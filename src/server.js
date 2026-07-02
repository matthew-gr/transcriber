import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  transcribeFile,
  resolveEffectiveProvider,
  MAX_UPLOAD_BYTES,
  PROVIDERS,
  DEFAULT_PROVIDER,
} from "./transcribe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Shared-secret gate for the transcription API. Whisper calls cost money, so a
// public deploy must not leave /api/transcribe open. When ACCESS_TOKEN is set,
// callers must present it (Authorization: Bearer <token> or x-access-token).
// When it is unset we allow through, so local dev stays friction-free.
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
if (!ACCESS_TOKEN) {
  console.warn(
    "WARNING: ACCESS_TOKEN is not set. /api/transcribe is OPEN. Set it before exposing this server publicly."
  );
}

// Constant-time compare via fixed-length SHA-256 digests (timingSafeEqual needs
// equal-length buffers), so a wrong token leaks neither validity nor length.
function tokenMatches(provided) {
  if (!provided) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(ACCESS_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireToken(req, res, next) {
  if (!ACCESS_TOKEN) return next();
  const header = req.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const provided = bearer || req.get("x-access-token") || "";
  if (tokenMatches(provided)) return next();
  return res.status(401).json({ error: "Invalid or missing access token." });
}

// Store uploads in a temp dir. We delete each file right after transcribing.
// Preserve the original extension: OpenAI infers the audio format from the
// filename, so an extensionless temp file makes Whisper reject the upload.
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `wpi-upload-${crypto.randomUUID()}${ext}`);
    },
  }),
  // Sized to the largest provider cap; transcribeFile enforces the specific
  // active provider's cap (e.g. Whisper's 25 MB) per request.
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

app.use(express.static(path.join(__dirname, "..", "public")));

// Lets the upload page render the provider options and default the selector.
app.get("/api/config", (_req, res) => {
  res.json({ providers: PROVIDERS, defaultProvider: DEFAULT_PROVIDER });
});

app.post("/api/transcribe", requireToken, upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const tempPath = req.file.path;
  const requested = req.body.provider || DEFAULT_PROVIDER;

  try {
    // "whisper" auto-flips to AssemblyAI for files it can't handle; report both
    // what was requested and what actually ran.
    const provider = resolveEffectiveProvider(tempPath, requested);
    const text = await transcribeFile(tempPath, { provider });
    res.json({ text, filename: req.file.originalname, provider, requested });
  } catch (err) {
    const msg = err.message || "Transcription failed.";
    // Missing-key and bad-provider are configuration errors: report them plainly
    // as 400 rather than a 500 stack-trace.
    const configError = /is not set|Unknown provider/.test(msg);
    if (!configError) console.error("Transcription failed:", msg);
    res.status(configError ? 400 : 500).json({ error: msg });
  } finally {
    fs.unlink(tempPath, () => {});
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Bind 0.0.0.0 (all interfaces) so hosted platforms like Railway can route to
// the container. Binding the default interface makes the edge proxy report
// "Application failed to respond" even though the process is up.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`WPI Transcriber portal running on 0.0.0.0:${PORT}`);
});
