// Local speech-to-text: Parakeet through onnxruntime-node, or any speech-to-text CLI.
import { join } from "node:path";
import { compileDictionary, parseDictionary } from "../core/dictionary.ts";
import { AvanzelError, type TimedText, type Transcriber, type Transcript, type VoiceOptions } from "../types.ts";
import { CommandTranscriber } from "./command.ts";
import { locateModel, MissingModelError, MODELS, modelFiles, VAD_MODEL } from "./models.ts";
import { ParakeetTranscriber } from "./parakeet.ts";

export { CommandTranscriber } from "./command.ts";
export {
  DownloadError,
  type DownloadOptions,
  type DownloadProgress,
  downloadModel,
  downloadModelFiles,
  downloadModels,
  downloadModelsFiles,
  downloadSize,
  locateModel,
  MissingModelError,
  MODELS,
  type ModelSpec,
  missingModels,
  modelBytes,
  modelFiles,
  VAD_MODEL,
} from "./models.ts";
export { type ParakeetOptions, ParakeetTranscriber } from "./parakeet.ts";
export { resampleTo16k } from "./resample.ts";
export { packSegments, segmentSpeech } from "./vad.ts";
export { readWav, type WavAudio, writeWav } from "./wav.ts";

/** Speech models the onnx-asr backend runs, the default first: every known model but Silero VAD. */
export const SPEECH_MODELS: readonly string[] = Object.keys(MODELS).filter((id) => id !== VAD_MODEL);
const PARAKEET_MODELS = SPEECH_MODELS;

/**
 * Throws an `AvanzelError` unless `options` name a backend, model and quantization `makeTranscriber` can run. A
 * command has no model or quantization to check.
 */
function checkVoice({ backend, model, quantization }: VoiceOptions): void {
  if (backend === "command") return;
  if (backend !== "onnx-asr") throw new AvanzelError(`Unknown voice backend '${backend}'; use "onnx-asr" or "command".`);
  if (!PARAKEET_MODELS.includes(model)) {
    const names = PARAKEET_MODELS.map((id) => `"${id}"`);
    throw new AvanzelError(`Speech model '${model}' is not supported; use ${names.slice(0, -1).join(", ")} or ${names.at(-1)}.`);
  }
  modelFiles(model, quantization); // rejects an unknown quantization now rather than on first use
}

/**
 * The speech models `options` need on disk, for `missingModels` and `downloadModels`: none for a command, else the
 * Parakeet model and Silero VAD. Throws what `makeTranscriber` does for options it cannot run.
 */
export function speechModels(options: VoiceOptions): string[] {
  checkVoice(options);
  return options.backend === "command" ? [] : [options.model, VAD_MODEL];
}

/**
 * The transcriber `options` ask for. Parakeet loads on first use; while `locateModel` finds no complete
 * copy of it or of Silero VAD, transcribing throws a `MissingModelError` naming what `downloadModels` should fetch.
 */
export async function makeTranscriber(options: VoiceOptions, modelsDir: string): Promise<Transcriber> {
  checkVoice(options);
  const { backend, model, quantization } = options;
  const dictionary = options.dictionary ?? [];
  const soundAlike = options.dictionarySoundAlike ?? true;
  if (backend === "command") return withDictionary(new CommandTranscriber(options.command), dictionary, { soundAlike });
  const transcriber = lazily(`onnx-asr:${model}`, async () => {
    const modelDir = locateModel(model, modelsDir, quantization);
    const vadDir = locateModel(VAD_MODEL, modelsDir);
    if (!modelDir || !vadDir) throw new MissingModelError([...(modelDir ? [] : [model]), ...(vadDir ? [] : [VAD_MODEL])]);
    return ParakeetTranscriber.load(modelDir, { model, quantization, vadPath: join(vadDir, modelFiles(VAD_MODEL)[0]!) });
  });
  return withDictionary(transcriber, dictionary, { soundAlike });
}

/**
 * `inner` with the owner's personal dictionary applied to every text it gives: `transcribe`, and each stretch from
 * `transcribeSegments`. Nothing else changes (the engine, the seconds, the timings), and `heard` holds what the speech
 * model recognised only when the dictionary changed the text. A dictionary with no entry in it gives `inner` itself.
 */
export function withDictionary(
  inner: Transcriber,
  dictionary: readonly string[],
  { soundAlike = true }: { soundAlike?: boolean } = {},
): Transcriber {
  const entries = parseDictionary(dictionary);
  if (entries.length === 0) return inner;
  const correct = compileDictionary(entries, { soundAlike }); // made ready once, for every transcript and segment
  const wrapped: Transcriber = {
    engine: inner.engine,
    async transcribe(audio, sampleRate) {
      const transcript = await inner.transcribe(audio, sampleRate);
      const { text, changed } = correct(transcript.text);
      return changed ? { ...transcript, text, heard: transcript.text } : transcript;
    },
  };
  const { transcribeSegments, release } = inner;
  if (transcribeSegments) {
    wrapped.transcribeSegments = async (samples, sampleRate) =>
      (await transcribeSegments.call(inner, samples, sampleRate)).map((part) => ({ ...part, text: correct(part.text).text }));
  }
  if (release) wrapped.release = () => release.call(inner);
  return wrapped;
}

/**
 * Loads on first use, and tries again after a failed load (say, once the models are downloaded). `release()` lets the
 * transcriptions in progress (`transcribe` and `transcribeSegments` alike) finish, then frees what was loaded; the next
 * `transcribe` or `transcribeSegments` loads again, once that is done, so there is never more than one copy of the model.
 * Exported for tests; apps get theirs from `makeTranscriber`.
 */
export function lazily(engine: string, load: () => Promise<Transcriber>): Required<Transcriber> {
  let loading: Promise<Transcriber> | null = null;
  /** Every transcription from the moment `transcribe` is called, even while it waits for the model to load. */
  const running = new Set<Promise<unknown>>();
  let releasing: Promise<void> | null = null;

  async function loadAndUse<T>(use: (model: Transcriber) => Promise<T>): Promise<T> {
    if (releasing) await releasing.catch(() => {}); // a failed release is for its caller to hear about, not this transcription
    loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return use(await loading);
  }

  async function track<T>(use: (model: Transcriber) => Promise<T>): Promise<T> {
    const run = loadAndUse(use);
    running.add(run);
    try {
      return await run;
    } finally {
      running.delete(run);
    }
  }

  async function freeModel(): Promise<void> {
    await Promise.allSettled(running); // those started so far; later ones wait for the release in `loadAndUse`
    const model = loading;
    loading = null;
    await (await model)?.release?.();
  }

  return {
    engine,
    transcribe: (audio, sampleRate) => track((model) => model.transcribe(audio, sampleRate)),
    transcribeSegments: (samples, sampleRate): Promise<TimedText[]> =>
      track((model) => {
        if (!model.transcribeSegments) throw new AvanzelError(`${engine} cannot tell where in the audio each part was said.`);
        return model.transcribeSegments(samples, sampleRate);
      }),
    release() {
      releasing ??= freeModel().finally(() => {
        releasing = null;
      });
      return releasing;
    },
  };
}
