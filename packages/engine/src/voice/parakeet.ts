// NVIDIA Parakeet TDT speech-to-text on onnxruntime-node: a port of onnx-asr's NeMo TDT pipeline
// (nemo128 mel features → FastConformer encoder → greedy TDT decoding), with Silero VAD for long audio.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InferenceSession, Tensor } from "onnxruntime-node";
import { AvanzelError, type Transcriber, type Transcript } from "../types.ts";
import { segmentSpeech } from "./vad.ts";
import { loadAudio, resampleLinear, SAMPLE_RATE } from "./wav.ts";

/** CPU only: on macOS the CoreML provider was measured ~10x slower for Parakeet. */
export const SESSION_OPTIONS: InferenceSession.SessionOptions = {
  executionProviders: ["cpu"],
  intraOpNumThreads: 4,
  logSeverityLevel: 3,
};

/** Audio longer than this is cut into speech segments with Silero VAD first (as Avanzel v0.1 does). */
export const VAD_THRESHOLD_SECONDS = 25;
/** Segments recognised per encoder run, as in onnx-asr. */
const VAD_BATCH_SIZE = 8;
/** Two 10 ms feature frames: with one, the per-feature variance is 0/0 and the model emits <unk> noise. */
const MIN_SAMPLES = 2 * 160;

/** The engine's assets folder: AVANZEL_ASSETS when the app ships a copy elsewhere, else packages/engine/assets/. */
export function assetsDir(): string {
  return process.env.AVANZEL_ASSETS || fileURLToPath(new URL("../../assets/", import.meta.url));
}

export interface Vocab {
  /** Token text by id, with SentencePiece's word marker turned into a space. */
  tokens: string[];
  blank: number;
}

const SENTENCEPIECE_SPACE = String.fromCodePoint(0x2581); // "▁"

/** Parses vocab.txt: one `<token> <id>` per line. */
export function parseVocab(text: string): Vocab {
  const tokens: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const space = line.lastIndexOf(" ");
    tokens[Number(line.slice(space + 1))] = line.slice(0, space).replaceAll(SENTENCEPIECE_SPACE, " ");
  }
  const blank = tokens.indexOf("<blk>");
  if (blank < 0) throw new AvanzelError("vocab.txt has no <blk> token.");
  return { tokens, blank };
}

// onnx-asr detokenises with Python's `re.sub(r"\A\s|\s\B|(\s)\b", …)`; Python's Unicode \w is [\p{L}\p{N}_].
const WORD = String.raw`[\p{L}\p{N}_]`;
const SPACES = new RegExp(String.raw`^\s|\s(?!${WORD})|(\s)(?=${WORD})`, "gu");

/** Joins token texts and drops the spaces that are not followed by a word (", " → ","). */
export function decodeTokens(pieces: readonly string[]): string {
  return pieces.join("").replace(SPACES, (_space, kept?: string) => (kept ? " " : ""));
}

export interface TdtOptions {
  vocabSize: number;
  blank: number;
  maxTokensPerStep: number;
}

export type Joint<S> = (t: number, prevToken: number, state: S) => Promise<{ logits: Float32Array; state: S }>;

/**
 * onnx-asr's greedy TDT decoding over `frames` encoder frames. The joint returns token logits
 * (the first `vocabSize`) followed by duration logits; the decoder state only advances on non-blank tokens.
 */
export async function greedyTdt<S>(frames: number, initialState: S, joint: Joint<S>, options: TdtOptions): Promise<number[]> {
  const { vocabSize, blank, maxTokensPerStep } = options;
  const tokens: number[] = [];
  let state = initialState;
  let t = 0;
  let emitted = 0;
  while (t < frames) {
    const out = await joint(t, tokens.at(-1) ?? blank, state);
    const token = argmax(out.logits, 0, vocabSize);
    const duration = argmax(out.logits, vocabSize, out.logits.length) - vocabSize;
    if (token !== blank) {
      state = out.state;
      tokens.push(token);
      emitted += 1;
    }
    if (duration > 0) {
      t += duration;
      emitted = 0;
    } else if (token === blank || emitted >= maxTokensPerStep) {
      t += 1;
      emitted = 0;
    }
  }
  return tokens;
}

