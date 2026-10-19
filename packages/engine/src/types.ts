// Interfaces shared by the engine's core (library, agents) and voice (speech-to-text) halves.

export interface Transcript {
  text: string;
  /** e.g. "onnx-asr:nemo-parakeet-tdt-0.6b-v3" or "command:whisper-cli" */
  engine: string;
  /** Duration of the audio in seconds, when known. */
  seconds: number | null;
}

export interface Transcriber {
  readonly engine: string;
  /** A WAV file path, or mono samples in [-1, 1] at `sampleRate` (16 kHz when omitted). */
  transcribe(audio: string | Float32Array, sampleRate?: number): Promise<Transcript>;
}

/** The `[voice]` table of `.avanzel/config.toml`, as the voice half needs it. */
export interface VoiceOptions {
  backend: string;
  model: string;
  quantization: string;
  command: string[];
}

/** A problem the owner can fix (missing agent, bad config, …); apps show the message as-is. */
export class AvanzelError extends Error {
  override name = "AvanzelError";
}
