// Speech model files: what each model needs, where an existing copy is (the app's models directory or a
// Hugging Face cache snapshot), and downloading whatever is missing.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { AvanzelError } from "../types.ts";

/** A file taken from a zip archive (a Python wheel) instead of the model's repo. */
export interface ArchivedFile {
  url: string;
  /** Path of the file inside the archive. */
  entry: string;
}

export interface ModelSpec {
  /** Hugging Face repo the files come from. */
  repo: string;
  /** Files the model needs, by quantization: "int8" or "" (full precision). */
  files: Readonly<Record<string, readonly string[]>>;
  /** Files that come from an archive rather than the repo; never taken from a Hugging Face snapshot. */
  archived?: Readonly<Record<string, ArchivedFile>>;
}

/** Silero VAD, which splits recordings longer than 25 s for Parakeet. */
export const VAD_MODEL = "silero-vad";

// The nemo128 mel-feature preprocessor as onnx-asr 0.12.0 ships it (sha256 5b4a84c5…): zero padding and
// N/160 frames, matching the NumPy features Avanzel v0.1 computes to ~2e-4. The nemo128.onnx in the Parakeet
// repos predates onnx-asr 0.11 (reflect padding, one frame more, fails under 257 samples), so it is not used.
const NEMO128: ArchivedFile = {
  url: "https://files.pythonhosted.org/packages/6a/60/2fa469a2ee674c35ab48821a1039762ae7b9d0b88188ac1012e779477f76/onnx_asr-0.12.0-py3-none-any.whl",
  entry: "onnx_asr/preprocessors/data/nemo128.onnx",
};

function parakeet(repo: string): ModelSpec {
  return {
    repo,
    files: {
      int8: ["encoder-model.int8.onnx", "decoder_joint-model.int8.onnx", "vocab.txt", "config.json", "nemo128.onnx"],
      "": ["encoder-model.onnx", "encoder-model.onnx.data", "decoder_joint-model.onnx", "vocab.txt", "config.json", "nemo128.onnx"],
    },
    archived: { "nemo128.onnx": NEMO128 },
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
 * snapshot (only for models without archived files); null when there is no complete copy.
 */
export function locateModel(id: string, modelsDir: string, quantization = "int8"): string | null {
  const files = modelFiles(id, quantization);
  const { repo, archived = {} } = spec(id);
  const snapshots = files.some((name) => Object.hasOwn(archived, name)) ? [] : hfSnapshots(repo);
  return [join(modelsDir, id), ...snapshots].find((dir) => files.every((name) => isFile(join(dir, name)))) ?? null;
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
 * Makes `<modelsDir>/<id>/` complete (see `downloadModelFiles`) and returns it. Repo files come from
 * `<baseUrl>/<repo>/resolve/main/<file>`.
 */
export async function downloadModel(id: string, modelsDir: string, options: DownloadOptions = {}): Promise<string> {
  return downloadModelFiles(spec(id), join(modelsDir, id), options);
}

/**
 * Makes `dir` hold every file of `model`: files already there are kept, repo files in a Hugging Face cache
 * snapshot are symlinked (the cache is never written to), the rest is downloaded. Each download streams to
 * `<file>.part` and is renamed when complete; archived files are extracted from their archive first.
 */
export async function downloadModelFiles(model: ModelSpec, dir: string, options: DownloadOptions = {}): Promise<string> {
  const { quantization = "int8", onProgress, signal, baseUrl = "https://huggingface.co" } = options;
  if (!Object.hasOwn(model.files, quantization)) {
    throw new AvanzelError(`Unknown quantization '${quantization}'; use "int8" or "" (full precision).`);
  }
  const files = model.files[quantization]!;
  const archived = model.archived ?? {};
  mkdirSync(dir, { recursive: true });

  const snapshots = hfSnapshots(model.repo);
  const missing: { name: string; url: string; entry?: string }[] = [];
  for (const name of files) {
    const target = join(dir, name);
    if (isFile(target)) continue;
    const archive = Object.hasOwn(archived, name) ? archived[name] : undefined;
    const cached = archive ? undefined : snapshots.map((snapshot) => join(snapshot, name)).find(isFile);
    if (cached === undefined) {
      missing.push({ name, url: archive?.url ?? `${baseUrl}/${model.repo}/resolve/main/${name}`, entry: archive?.entry });
      continue;
    }
    rmSync(target, { force: true }); // a dangling link from an earlier, since cleaned, cache
    symlinkSync(cached, target);
  }

  const sizes = await Promise.all(missing.map(({ url }) => contentLength(url, signal)));
  const overallTotal = sizes.every((size) => size !== null) ? sizes.reduce<number>((sum, size) => sum + size!, 0) : null;
  let overallReceived = 0;
  for (const [index, file] of missing.entries()) {
    const done = overallReceived;
    await fetchFile(file, join(dir, file.name), sizes[index] ?? null, signal, (receivedBytes, totalBytes) => {
      overallReceived = done + receivedBytes;
      onProgress?.({ file: file.name, receivedBytes, totalBytes, overallReceived, overallTotal });
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
  { name, url, entry }: { name: string; url: string; entry?: string },
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
    if (entry !== undefined) {
      try {
        await writeFile(part, unzipEntry(await readFile(part), entry));
      } catch (error) {
        throw failed(error instanceof Error ? error.message : String(error));
      }
    }
    await rename(part, target);
  } catch (error) {
    await rm(part, { force: true });
    if (signal?.aborted || error instanceof AvanzelError) throw error;
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    throw failed(`${error instanceof Error ? error.message : String(error)}${cause}`);
  }
}

/** The contents of `entry` in a zip archive (stored or deflated, without zip64, as Python wheels are). */
export function unzipEntry(zip: Buffer, entry: string): Buffer {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > zip.length) throw new AvanzelError("The download is not a zip archive.");
  let offset = zip.readUInt32LE(end + 16);
  for (let index = zip.readUInt16LE(end + 10); index > 0 && zip.readUInt32LE(offset) === 0x02014b50; index--) {
    const nameLength = zip.readUInt16LE(offset + 28);
    if (zip.toString("utf8", offset + 46, offset + 46 + nameLength) === entry) {
      const method = zip.readUInt16LE(offset + 10);
      const local = zip.readUInt32LE(offset + 42);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + zip.readUInt32LE(offset + 20));
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new AvanzelError(`${entry} uses unsupported zip compression ${method}.`);
    }
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  throw new AvanzelError(`${entry} is not in the archive.`);
}
