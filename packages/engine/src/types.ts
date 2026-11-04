// Interfaces shared by the engine's core (library, agents) and voice (speech-to-text) halves.

export interface Transcript {
  text: string;
  /** e.g. "onnx-asr:nemo-parakeet-tdt-0.6b-v3" or "command:whisper-cli" */
  engine: string;
  /** Duration of the audio in seconds, when known. */
  seconds: number | null;
}

/** A stretch of speech with its place in the audio; `start` and `end` are seconds from the start. */
export interface TimedText {
  start: number;
  end: number;
  text: string;
}

export interface Transcriber {
  readonly engine: string;
  /** A WAV file path, or mono samples in [-1, 1] at `sampleRate` (16 kHz when omitted). */
  transcribe(audio: string | Float32Array, sampleRate?: number): Promise<Transcript>;
  /**
   * The speech in mono samples, one text per stretch the voice-activity detector found, in order, empty ones left out.
   * Optional: only a transcriber that knows where each stretch lies can give it (the command backend cannot).
   */
  transcribeSegments?(samples: Float32Array, sampleRate?: number): Promise<TimedText[]>;
  /**
   * Waits for the transcriptions in progress, then frees the model (Parakeet's is ~700 MB). The transcriber from
   * `makeTranscriber` loads it again on its next `transcribe`; a `ParakeetTranscriber` refuses to transcribe any more.
   * Optional, so a transcriber made elsewhere (the app's stand-in) need not have it.
   */
  release?(): Promise<void>;
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
