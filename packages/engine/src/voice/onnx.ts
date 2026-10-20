// What the engine's ONNX models share: the session options, and the assets folder the bundled ones ship in.
import { fileURLToPath } from "node:url";
import type { InferenceSession } from "onnxruntime-node";

/** CPU only: on macOS the CoreML provider was measured ~10x slower for Parakeet. */
export const SESSION_OPTIONS: InferenceSession.SessionOptions = {
  executionProviders: ["cpu"],
  intraOpNumThreads: 4,
  logSeverityLevel: 3,
};

/** The engine's assets folder: AVANZEL_ASSETS when the app ships a copy elsewhere, else packages/engine/assets/. */
export function assetsDir(): string {
  return process.env.AVANZEL_ASSETS || fileURLToPath(new URL("../../assets/", import.meta.url));
}
