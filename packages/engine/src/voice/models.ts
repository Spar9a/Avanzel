// Speech model files: what each model needs, where an existing copy is (the app's models directory or a
// Hugging Face cache snapshot), and downloading whatever is missing from Hugging Face.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AvanzelError } from "../types.ts";

export interface ModelSpec {
  /** Hugging Face repo the files come from. */
  repo: string;
  /** Files the model needs, by quantization: "int8" or "" (full precision). */
  files: Readonly<Record<string, readonly string[]>>;
}

/** Silero VAD, which splits recordings longer than 25 s for Parakeet. */
export const VAD_MODEL = "silero-vad";

/** Parakeet's encoder and decoder files for `quantization` ("int8" or "" for full precision). */
export function parakeetFileNames(quantization: string): { encoder: string; decoder: string } {
  const suffix = quantization === "" ? "" : `.${quantization}`;
  return { encoder: `encoder-model${suffix}.onnx`, decoder: `decoder_joint-model${suffix}.onnx` };
}

// Parakeet's nemo128 preprocessor is not listed: the engine ships its own (assets/nemo128.onnx).
function parakeet(repo: string): ModelSpec {
  const int8 = parakeetFileNames("int8");
  const full = parakeetFileNames("");
  return {
    repo,
    files: {
      int8: [int8.encoder, int8.decoder, "vocab.txt", "config.json"],
      "": [full.encoder, "encoder-model.onnx.data", full.decoder, "vocab.txt", "config.json"],
    },
  };
}

export const MODELS: Readonly<Record<string, ModelSpec>> = {
  "nemo-parakeet-tdt-0.6b-v3": parakeet("istupakov/parakeet-tdt-0.6b-v3-onnx"),
  "nemo-parakeet-tdt-0.6b-v2": parakeet("istupakov/parakeet-tdt-0.6b-v2-onnx"),
  [VAD_MODEL]: { repo: "istupakov/silero-vad-onnx", files: { int8: ["silero_vad.onnx"], "": ["silero_vad.onnx"] } },
};

/** The speech models are not on this Mac yet; apps catch this to offer `downloadModel` for `models`. */
export class MissingModelError extends AvanzelError {
  readonly models: string[];

  constructor(models: string[]) {
    super(`Speech models not downloaded yet: ${models.join(", ")}.`);
    this.models = models;
  }
}

function spec(id: string): ModelSpec {
  if (!Object.hasOwn(MODELS, id)) throw new AvanzelError(`Unknown speech model '${id}'.`);
  return MODELS[id]!;
}

/** The files model `id` needs with `quantization` ("int8" or "" for full precision). */
export function modelFiles(id: string, quantization = "int8"): readonly string[] {
  const { files } = spec(id);
  if (!Object.hasOwn(files, quantization)) {
    throw new AvanzelError(`Unknown quantization '${quantization}' for ${id}; use "int8" or "" (full precision).`);
  }
  return files[quantization]!;
}

/** Where huggingface_hub keeps its cache: HF_HUB_CACHE, else HF_HOME/hub, else ~/.cache/huggingface/hub. */
export function hfCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HF_HUB_CACHE) return env.HF_HUB_CACHE;
  return join(env.HF_HOME || join(homedir(), ".cache", "huggingface"), "hub");
}

/** Snapshot directories of `repo` in the Hugging Face cache, the one refs/main points at first. */
function hfSnapshots(repo: string): string[] {
  const base = join(hfCacheDir(), `models--${repo.replaceAll("/", "--")}`);
  let revisions: string[];
  try {
    revisions = readdirSync(join(base, "snapshots"));
  } catch {
    return [];
  }
  let main = "";
  try {
    main = readFileSync(join(base, "refs", "main"), "utf8").trim();
  } catch {
    // no refs/main: any snapshot will do
  }
  revisions.sort((a, b) => Number(b === main) - Number(a === main));
  return revisions.map((revision) => join(base, "snapshots", revision));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile(); // follows symlinks, so dangling ones don't count
  } catch {
    return false;
  }
}

/**
 * A directory holding every file of model `id`: `<modelsDir>/<id>/` first, else a Hugging Face cache
 * snapshot; null when there is no complete copy.
 */
