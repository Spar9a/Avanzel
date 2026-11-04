// Local speech-to-text: Parakeet through onnxruntime-node, or any speech-to-text CLI.
import { join } from "node:path";
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
  modelFiles,
  VAD_MODEL,
} from "./models.ts";
export { type ParakeetOptions, ParakeetTranscriber } from "./parakeet.ts";
export { resampleTo16k } from "./resample.ts";
export { segmentSpeech } from "./vad.ts";
export { readWav, type WavAudio, writeWav } from "./wav.ts";

/** Speech models the onnx-asr backend runs: every known model but Silero VAD. */
const PARAKEET_MODELS = Object.keys(MODELS).filter((id) => id !== VAD_MODEL);

/**
 * Throws an `AvanzelError` unless `options` name a backend, model and quantization `makeTranscriber` can run. A
 * command has no model or quantization to check.
 */
function checkVoice({ backend, model, quantization }: VoiceOptions): void {
  if (backend === "command") return;
  if (backend !== "onnx-asr") throw new AvanzelError(`Unknown voice backend '${backend}'; use "onnx-asr" or "command".`);
  if (!PARAKEET_MODELS.includes(model)) {
    throw new AvanzelError(`Speech model '${model}' is not supported; use "${PARAKEET_MODELS.join('" or "')}".`);
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
  if (backend === "command") return new CommandTranscriber(options.command);
  return lazily(`onnx-asr:${model}`, async () => {
    const modelDir = locateModel(model, modelsDir, quantization);
    const vadDir = locateModel(VAD_MODEL, modelsDir);
    if (!modelDir || !vadDir) throw new MissingModelError([...(modelDir ? [] : [model]), ...(vadDir ? [] : [VAD_MODEL])]);
    return ParakeetTranscriber.load(modelDir, { model, quantization, vadPath: join(vadDir, modelFiles(VAD_MODEL)[0]!) });
  });
}

/**
 * Loads on first use, and tries again after a failed load (say, once the models are downloaded). `release()` lets the
 * transcriptions in progress finish, then frees what was loaded; the next `transcribe` loads again, once that is done,
 * so there is never more than one copy of the model. Exported for tests; apps get theirs from `makeTranscriber`.
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
    await Promise.allSettled(running); // those started so far; later ones wait for the release in `loadAndTranscribe`
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
