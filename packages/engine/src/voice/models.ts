// Speech model files: what each model needs, where an existing copy is (the app's models directory or a
// Hugging Face cache snapshot), and downloading whatever is missing from Hugging Face: pinned to a commit and
// checked against the size and SHA-256 recorded here.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { AvanzelError } from "../types.ts";

export interface ModelSpec {
  /** Hugging Face repo the files come from. */
  repo: string;
  /** Hugging Face commit every file is downloaded from; the digests are for it. */
  revision: string;
  /** Files the model needs, by quantization: "int8" or "" (full precision). */
  files: Readonly<Record<string, readonly string[]>>;
  /** Size in bytes and lowercase hex SHA-256 of every file listed in `files`. */
  digests: Readonly<Record<string, { size: number; sha256: string }>>;
}

type Digest = ModelSpec["digests"][string];

/** Silero VAD, which splits recordings longer than 25 s for Parakeet. */
export const VAD_MODEL = "silero-vad";

/** Parakeet's encoder and decoder files for `quantization` ("int8" or "" for full precision). */
export function parakeetFileNames(quantization: string): { encoder: string; decoder: string } {
  const suffix = quantization === "" ? "" : `.${quantization}`;
  return { encoder: `encoder-model${suffix}.onnx`, decoder: `decoder_joint-model${suffix}.onnx` };
}

// Parakeet's nemo128 preprocessor is not listed: the engine ships its own (assets/nemo128.onnx).
function parakeet(repo: string, revision: string, digests: ModelSpec["digests"]): ModelSpec {
  const int8 = parakeetFileNames("int8");
  const full = parakeetFileNames("");
  return {
    repo,
    revision,
    files: {
      int8: [int8.encoder, int8.decoder, "vocab.txt", "config.json"],
      "": [full.encoder, "encoder-model.onnx.data", full.decoder, "vocab.txt", "config.json"],
    },
    digests,
  };
}

