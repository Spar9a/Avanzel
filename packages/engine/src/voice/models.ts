// Speech model files: what each model needs, where an existing copy is (the app's models directory or a
// Hugging Face cache snapshot), and downloading whatever is missing from Hugging Face: pinned to a commit and
// checked against the size and SHA-256 recorded here. A download that stops keeps what arrived and continues from it.
import { createHash, type Hash } from "node:crypto";
import { createReadStream, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, unlinkSync } from "node:fs";
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
  // Moondream's post-training of v3, in the same files: the v3 export's graphs with Parakeet Ultra's weights, so its
  // config and vocabulary are v3's to the byte. One community account converts it, hence the pinned commit (2026-11-13).
  "moondream-parakeet-ultra-0.6b": parakeet("Masterx/parakeet-tdt-0.6b-ultra-onnx", "99b09f030a5a6efeaa13cf2cf54592100ce2c3f1", {
    "config.json": { size: 97, sha256: "666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466" },
    "vocab.txt": { size: 93939, sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d" },
    "encoder-model.int8.onnx": { size: 652183214, sha256: "46e78f85f1ae43b43bd359889c966da5c7ca401df60a42eeffc2e7699b357ba6" },
    "decoder_joint-model.int8.onnx": { size: 18202004, sha256: "2276a335d4c8dc48686e931475a634595954956427d485830e1214c0d1a18d07" },
    "encoder-model.onnx": { size: 41770866, sha256: "98a74b21b4cc0017c1e7030319a4a96f4a9506e50f0708f3a516d02a77c96bb1" },
    "encoder-model.onnx.data": { size: 2435420160, sha256: "1209bc92c87a2f596767ae080aec04702d94a2a41eaba4cee5a89f69a9c22c12" },
    "decoder_joint-model.onnx": { size: 72520893, sha256: "87cdaae0a1102f6be1cb2bb45d6a7d4d914b23b764d5fba704a82960f988f958" },
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

/** The speech models are not on this Mac yet; apps catch this to offer `downloadModels` for `models`. */
export class MissingModelError extends AvanzelError {
  readonly models: string[];

  constructor(models: string[]) {
    super(`Speech models not downloaded yet: ${models.join(", ")}.`);
    this.models = models;
  }
}

/**
 * A file of a speech model could not be downloaded. `message` names the file and why, without the URL it came from (a host
 * name or an ip:port that the system names in its own words, like "ENOTFOUND huggingface.co", stays: it is what says why).
 * `resumable` says a part of the file was kept, so the next try continues where this one stopped; false when nothing
 * arrived, or what did was wrong and has been deleted.
 */
export class DownloadError extends AvanzelError {
  override name = "DownloadError";
  readonly resumable: boolean;

  constructor(message: string, resumable: boolean) {
    super(message);
    this.resumable = resumable;
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

/** The pinned sizes of model `id`'s files with `quantization`, added up: what it takes on disk, wherever its copy is. */
export function modelBytes(id: string, quantization = "int8"): number {
  const model = spec(id);
  return quantizedFiles(model, quantization, id).reduce((sum, name) => sum + digestOf(model, name).size, 0);
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
 * A directory holding every file of model `id`: `<modelsDir>/<id>/` first, when each file there has its pinned
 * size (an older build, which checked nothing, may have left one short), else a Hugging Face cache snapshot that
 * has every file; null when there is no complete copy.
 */
export function locateModel(id: string, modelsDir: string, quantization = "int8"): string | null {
  const model = spec(id);
  const files = quantizedFiles(model, quantization, id);
  const own = join(modelsDir, id);
  if (files.every((name) => fileSize(join(own, name)) === digestOf(model, name).size)) return own;
  return hfSnapshots(model.repo).find((dir) => files.every((name) => isFile(join(dir, name)))) ?? null;
}

/** The models among `ids` that `locateModel` finds no complete copy of, in the order given. */
export function missingModels(ids: readonly string[], modelsDir: string, quantization = "int8"): string[] {
  return ids.filter((id) => locateModel(id, modelsDir, quantization) === null);
}

export interface DownloadProgress {
  file: string;
  /** The file's bytes so far. A file that continues from a kept part starts at the bytes kept, not at zero. */
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
  /** Aborting rejects with the signal's own error and keeps no `.part`, the one an earlier try left included. */
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

/**
 * Makes `<modelsDir>/<id>/` complete for each of `ids` and returns those directories in that order; see
 * `downloadModelsFiles`.
 */
export async function downloadModels(
  ids: readonly string[],
  modelsDir: string,
  options: DownloadOptions = {},
): Promise<string[]> {
  return downloadModelsFiles(ids.map((id) => ({ model: spec(id), dir: join(modelsDir, id) })), options);
}

/** A file of a model, with the size and SHA-256 it has to have. */
export interface PinnedFile extends Digest {
  name: string;
}

/**
 * What a download does to make a directory hold some files of a model. A file already there with its pinned size is
 * in neither list.
 */
interface Plan {
  /** Files to symlink from a Hugging Face cache snapshot that has them at their pinned size, to `target`. */
  link: { target: string; from: string }[];
  /** Files to download: neither in the directory nor in any snapshot at their pinned size. */
  fetch: PinnedFile[];
  /** The pinned sizes of `fetch`, added up. */
  bytes: number;
}

/**
 * Decides whether each of `names`, files of `model`, is kept, linked or fetched to make `dir` hold it, by looking and
 * nothing more: a file in `dir` with its pinned size is kept, else a copy of that size in a Hugging Face cache snapshot
 * is linked, else it is fetched. Throws when `model` pins no digest for one of `names`.
 */
function planFiles(model: ModelSpec, names: readonly string[], dir: string): Plan {
  const snapshots = hfSnapshots(model.repo);
  const link: Plan["link"] = [];
  const fetch: PinnedFile[] = [];
  for (const name of names) {
    const file: PinnedFile = { name, ...digestOf(model, name) };
    const target = join(dir, name);
    if (fileSize(target) === file.size) continue;
    const from = snapshots.map((snapshot) => join(snapshot, name)).find((path) => fileSize(path) === file.size);
    if (from === undefined) fetch.push(file); // downloaded, then renamed over whatever is at `target`
    else link.push({ target, from });
  }
  return { link, fetch, bytes: fetch.reduce((sum, file) => sum + file.size, 0) };
}

/**
 * The bytes `downloadModels` would fetch for `ids` with `quantization`: the pinned sizes of the files that are neither
 * in `<modelsDir>/<id>/` nor in a Hugging Face cache snapshot at their pinned size. It only looks; nothing is written.
 */
export function downloadSize(ids: readonly string[], modelsDir: string, quantization = "int8"): number {
  return ids.reduce((sum, id) => sum + planFiles(spec(id), modelFiles(id, quantization), join(modelsDir, id)).bytes, 0);
}

/** Makes `dir` hold every file of `model` and returns it; `downloadModelsFiles` for one model. */
export async function downloadModelFiles(model: ModelSpec, dir: string, options: DownloadOptions = {}): Promise<string> {
  return (await downloadModelsFiles([{ model, dir }], options))[0]!;
}

/**
 * Makes each job's `dir` hold every file of its `model` for `options.quantization` and returns the dirs in the order
 * given: files already there with their pinned size are kept (one of another size, say a short one an older build left,
 * is replaced), files in a Hugging Face cache snapshot are symlinked when they have the pinned size (the cache is never
 * written to), the rest is downloaded from `<baseUrl>/<repo>/resolve/<revision>/<file>`, streamed to `<file>.part` and
 * renamed into place only when its size and SHA-256 are the pinned ones. Every job's cached files are linked before
 * any download starts, and then the jobs download one after the other, the one with the fewest bytes to fetch first
 * (jobs with as many keep the order given). `onProgress` counts over all jobs, and its `overallTotal` is the same in
 * every event.
 *
 * A download that stops keeps its `.part` and the next one continues from it (see `fetchFile`). When a download starts,
 * the `.part` files in the jobs' directories that it doesn't fetch are deleted: what is left of a file that is complete
 * or cached by now, or of one the quantization no longer needs. Run one download per models folder at a time: two would
 * write the same `.part` files. The caller guards that (Avanzel's controller starts none while one is downloading).
 *
 * Rejects with a `DownloadError` when a file can't be downloaded, which says whether a part of it was kept; with the
 * signal's own error when `options.signal` aborts, which keeps nothing.
 */
export async function downloadModelsFiles(
  jobs: readonly { model: ModelSpec; dir: string }[],
  options: DownloadOptions = {},
): Promise<string[]> {
  const { quantization = "int8", onProgress, signal, baseUrl = "https://huggingface.co" } = options;
  const plans = jobs.map(({ model, dir }) => ({
    model,
    dir,
    ...planFiles(model, quantizedFiles(model, quantization, model.repo), dir),
  }));

  for (const { dir, link } of plans) {
    mkdirSync(dir, { recursive: true });
    for (const { target, from } of link) {
      // What is at `target` goes first (symlinkSync never replaces it): a file of the wrong size, or a dangling link
      // from an earlier, since cleaned, cache. lstat sees the entry itself, a dangling link too (stat and existsSync
      // follow it and see nothing), and unlink removes just that entry, never what a link points to.
      if (lstatSync(target, { throwIfNoEntry: false })) unlinkSync(target);
      symlinkSync(from, target);
    }
  }

  clearStaleParts(plans);

  const overallTotal = plans.reduce((sum, plan) => sum + plan.bytes, 0);
  let fetched = 0; // the bytes of the files that are done, of every job so far
  // sort is stable, so jobs with as many bytes to fetch stay in the order given
  for (const { model, dir, fetch } of [...plans].sort((a, b) => a.bytes - b.bytes)) {
    for (const file of fetch) {
      const url = `${baseUrl}/${model.repo}/resolve/${model.revision}/${file.name}`;
      await fetchFile(file, url, join(dir, file.name), signal, (receivedBytes) => {
        const overallReceived = fetched + receivedBytes;
        onProgress?.({ file: file.name, receivedBytes, totalBytes: file.size, overallReceived, overallTotal });
      });
      fetched += file.size;
    }
  }
  return jobs.map(({ dir }) => dir);
}

function digestOf(model: ModelSpec, name: string): Digest {
  const digest = Object.hasOwn(model.digests, name) ? model.digests[name] : undefined;
  if (digest === undefined) throw new AvanzelError(`Cannot download ${name}: no size and SHA-256 are pinned for it.`);
  return digest;
}

/**
 * Deletes the `.part` files in the directories of `plans` that none of them fetches. The `.part` of a file that is
 * fetched stays, to be continued. A `.part` that can't be deleted stays too: it is no reason to fail a download, and the
 * next one clears it.
 */
function clearStaleParts(plans: readonly { dir: string; fetch: readonly PinnedFile[] }[]): void {
  const fetched = new Set(plans.flatMap(({ dir, fetch }) => fetch.map(({ name }) => join(dir, `${name}.part`))));
  for (const dir of new Set(plans.map((plan) => plan.dir))) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (!entry.name.endsWith(".part") || entry.isDirectory() || fetched.has(path)) continue;
      try {
        unlinkSync(path); // a link is removed itself, never what it points to
      } catch {
        // see above
      }
    }
  }
}

/** Feeds the first `length` bytes of the file at `path`, which must be more than none, to `hash`. */
async function hashInto(hash: Hash, path: string, length: number): Promise<void> {
  for await (const chunk of createReadStream(path, { end: length - 1, highWaterMark: 1 << 20 })) hash.update(chunk);
}

/** What arrived, or what was kept, can't be the file: it is deleted, and the next try starts from zero. */
class WrongBytes extends Error {}

/**
 * A size as a person reads it in a failure's reason: megabytes (a million bytes each) with one decimal, and never less than
 * 0.1, which a file too small for one decimal would otherwise read as. 2,327,524 bytes are "2.3".
 */
function megabytes(bytes: number): string {
  return Math.max(0.1, Math.round(bytes / 1e5) / 10).toFixed(1);
}

/**
 * What a failure's cause says, in words: its message; else, for an AggregateError, which has none of its own (undici throws
 * one when a host has several addresses, `localhost` as ::1 and 127.0.0.1 say, and each of them failed), the first of its
 * errors' that has one; else its code ("ECONNREFUSED"). Empty when it says nothing.
 */
function causeOf(cause: unknown): string {
  if (!(cause instanceof Error)) return "";
  if (cause.message) return cause.message;
  const { errors, code } = cause as { errors?: unknown; code?: unknown };
  const inner: unknown = Array.isArray(errors) ? errors.find((each) => each instanceof Error && each.message) : undefined;
  if (inner instanceof Error) return inner.message;
  return typeof code === "string" ? code : "";
}

/**
 * An error's message with its cause's, without the URL (`url` is the one asked for, which a message about a URL that can't
 * be parsed repeats): a person reads it, and a download's URL is long and says nothing. A host name or an ip:port that the
 * system names in its own words stays, since "getaddrinfo ENOTFOUND huggingface.co" is what says why. Never empty.
 */
function reasonOf(error: unknown, url: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? causeOf(error.cause) : "";
  const why = message && cause ? `${message} (${cause})` : message || cause || "no reason was given";
  return why.replaceAll(url, "the server").replace(/\bhttps?:\/\/[^\s)]+/gi, "the server");
}

/**
 * Downloads one pinned file from `url` to `target`, through `<target>.part`, which it renames into place only when it
 * has the pinned size and SHA-256. The `.part` an earlier try left decides where this one starts:
 * - longer than the file: it is no part of it, and is deleted;
 * - as long as the file: it is hashed here, never asked of the server (which would answer a range from its end with a
 *   416), and renamed into place when it matches, else deleted and fetched from zero;
 * - shorter: it is kept, and continued with a Range request. A 206 answers it, and the kept bytes are hashed before the
 *   new ones follow, so the SHA-256 is always of the whole file; a 200 (a server that ignores Range) sends the whole file,
 *   which replaces the part; a 416 deletes the part and asks again, for the whole file, which it can't answer so.
 *
 * A try that fails keeps its `.part` when it may be good, since all that arrived is the file's first bytes: a dropped
 * connection, a body that ended short, an HTTP error. It deletes the part when it can't be: more bytes than the file
 * has, or a wrong SHA-256. An abort keeps nothing. The `DownloadError` says which, as `resumable`.
 */
export async function fetchFile(
  { name, size, sha256 }: PinnedFile,
  url: string,
  target: string,
  signal: AbortSignal | undefined,
  progress: (receivedBytes: number) => void,
): Promise<void> {
  const part = `${target}.part`;
  try {
    let offset = fileSize(part) ?? 0;
    if (offset > size) {
      await rm(part, { force: true });
      offset = 0;
    } else if (offset > 0 && offset === size) {
      const hash = createHash("sha256");
      await hashInto(hash, part, size);
      if (hash.digest("hex") === sha256) {
        await rename(part, target);
        progress(size);
        return;
      }
      await rm(part, { force: true });
      offset = 0;
    }

    const get = (from: number) => fetch(url, { headers: from > 0 ? { ...HEADERS, range: `bytes=${from}-` } : HEADERS, signal });
    let response = await get(offset);
    if (offset > 0 && response.status === 416) {
      await response.body?.cancel();
      await rm(part, { force: true });
      offset = 0;
      response = await get(0);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`the server answered HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
    }

    // Only a 206 continues the part. Any other answer is the whole file, from its first byte.
    const hash = createHash("sha256");
    if (response.status === 206 && offset > 0) await hashInto(hash, part, offset);
    else offset = 0;
    let received = offset;
    const file = await open(part, offset > 0 ? "a" : "w");
    try {
      progress(received);
      // The digest runs over the chunks on their way into the file, and `pipeline` returns only once the file stream
      // has written every one of them (or failed), so it covers exactly what was written.
      await pipeline(
        response.body,
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            // Not a byte more than the file has goes to the disk, whatever the server keeps sending.
            if (received + chunk.length > size) throw new WrongBytes(`got more than the ${megabytes(size)} MB expected`);
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
    if (written > size) throw new WrongBytes(`got more than the ${megabytes(size)} MB expected`);
    if (written < size) throw new Error(written === 0 ? "nothing arrived" : `only ${megabytes(written)} of ${megabytes(size)} MB arrived`);
    if (hash.digest("hex") !== sha256) throw new WrongBytes("what arrived was damaged");
    await rename(part, target);
  } catch (error) {
    if (signal?.aborted) {
      await rm(part, { force: true });
      throw error;
    }
    if (error instanceof WrongBytes) await rm(part, { force: true });
    const kept = fileSize(part) ?? 0;
    if (kept === 0) await rm(part, { force: true }); // nothing arrived: not even an empty file is left to be called a part
    throw new DownloadError(`Could not download ${name}: ${reasonOf(error, url)}`, kept > 0);
  }
}
