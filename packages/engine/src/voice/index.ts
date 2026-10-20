// Local speech-to-text: Parakeet through onnxruntime-node, or any speech-to-text CLI.
import { join } from "node:path";
import { AvanzelError, type Transcriber, type VoiceOptions } from "../types.ts";
import { CommandTranscriber } from "./command.ts";
import { locateModel, MissingModelError, modelFiles, VAD_MODEL } from "./models.ts";
import { ParakeetTranscriber } from "./parakeet.ts";

export { CommandTranscriber } from "./command.ts";
export {
  type DownloadOptions,
  type DownloadProgress,
  downloadModel,
  locateModel,
  MissingModelError,
  MODELS,
  type ModelSpec,
  modelFiles,
  VAD_MODEL,
} from "./models.ts";
export { type ParakeetOptions, ParakeetTranscriber } from "./parakeet.ts";
export { segmentSpeech } from "./vad.ts";
export { readWav, resampleLinear, type WavAudio, writeWav } from "./wav.ts";

/** Speech models the onnx-asr backend runs. */
const PARAKEET_MODELS = ["nemo-parakeet-tdt-0.6b-v3", "nemo-parakeet-tdt-0.6b-v2"] as const;

/**
 * The transcriber `options` ask for. Parakeet loads on first use; while `locateModel` finds no complete
 * copy of it or of Silero VAD, transcribing throws a `MissingModelError` naming what `downloadModel` should fetch.
 */
export async function makeTranscriber(options: VoiceOptions, modelsDir: string): Promise<Transcriber> {
  const { backend, model, quantization } = options;
  if (backend === "command") return new CommandTranscriber(options.command);
  if (backend !== "onnx-asr") throw new AvanzelError(`Unknown voice backend '${backend}'; use "onnx-asr" or "command".`);
  if (!(PARAKEET_MODELS as readonly string[]).includes(model)) {
    throw new AvanzelError(`Speech model '${model}' is not supported; use "${PARAKEET_MODELS.join('" or "')}".`);
  }
  modelFiles(model, quantization); // rejects an unknown quantization now rather than on first use
  return lazily(`onnx-asr:${model}`, async () => {
    const modelDir = locateModel(model, modelsDir, quantization);
    const vadDir = locateModel(VAD_MODEL, modelsDir);
    if (!modelDir || !vadDir) throw new MissingModelError([...(modelDir ? [] : [model]), ...(vadDir ? [] : [VAD_MODEL])]);
    return ParakeetTranscriber.load(modelDir, { model, quantization, vadPath: join(vadDir, modelFiles(VAD_MODEL)[0]!) });
  });
}

/** Loads on first use, and tries again after a failed load (say, once the models are downloaded). */
function lazily(engine: string, load: () => Promise<Transcriber>): Transcriber {
  let loading: Promise<Transcriber> | null = null;
  return {
    engine,
    async transcribe(audio, sampleRate) {
      loading ??= load().catch((error: unknown) => {
        loading = null;
        throw error;
      });
      return (await loading).transcribe(audio, sampleRate);
    },
  };
}