/** Index of the first maximum in values[from..to), like numpy's argmax. */
function argmax(values: Float32Array, from: number, to: number): number {
  let best = from;
  for (let i = from + 1; i < to; i++) if (values[i]! > values[best]!) best = i;
  return best;
}

export interface ParakeetOptions {
  /** Silero VAD model file; needed for audio longer than 25 s. */
  vadPath?: string;
  /** "int8" (default) loads `*.int8.onnx`; "" loads the full-precision files. */
  quantization?: string;
  /** Model id for the engine name; defaults to the directory name. */
  model?: string;
}

type DecoderState = [Tensor, Tensor];

interface Sessions {
  preprocessor: InferenceSession;
  encoder: InferenceSession;
  decoder: InferenceSession;
  vad: InferenceSession | null;
}

export class ParakeetTranscriber implements Transcriber {
  readonly engine: string;
  readonly #sessions: Sessions;
  readonly #vocab: Vocab;
  readonly #maxTokensPerStep: number;
  readonly #initialState: DecoderState;

  private constructor(engine: string, sessions: Sessions, vocab: Vocab, maxTokensPerStep: number) {
    this.engine = engine;
    this.#sessions = sessions;
    this.#vocab = vocab;
    this.#maxTokensPerStep = maxTokensPerStep;
    const zeros = (name: string) => {
      // [layers, batch, hidden] as the decoder declares it ([2, 1, 640] for Parakeet).
      const meta = sessions.decoder.inputMetadata.find((input) => input.name === name);
      const shape = meta?.isTensor ? meta.shape : [];
      const dims = [typeof shape[0] === "number" ? shape[0] : 2, 1, typeof shape[2] === "number" ? shape[2] : 640];
      return new Tensor("float32", new Float32Array(dims[0]! * dims[2]!), dims);
    };
    this.#initialState = [zeros("input_states_1"), zeros("input_states_2")];
  }

