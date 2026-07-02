import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { AssemblyAI } from "assemblyai";

const MB = 1024 * 1024;

export const PROVIDERS = ["whisper", "assemblyai"];

// Resolved default provider: TRANSCRIPTION_PROVIDER if valid, else whisper.
export const DEFAULT_PROVIDER = PROVIDERS.includes(process.env.TRANSCRIPTION_PROVIDER)
  ? process.env.TRANSCRIPTION_PROVIDER
  : "whisper";

// Size caps differ by provider. Whisper is hard-limited to 25 MB per file by the
// OpenAI API; AssemblyAI accepts uploads up to 2.2 GB. Validate against the
// active provider rather than a single shared constant.
export const PROVIDER_MAX_BYTES = {
  whisper: 25 * MB,
  assemblyai: 2200 * MB,
};

// Largest cap across providers. The web portal sizes its upload limit to this,
// then transcribeFile enforces the active provider's specific cap.
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(PROVIDER_MAX_BYTES));

// Whisper's API gatekeeps by file extension, so we validate those up front.
// AssemblyAI transcodes a much wider range (including phone formats like 3gp),
// so it is not extension-gated here — its API validates the container itself.
export const WHISPER_EXTENSIONS = [
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "wav",
  "webm",
];

const WHISPER_MODEL = process.env.WHISPER_MODEL || "whisper-1";

function resolveProvider(provider) {
  if (!provider) return DEFAULT_PROVIDER;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(
      `Unknown provider "${provider}". Use one of: ${PROVIDERS.join(", ")}.`
    );
  }
  return provider;
}

// ---- OpenAI Whisper ----
let openaiClient = null;
function getOpenAI() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set. Add it to your .env file.");
    }
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

async function transcribeWithWhisper(filePath) {
  const openai = getOpenAI();
  const result = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: WHISPER_MODEL,
    response_format: "text",
  });
  // With response_format "text" the SDK returns a plain string.
  return typeof result === "string" ? result.trim() : String(result).trim();
}

// ---- AssemblyAI ----
let assemblyClient = null;
function getAssemblyAI() {
  if (!assemblyClient) {
    if (!process.env.ASSEMBLYAI_API_KEY) {
      throw new Error(
        "ASSEMBLYAI_API_KEY is not set. Add it to your .env file. Create a key at https://www.assemblyai.com/dashboard/api-keys"
      );
    }
    assemblyClient = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
  }
  return assemblyClient;
}

async function transcribeWithAssemblyAI(filePath) {
  const client = getAssemblyAI();
  // The SDK uploads the local file, submits, and polls to completion. Pass the
  // recommended ordered model fallback explicitly (raw string values, no enum).
  const transcript = await client.transcripts.transcribe({
    audio: filePath,
    speech_models: ["universal-3-pro", "universal-2"],
  });
  if (transcript.status === "error") throw new Error(transcript.error);
  return (transcript.text || "").trim();
}

const IMPLEMENTATIONS = {
  whisper: transcribeWithWhisper,
  assemblyai: transcribeWithAssemblyAI,
};

// Whisper only accepts files within its size cap AND with a supported
// extension. Everything else has to go to AssemblyAI.
function whisperCanHandle(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!WHISPER_EXTENSIONS.includes(ext)) return false;
  return fs.statSync(filePath).size <= PROVIDER_MAX_BYTES.whisper;
}

/**
 * The provider that will actually run for this file. Choosing "whisper" means
 * "prefer Whisper, but fall back to AssemblyAI for files Whisper can't take"
 * (over 25 MB or an unsupported format such as 3gp). Choosing "assemblyai"
 * always uses AssemblyAI. This keeps the fast/cheap path for typical files
 * without losing AssemblyAI's reach on the rest.
 *
 * @param {string} filePath
 * @param {string} [provider]
 * @returns {string}
 */
export function resolveEffectiveProvider(filePath, provider) {
  const requested = resolveProvider(provider);
  if (requested === "whisper" && !whisperCanHandle(filePath)) {
    return "assemblyai";
  }
  return requested;
}

/**
 * Transcribe an audio file from a path on disk. Returns the plain text
 * transcript as a string.
 *
 * @param {string} filePath  Absolute or relative path to the audio file.
 * @param {{ provider?: string }} [opts]  provider picks the backend; falls back
 *   to TRANSCRIPTION_PROVIDER, then "whisper". "whisper" auto-flips to
 *   AssemblyAI for files it cannot handle (see resolveEffectiveProvider).
 * @returns {Promise<string>}
 */
export async function transcribeFile(filePath, { provider } = {}) {
  const active = resolveEffectiveProvider(filePath, provider);
  const cap = PROVIDER_MAX_BYTES[active];
  const size = fs.statSync(filePath).size;
  if (size > cap) {
    throw new Error(
      `File is ${(size / MB).toFixed(1)} MB. ${active} accepts up to ${(
        cap / MB
      ).toFixed(0)} MB per file. Split the recording first.`
    );
  }
  return IMPLEMENTATIONS[active](filePath);
}

/**
 * Whether a filename is accepted for the given provider. Whisper gatekeeps by
 * extension; AssemblyAI accepts a wide range, so it is not extension-gated.
 *
 * @param {string} filename
 * @param {string} [provider]
 * @returns {boolean}
 */
export function isSupported(filename, provider) {
  const active = resolveProvider(provider);
  if (active !== "whisper") return true;
  const ext = filename.split(".").pop()?.toLowerCase();
  return WHISPER_EXTENSIONS.includes(ext);
}
