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

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`WPI Transcriber portal running on http://localhost:${PORT}`);
});
