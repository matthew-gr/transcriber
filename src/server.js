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
  isSupported,
  MAX_FILE_BYTES,
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
  limits: { fileSize: MAX_FILE_BYTES },
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.post("/api/transcribe", requireToken, upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const tempPath = req.file.path;

  try {
    if (!isSupported(req.file.originalname)) {
      return res.status(400).json({
        error:
          "Unsupported file type. Use mp3, mp4, mpeg, mpga, m4a, wav, or webm.",
      });
    }

    const text = await transcribeFile(tempPath);
    res.json({ text, filename: req.file.originalname });
  } catch (err) {
    console.error("Transcription failed:", err.message);
    res.status(500).json({ error: err.message || "Transcription failed." });
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