// Size and SHA-256 of every file at the pinned revision, as the Hugging Face API gave them on 2026-10-20.
export const MODELS: Readonly<Record<string, ModelSpec>> = {
  "nemo-parakeet-tdt-0.6b-v3": parakeet("istupakov/parakeet-tdt-0.6b-v3-onnx", "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce", {
    "config.json": { size: 97, sha256: "666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466" },
    "vocab.txt": { size: 93939, sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d" },
    "encoder-model.int8.onnx": { size: 652183999, sha256: "6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09" },
    "decoder_joint-model.int8.onnx": { size: 18202004, sha256: "eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70" },
    "encoder-model.onnx": { size: 41770866, sha256: "98a74b21b4cc0017c1e7030319a4a96f4a9506e50f0708f3a516d02a77c96bb1" },
    "encoder-model.onnx.data": { size: 2435420160, sha256: "9a22d372c51455c34f13405da2520baefb7125bd16981397561423ed32d24f36" },
    "decoder_joint-model.onnx": { size: 72520893, sha256: "e978ddf6688527182c10fde2eb4b83068421648985ef23f7a86be732be8706c1" },
  }),
  "nemo-parakeet-tdt-0.6b-v2": parakeet("istupakov/parakeet-tdt-0.6b-v2-onnx", "0bbb45a3365852604aef28b538a8f066f4ccaa85", {
    "config.json": { size: 97, sha256: "666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466" },
    "vocab.txt": { size: 9384, sha256: "ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d" },
    "encoder-model.int8.onnx": { size: 652184014, sha256: "3e0581fda6ab843888b51e56d7ee78b6d5bc3237ec113af1f732d1d5286aa155" },
    "decoder_joint-model.int8.onnx": { size: 8998286, sha256: "a449f49acd68979d418651dd2dcb737cc0f1bf0225e009e29ee326354edbf7d3" },
    "encoder-model.onnx": { size: 41770866, sha256: "3987bcd28175d829d12888a996a84e8f62a0e374d9ffd640662c1515adc679d3" },
    "encoder-model.onnx.data": { size: 2435420160, sha256: "4dab7362d4874d85965045b1e41b2d61dd2cc0fb25671a7f6b3dc47bf120cc41" },
    "decoder_joint-model.onnx": { size: 35792059, sha256: "cbb52a07bd70ab5b67f8439d4b3cd8704b18467b4430bcacb5adabe154b8d191" },
  }),
  [VAD_MODEL]: {
    repo: "istupakov/silero-vad-onnx",
    revision: "b3e3ee3cce4c11ceb63b1a0b229d916069c1ddf6",
    files: { int8: ["silero_vad.onnx"], "": ["silero_vad.onnx"] },
    digests: { "silero_vad.onnx": { size: 2327524, sha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3" } },
  },
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

function quantizedFiles({ files }: ModelSpec, quantization: string, label: string): readonly string[] {
  if (!Object.hasOwn(files, quantization)) {
    throw new AvanzelError(`Unknown quantization '${quantization}' for ${label}; use "int8" or "" (full precision).`);
  }
  return files[quantization]!;
}

/** The files model `id` needs with `quantization` ("int8" or "" for full precision). */
export function modelFiles(id: string, quantization = "int8"): readonly string[] {
  return quantizedFiles(spec(id), quantization, id);
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

/** The size of the file at `path`, or null when there is none. */
function fileSize(path: string): number | null {
  try {
    const stats = statSync(path); // follows symlinks, so dangling ones don't count
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

function isFile(path: string): boolean {
  return fileSize(path) !== null;
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
  /** The file's pinned size. Never null now; the type keeps null for callers that handle it. */
  totalBytes: number | null;
  overallReceived: number;
  /** The pinned sizes of everything being downloaded, added up. Never null now either. */
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

// Ask for the files as they are: Hugging Face gzips text files, and what gets checked is the file's own bytes.
const HEADERS = { "accept-encoding": "identity" };

/** Makes `<modelsDir>/<id>/` complete and returns it; see `downloadModelFiles`. */
export async function downloadModel(id: string, modelsDir: string, options: DownloadOptions = {}): Promise<string> {
  return downloadModelFiles(spec(id), join(modelsDir, id), options);
}

/** A file of a model, with the size and SHA-256 it has to have. */
interface PinnedFile extends Digest {
  name: string;
}

/**
 * Makes `dir` hold every file of `model` for `options.quantization` and returns it: files already there are kept,
 * files in a Hugging Face cache snapshot are symlinked when they have the pinned size (the cache is never written
 * to), the rest is downloaded from `<baseUrl>/<repo>/resolve/<revision>/<file>`, streamed to `<file>.part` and
 * renamed into place only when its size and SHA-256 are the pinned ones.
 */
export async function downloadModelFiles(model: ModelSpec, dir: string, options: DownloadOptions = {}): Promise<string> {
  const { quantization = "int8", onProgress, signal, baseUrl = "https://huggingface.co" } = options;
  const names = quantizedFiles(model, quantization, model.repo);
  const files = names.map((name): PinnedFile => ({ name, ...digestOf(model, name) }));
  mkdirSync(dir, { recursive: true });

  const snapshots = hfSnapshots(model.repo);
  const missing: PinnedFile[] = [];
  for (const file of files) {
    const target = join(dir, file.name);
    if (isFile(target)) continue;
    const cached = snapshots.map((snapshot) => join(snapshot, file.name)).find((path) => fileSize(path) === file.size);
    if (cached === undefined) {
      missing.push(file);
      continue;
    }
    // A dangling link from an earlier, since cleaned, cache. Not rmSync: Node 24.11 leaves dangling links alone.
    if (lstatSync(target, { throwIfNoEntry: false })) unlinkSync(target);
    symlinkSync(cached, target);
  }

  const overallTotal = missing.reduce((sum, file) => sum + file.size, 0);
  let overallReceived = 0;
  for (const file of missing) {
    const done = overallReceived;
    const url = `${baseUrl}/${model.repo}/resolve/${model.revision}/${file.name}`;
    await fetchFile(file, url, join(dir, file.name), signal, (receivedBytes) => {
      overallReceived = done + receivedBytes;
      onProgress?.({ file: file.name, receivedBytes, totalBytes: file.size, overallReceived, overallTotal });
    });
  }
  return dir;
}

function digestOf(model: ModelSpec, name: string): Digest {
  const digest = Object.hasOwn(model.digests, name) ? model.digests[name] : undefined;
  if (digest === undefined) throw new AvanzelError(`Cannot download ${name}: no size and SHA-256 are pinned for it.`);
  return digest;
}

async function fetchFile(
  { name, size, sha256 }: PinnedFile,
  url: string,
  target: string,
  signal: AbortSignal | undefined,
  progress: (receivedBytes: number) => void,
): Promise<void> {
  const failed = (why: string) => new AvanzelError(`Could not download ${name} from ${url}: ${why}`);
  const part = `${target}.part`;
  try {
    const response = await fetch(url, { headers: HEADERS, signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw failed(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    const hash = createHash("sha256");
    let received = 0;
    const file = await open(part, "w");
    try {
      progress(0);
      // The digest runs over the chunks on their way into the file, and `pipeline` returns only once the file stream
      // has written every one of them (or failed), so it covers exactly what was written.
      await pipeline(
        response.body,
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            hash.update(chunk);
            received += chunk.length;
            progress(received);
            yield chunk;
          }
        },
        file.createWriteStream(),
      );
    } finally {
      // When `pipeline` fails it can return before the file stream has finished closing; close() waits for that and for
      // any write still under way, so nothing touches the part once it is removed below.
      await file.close();
    }
    const written = (await stat(part)).size; // what reached the disk, whatever came over the network
    if (written !== size) throw failed(`got ${written} of ${size} bytes; try again`);
    if (hash.digest("hex") !== sha256) throw failed("the SHA-256 of what arrived is not the expected one; try again");
    await rename(part, target);
  } catch (error) {
    await rm(part, { force: true });
    if (signal?.aborted || error instanceof AvanzelError) throw error;
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    throw failed(`${error instanceof Error ? error.message : String(error)}${cause}`);
  }
}
