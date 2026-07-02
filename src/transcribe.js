import fs from "fs";
import OpenAI from "openai";

const MODEL = process.env.WHISPER_MODEL || "whisper-1";

// Whisper hard limit is 25 MB per file.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const SUPPORTED_EXTENSIONS = [
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "wav",
  "webm",
];

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set. Add it to your .env file.");
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Transcribe an audio file from a path on disk.
 * Returns the plain text transcript as a string.
 *
 * @param {string} filePath  Absolute or relative path to the audio file.
 * @returns {Promise<string>}
 */
export async function transcribeFile(filePath) {
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

  // With response_format "text" the SDK returns a plain string.
  return typeof result === "string" ? result.trim() : String(result).trim();
}

/**
 * Quick check that a filename has a Whisper-supported extension.
 * @param {string} filename
 * @returns {boolean}
 */
export function isSupported(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}