  /**
   * Loads the model files in `modelDir` (as laid out on Hugging Face). The nemo128 preprocessor is always
   * the engine's own (assets/nemo128.onnx, see assets/NOTICE.md); a copy in `modelDir` is ignored.
   */
  static async load(modelDir: string, options: ParakeetOptions = {}): Promise<ParakeetTranscriber> {
    const model = options.model ?? basename(modelDir);
    const suffix = options.quantization === "" ? "" : `.${options.quantization ?? "int8"}`;
    const paths = {
      encoder: join(modelDir, `encoder-model${suffix}.onnx`),
      decoder: join(modelDir, `decoder_joint-model${suffix}.onnx`),
      vocab: join(modelDir, "vocab.txt"),
    };
    const missing = [...Object.values(paths), ...(options.vadPath ? [options.vadPath] : [])].filter((path) => !existsSync(path));
    if (missing.length > 0) throw new AvanzelError(`Speech model files are missing: ${missing.join(", ")}`);
    try {
      const vocab = parseVocab(readFileSync(paths.vocab, "utf8"));
      const configPath = join(modelDir, "config.json");
      const config = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, "utf8")) as { max_tokens_per_step?: number }) : {};
      // Read as bytes, so the preprocessor also loads from inside an Electron app.asar.
      const preprocessorModel = readFileSync(join(assetsDir(), "nemo128.onnx"));
      const [preprocessor, encoder, decoder, vad] = await createSessions([
        preprocessorModel,
        paths.encoder,
        paths.decoder,
        options.vadPath ?? null,
      ]);
      const sessions = { preprocessor: preprocessor!, encoder: encoder!, decoder: decoder!, vad: vad ?? null };
      return new ParakeetTranscriber(`onnx-asr:${model}`, sessions, vocab, config.max_tokens_per_step ?? 10);
    } catch (error) {
      throw new AvanzelError(`Could not load speech model ${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A WAV (or, with ffmpeg, any audio) file, or mono samples at `sampleRate`. */
  async transcribe(audio: string | Float32Array, sampleRate = SAMPLE_RATE): Promise<Transcript> {
    const { samples, seconds } =
      typeof audio === "string"
        ? await loadAudio(audio)
        : { samples: resampleLinear(audio, sampleRate, SAMPLE_RATE), seconds: audio.length / sampleRate };
    let text: string;
    if (samples.length < MIN_SAMPLES) {
      text = "";
    } else if (seconds > VAD_THRESHOLD_SECONDS) {
      const { vad } = this.#sessions;
      if (!vad) throw new AvanzelError(`Audio longer than ${VAD_THRESHOLD_SECONDS} s needs the Silero VAD model.`);
      const segments = await segmentSpeech(samples, vad);
      const texts: string[] = [];
      for (let i = 0; i < segments.length; i += VAD_BATCH_SIZE) {
        const batch = segments.slice(i, i + VAD_BATCH_SIZE).map(([start, end]) => samples.subarray(start, end));
        texts.push(...(await this.#recognize(batch)));
      }
      text = texts.map((segment) => segment.trim()).filter(Boolean).join(" ");
    } else {
      text = (await this.#recognize([samples]))[0]!;
    }
    return { text: text.trim(), engine: this.engine, seconds };
  }

  /** Recognises a batch of 16 kHz waveforms, zero-padded to the longest like onnx-asr's `pad_list`. */
  async #recognize(waveforms: Float32Array[]): Promise<string[]> {
    const longest = Math.max(...waveforms.map((waveform) => waveform.length));
    const batch = new Float32Array(waveforms.length * longest);
    waveforms.forEach((waveform, i) => batch.set(waveform, i * longest));
    const { preprocessor, encoder, decoder } = this.#sessions;
    const { features, features_lens } = await preprocessor.run({
      waveforms: new Tensor("float32", batch, [waveforms.length, longest]),
      waveforms_lens: new Tensor("int64", BigInt64Array.from(waveforms, (waveform) => BigInt(waveform.length)), [waveforms.length]),
    });
    const { outputs, encoded_lengths } = await encoder.run({ audio_signal: features!, length: features_lens! });
    const [, dim, frames] = outputs!.dims as [number, number, number];
    const encoded = outputs!.data as Float32Array;
    const lengths = encoded_lengths!.data as BigInt64Array;

    const texts: string[] = [];
    for (let item = 0; item < waveforms.length; item++) {
      const base = item * dim * frames;
      const joint: Joint<DecoderState> = async (t, prevToken, [state1, state2]) => {
        const frame = new Float32Array(dim);
        for (let d = 0; d < dim; d++) frame[d] = encoded[base + d * frames + t]!;
        const out = await decoder.run({
          encoder_outputs: new Tensor("float32", frame, [1, dim, 1]),
          targets: new Tensor("int32", Int32Array.of(prevToken), [1, 1]),
          target_length: new Tensor("int32", Int32Array.of(1), [1]),
          input_states_1: state1,
          input_states_2: state2,
        });
        return { logits: out.outputs!.data as Float32Array, state: [out.output_states_1!, out.output_states_2!] };
      };
      const ids = await greedyTdt(Math.min(Number(lengths[item]), frames), this.#initialState, joint, {
        vocabSize: this.#vocab.tokens.length,
        blank: this.#vocab.blank,
        maxTokensPerStep: this.#maxTokensPerStep,
      });
      texts.push(decodeTokens(ids.map((id) => this.#vocab.tokens[id]!)));
    }
    return texts;
  }
}

/** Creates the sessions (from a path or model bytes) together; if any fails, releases the others (the encoder is ~650 MB). */
async function createSessions(models: (string | Uint8Array | null)[]): Promise<(InferenceSession | null)[]> {
  const settled = await Promise.allSettled(
    models.map((model) => {
      if (model === null) return null;
      return typeof model === "string" ? InferenceSession.create(model, SESSION_OPTIONS) : InferenceSession.create(model, SESSION_OPTIONS);
    }),
  );
  const failure = settled.find((result) => result.status === "rejected");
  if (!failure) return settled.map((result) => (result.status === "fulfilled" ? result.value : null));
  await Promise.all(settled.map((result) => (result.status === "fulfilled" ? result.value?.release() : undefined)));
  throw failure.reason;
}