export function locateModel(id: string, modelsDir: string, quantization = "int8"): string | null {
  const files = modelFiles(id, quantization);
  const candidates = [join(modelsDir, id), ...hfSnapshots(spec(id).repo)];
  return candidates.find((dir) => files.every((name) => isFile(join(dir, name)))) ?? null;
}

export interface DownloadProgress {
  file: string;
  receivedBytes: number;
  /** null when the server does not say. */
  totalBytes: number | null;
  overallReceived: number;
  overallTotal: number | null;
}

export interface DownloadOptions {
  /** "int8" (default) or "" for the full-precision files. */
  quantization?: string;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  /** Defaults to https://huggingface.co; tests point it at a local server. */
  baseUrl?: string;
}

// Hugging Face gzips text files and then omits Content-Length; identity keeps every size known.
const HEADERS = { "accept-encoding": "identity" };

/**
 * Makes `<modelsDir>/<id>/` complete and returns it: files already there are kept, files in a Hugging Face
 * cache snapshot are symlinked (the cache is never written to), the rest is downloaded from
 * `<baseUrl>/<repo>/resolve/main/<file>`, streamed to `<file>.part` and renamed when complete.
 */
export async function downloadModel(id: string, modelsDir: string, options: DownloadOptions = {}): Promise<string> {
  const { quantization = "int8", onProgress, signal, baseUrl = "https://huggingface.co" } = options;
  const files = modelFiles(id, quantization);
  const { repo } = spec(id);
  const dir = join(modelsDir, id);
  mkdirSync(dir, { recursive: true });

  const snapshots = hfSnapshots(repo);
  const missing: string[] = [];
  for (const name of files) {
    const target = join(dir, name);
    if (isFile(target)) continue;
    const cached = snapshots.map((snapshot) => join(snapshot, name)).find(isFile);
    if (cached === undefined) {
      missing.push(name);
      continue;
    }
    rmSync(target, { force: true }); // a dangling link from an earlier, since cleaned, cache
    symlinkSync(cached, target);
  }

  const urls = missing.map((name) => `${baseUrl}/${repo}/resolve/main/${name}`);
  const sizes = await Promise.all(urls.map((url) => contentLength(url, signal)));
  const overallTotal = sizes.every((size) => size !== null) ? sizes.reduce<number>((sum, size) => sum + size!, 0) : null;
  let overallReceived = 0;
  for (const [index, name] of missing.entries()) {
    const done = overallReceived;
    await fetchFile(name, urls[index]!, join(dir, name), sizes[index] ?? null, signal, (receivedBytes, totalBytes) => {
      overallReceived = done + receivedBytes;
      onProgress?.({ file: name, receivedBytes, totalBytes, overallReceived, overallTotal });
    });
  }
  return dir;
}

async function contentLength(url: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch(url, { method: "HEAD", headers: HEADERS, signal });
    const length = response.headers.get("content-length");
    return response.ok && length !== null ? Number(length) : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null; // sizes only feed the progress report; the download itself reports real failures
  }
}

async function fetchFile(
  name: string,
  url: string,
  target: string,
  expectedSize: number | null,
  signal: AbortSignal | undefined,
  progress: (receivedBytes: number, totalBytes: number | null) => void,
): Promise<void> {
  const failed = (why: string) => new AvanzelError(`Could not download ${name} from ${url}: ${why}`);
  const part = `${target}.part`;
  try {
    const response = await fetch(url, { headers: HEADERS, signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw failed(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    const length = response.headers.get("content-length");
    const totalBytes = length !== null ? Number(length) : expectedSize;
    const file = await open(part, "w");
    let received = 0;
    try {
      progress(0, totalBytes);
      for await (const chunk of response.body) {
        await file.write(chunk);
        received += chunk.length;
        progress(received, totalBytes);
      }
    } finally {
      await file.close();
    }
    if (totalBytes !== null && received !== totalBytes) throw failed(`got ${received} of ${totalBytes} bytes; try again`);
    await rename(part, target);
  } catch (error) {
    await rm(part, { force: true });
    if (signal?.aborted || error instanceof AvanzelError) throw error;
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    throw failed(`${error instanceof Error ? error.message : String(error)}${cause}`);
  }
}
