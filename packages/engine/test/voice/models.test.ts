import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { AvanzelError } from "../../src/types.ts";
import {
  type DownloadProgress,
  downloadModel,
  downloadModelFiles,
  hfCacheDir,
  locateModel,
  MODELS,
  type ModelSpec,
  modelFiles,
  unzipEntry,
} from "../../src/voice/models.ts";
import { tempDir, zipBytes } from "./helpers.ts";

const V3 = "nemo-parakeet-tdt-0.6b-v3";
const V3_REPO = "istupakov/parakeet-tdt-0.6b-v3-onnx";
const INT8 = ["encoder-model.int8.onnx", "decoder_joint-model.int8.onnx", "vocab.txt", "config.json", "nemo128.onnx"];
const REPO_FILES = INT8.filter((name) => name !== "nemo128.onnx");
const WHEEL_ENTRY = "onnx_asr/preprocessors/data/nemo128.onnx";

let hub: string;
beforeEach(() => {
  // Every test gets its own empty Hugging Face cache; the real one is never touched.
  hub = mkdtempSync(join(tmpdir(), "avanzel-voice-hub-"));
  const saved = { HF_HUB_CACHE: process.env.HF_HUB_CACHE, HF_HOME: process.env.HF_HOME };
  process.env.HF_HUB_CACHE = hub;
  delete process.env.HF_HOME;
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(hub, { recursive: true, force: true });
  };
});

function writeFiles(dir: string, files: Record<string, string | Buffer>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
}

/** A Hugging Face cache snapshot of `repo` holding `files`, laid out like huggingface_hub does. */
function hfSnapshot(repo: string, files: string[], revision = "0123abcd"): string {
  const base = join(hub, `models--${repo.replace("/", "--")}`);
  const snapshot = join(base, "snapshots", revision);
  mkdirSync(join(base, "blobs"), { recursive: true });
  mkdirSync(snapshot, { recursive: true });
  mkdirSync(join(base, "refs"), { recursive: true });
  writeFileSync(join(base, "refs", "main"), revision);
  for (const name of files) {
    writeFileSync(join(base, "blobs", `blob-${name}`), `cached ${name}`);
    symlinkSync(join("..", "..", "blobs", `blob-${name}`), join(snapshot, name));
  }
  return snapshot;
}

function listTree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
}

describe("MODELS", () => {
  it("knows Parakeet v3, v2 and Silero VAD with their Hugging Face repos", () => {
    expect(MODELS[V3]?.repo).toBe(V3_REPO);
    expect(MODELS["nemo-parakeet-tdt-0.6b-v2"]?.repo).toBe("istupakov/parakeet-tdt-0.6b-v2-onnx");
    expect(MODELS["silero-vad"]?.repo).toBe("istupakov/silero-vad-onnx");
  });

  it("takes nemo128.onnx from the onnx-asr 0.12.0 wheel, not the older copy in the Parakeet repos", () => {
    for (const id of [V3, "nemo-parakeet-tdt-0.6b-v2"]) {
      expect(MODELS[id]?.archived?.["nemo128.onnx"]).toEqual({
        url: expect.stringMatching(/^https:\/\/files\.pythonhosted\.org\/packages\/.+\/onnx_asr-0\.12\.0-py3-none-any\.whl$/),
        entry: WHEEL_ENTRY,
      });
    }
  });

  it("lists the files for each quantization", () => {
    expect(modelFiles(V3, "int8")).toEqual(INT8);
    expect(modelFiles(V3)).toEqual(INT8);
    expect(modelFiles("nemo-parakeet-tdt-0.6b-v2", "")).toEqual([
      "encoder-model.onnx",
      "encoder-model.onnx.data",
      "decoder_joint-model.onnx",
      "vocab.txt",
      "config.json",
      "nemo128.onnx",
    ]);
    expect(modelFiles("silero-vad")).toEqual(["silero_vad.onnx"]);
  });

  it("rejects unknown models and quantizations", () => {
    expect(() => modelFiles("whisper-base")).toThrow(AvanzelError);
    expect(() => modelFiles("constructor")).toThrow(AvanzelError);
    expect(() => modelFiles(V3, "fp16")).toThrow(/fp16/);
  });
});

describe("unzipEntry", () => {
  const body = Buffer.from("preprocessor bytes ".repeat(100));

  it("extracts deflated and stored entries", () => {
    const deflated = zipBytes({ "a/readme.txt": Buffer.from("hi"), [WHEEL_ENTRY]: body });
    expect(unzipEntry(deflated, WHEEL_ENTRY).equals(body)).toBe(true);
    expect(unzipEntry(zipBytes({ [WHEEL_ENTRY]: body }, { stored: true }), WHEEL_ENTRY).equals(body)).toBe(true);
  });

  it("reports a missing entry or a file that is not a zip", () => {
    expect(() => unzipEntry(zipBytes({ "other.txt": body }), WHEEL_ENTRY)).toThrow(/not in the archive/);
    expect(() => unzipEntry(Buffer.from("<html>not a wheel</html>"), WHEEL_ENTRY)).toThrow(AvanzelError);
  });
});

describe("hfCacheDir", () => {
  it("follows HF_HUB_CACHE, then HF_HOME, then ~/.cache/huggingface/hub", () => {
    expect(hfCacheDir({ HF_HUB_CACHE: "/x/hub", HF_HOME: "/y" })).toBe("/x/hub");
    expect(hfCacheDir({ HF_HOME: "/y" })).toBe("/y/hub");
    expect(hfCacheDir({})).toBe(join(homedir(), ".cache", "huggingface", "hub"));
  });
});

describe("locateModel", () => {
  it("prefers a complete copy in the app's models directory", () => {
    const models = tempDir();
    writeFiles(join(models, "silero-vad"), { "silero_vad.onnx": "vad" });
    hfSnapshot("istupakov/silero-vad-onnx", ["silero_vad.onnx"]);
    expect(locateModel("silero-vad", models)).toBe(join(models, "silero-vad"));
    writeFiles(join(models, V3), Object.fromEntries(INT8.map((name) => [name, name])));
    expect(locateModel(V3, models)).toBe(join(models, V3));
  });

  it("falls back to a complete Hugging Face cache snapshot", () => {
    const models = tempDir();
    writeFiles(join(models, "silero-vad"), { "config.json": "{}" });
    const snapshot = hfSnapshot("istupakov/silero-vad-onnx", ["config.json", "silero_vad.onnx"]);
    expect(locateModel("silero-vad", models)).toBe(snapshot);
  });

  it("never takes nemo128.onnx from a Hugging Face snapshot (the repos hold an older version)", () => {
    hfSnapshot(V3_REPO, INT8);
    expect(locateModel(V3, tempDir())).toBeNull();
  });

  it("returns null when no copy has every file", () => {
    const models = tempDir();
    writeFiles(join(models, V3), Object.fromEntries(REPO_FILES.map((name) => [name, name])));
    expect(locateModel(V3, models)).toBeNull();
    expect(locateModel(V3, join(models, "does-not-exist"))).toBeNull();
  });

  it("does not count dangling symlinks", () => {
    const models = tempDir();
    writeFiles(join(models, V3), Object.fromEntries(INT8.slice(1).map((name) => [name, name])));
    symlinkSync(join(models, "gone.onnx"), join(models, V3, INT8[0]!));
    expect(locateModel(V3, models)).toBeNull();
  });

  it("needs the full-precision files when quantization is empty", () => {
    const models = tempDir();
    writeFiles(join(models, V3), Object.fromEntries(INT8.map((name) => [name, name])));
    expect(locateModel(V3, models, "")).toBeNull();
    writeFiles(join(models, V3), Object.fromEntries(modelFiles(V3, "").map((name) => [name, name])));
    expect(locateModel(V3, models, "")).toBe(join(models, V3));
  });
});

type Behaviour = { notFound?: string; truncate?: string; stall?: string };

/** A local stand-in for huggingface.co and PyPI: serves `routes` (URL path → body). */
async function fakeServer(routes: Record<string, Buffer>, behaviour: Behaviour = {}) {
  const requests: string[] = [];
  const encodings = new Set<string | undefined>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push(`${req.method} ${req.url}`);
    encodings.add(req.headers["accept-encoding"]);
    const path = req.url!;
    const body = routes[path];
    if (body === undefined || path === behaviour.notFound) {
      res.writeHead(404).end("Entry not found");
      return;
    }
    res.writeHead(200, { "content-length": body.length, "content-type": "application/octet-stream" });
    if (req.method === "HEAD") {
      res.end();
    } else if (path === behaviour.truncate) {
      res.write(body.subarray(0, body.length / 2));
      res.destroy();
    } else if (path === behaviour.stall) {
      res.write(body.subarray(0, 1024)); // then hang until the client gives up
    } else {
      res.end(body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, requests, encodings };
}

const repoPath = (name: string) => `/${V3_REPO}/resolve/main/${name}`;
const WHEEL_PATH = "/packages/onnx_asr-0.12.0-py3-none-any.whl";

/** Parakeet-shaped model files on a fake server: repo files on "Hugging Face", nemo128.onnx inside a "wheel". */
async function fakeParakeet(behaviour: Behaviour = {}) {
  const files: Record<string, Buffer> = {
    "encoder-model.int8.onnx": randomBytes(300_000),
    "decoder_joint-model.int8.onnx": randomBytes(70_000),
    "vocab.txt": Buffer.from("<unk> 0\n▁hi 1\n<blk> 2\n"),
    "config.json": Buffer.from('{"model_type": "nemo-conformer-tdt"}'),
    "nemo128.onnx": randomBytes(5_000),
  };
  const wheel = zipBytes({ "onnx_asr/__init__.py": Buffer.from(""), [WHEEL_ENTRY]: files["nemo128.onnx"]! });
  const routes: Record<string, Buffer> = { [WHEEL_PATH]: wheel };
  for (const name of REPO_FILES) routes[repoPath(name)] = files[name]!;
  const server = await fakeServer(routes, behaviour);
  const spec: ModelSpec = {
    repo: V3_REPO,
    files: { int8: INT8 },
    archived: { "nemo128.onnx": { url: `${server.baseUrl}${WHEEL_PATH}`, entry: WHEEL_ENTRY } },
  };
  return { ...server, files, wheel, spec };
}

describe("downloadModelFiles", () => {
  it("downloads every file into the directory, reporting progress", async () => {
    const { baseUrl, requests, encodings, files, wheel, spec } = await fakeParakeet();
    const dir = join(tempDir(), V3);
    const events: DownloadProgress[] = [];
    expect(await downloadModelFiles(spec, dir, { baseUrl, onProgress: (p) => events.push({ ...p }) })).toBe(dir);

    for (const [name, body] of Object.entries(files)) expect(readFileSync(join(dir, name)).equals(body)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual([...INT8].sort()); // no .part leftovers
    expect(requests.filter((r) => r.startsWith("GET")).sort()).toEqual(
      [...REPO_FILES.map((name) => `GET ${repoPath(name)}`), `GET ${WHEEL_PATH}`].sort(),
    );
    // Hugging Face gzips text files and then omits their length; identity keeps sizes known.
    expect([...encodings]).toEqual(["identity"]);

    const sizes: Record<string, number> = Object.fromEntries(REPO_FILES.map((name) => [name, files[name]!.length]));
    sizes["nemo128.onnx"] = wheel.length; // progress counts the bytes actually downloaded
    const total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
    expect(events.every((e) => e.overallTotal === total)).toBe(true);
    expect(events.at(-1)?.overallReceived).toBe(total);
    for (const [name, size] of Object.entries(sizes)) {
      expect(events.filter((e) => e.file === name).at(-1)).toMatchObject({ receivedBytes: size, totalBytes: size });
    }
    const overall = events.map((e) => e.overallReceived);
    expect(overall).toEqual([...overall].sort((a, b) => a - b));
    expect(events.filter((e) => e.file === "encoder-model.int8.onnx").length).toBeGreaterThan(1);
  });

  it("links the big files from the Hugging Face cache and downloads only what is missing", async () => {
    const { baseUrl, requests, files, spec } = await fakeParakeet();
    const snapshot = hfSnapshot(V3_REPO, INT8); // including the repos' older nemo128.onnx
    const before = listTree(hub);
    const dir = join(tempDir(), V3);

    await downloadModelFiles(spec, dir, { baseUrl });

    expect(requests.filter((r) => r.startsWith("GET"))).toEqual([`GET ${WHEEL_PATH}`]);
    expect(readFileSync(join(dir, "nemo128.onnx")).equals(files["nemo128.onnx"]!)).toBe(true);
    for (const name of REPO_FILES) {
      expect(lstatSync(join(dir, name)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(dir, name))).toBe(join(snapshot, name));
      expect(readFileSync(join(dir, name), "utf8")).toBe(`cached ${name}`);
    }
    expect(listTree(hub)).toEqual(before); // nothing written into the HF cache
  });

  it("keeps files that are already there", async () => {
    const { baseUrl, requests, spec } = await fakeParakeet();
    const dir = join(tempDir(), V3);
    writeFiles(dir, { "vocab.txt": "mine", "nemo128.onnx": "mine too" });
    await downloadModelFiles(spec, dir, { baseUrl });
    expect(readFileSync(join(dir, "vocab.txt"), "utf8")).toBe("mine");
    expect(requests.some((r) => r.endsWith("/vocab.txt") || r.endsWith(".whl"))).toBe(false);
  });

  it("fails with an AvanzelError when a file is not found", async () => {
    const { baseUrl, spec } = await fakeParakeet({ notFound: repoPath("vocab.txt") });
    const download = downloadModelFiles(spec, join(tempDir(), V3), { baseUrl });
    await expect(download).rejects.toThrow(AvanzelError);
    await expect(download).rejects.toThrow(/vocab\.txt.*404/);
  });

  it("fails when the archive lacks the file and leaves nothing behind", async () => {
    const { baseUrl, spec } = await fakeParakeet();
    const { url } = spec.archived!["nemo128.onnx"]!;
    const wrongEntry: ModelSpec = { ...spec, archived: { "nemo128.onnx": { url, entry: "onnx_asr/preprocessors/data/nemo80.onnx" } } };
    const dir = join(tempDir(), V3);
    await expect(downloadModelFiles(wrongEntry, dir, { baseUrl })).rejects.toThrow(/nemo128\.onnx.*not in the archive/);
    expect(readdirSync(dir).filter((name) => name.startsWith("nemo128"))).toEqual([]);
  });

  it("fails on a truncated download and leaves no partial file", async () => {
    const { baseUrl, spec } = await fakeParakeet({ truncate: repoPath("encoder-model.int8.onnx") });
    const dir = join(tempDir(), V3);
    await expect(downloadModelFiles(spec, dir, { baseUrl })).rejects.toThrow(AvanzelError);
    expect(readdirSync(dir).filter((name) => name.startsWith("encoder-model"))).toEqual([]);
  });

  it("stops when aborted and leaves no partial file", async () => {
    const { baseUrl, spec } = await fakeParakeet({ stall: repoPath("encoder-model.int8.onnx") });
    const dir = join(tempDir(), V3);
    const controller = new AbortController();
    const download = downloadModelFiles(spec, dir, {
      baseUrl,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.file === "encoder-model.int8.onnx") controller.abort();
      },
    });
    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    const left = existsSync(dir) ? readdirSync(dir) : [];
    expect(left.filter((name) => name.startsWith("encoder-model"))).toEqual([]);
  });
});

describe("downloadModel", () => {
  it("fills <modelsDir>/<id>/ from the model's Hugging Face repo", async () => {
    const vad = randomBytes(10_000);
    const { baseUrl } = await fakeServer({ "/istupakov/silero-vad-onnx/resolve/main/silero_vad.onnx": vad });
    const models = tempDir();
    const dir = await downloadModel("silero-vad", models, { baseUrl });
    expect(dir).toBe(join(models, "silero-vad"));
    expect(readFileSync(join(dir, "silero_vad.onnx")).equals(vad)).toBe(true);
    expect(locateModel("silero-vad", models)).toBe(dir);
  });

  it("rejects unknown models", async () => {
    await expect(downloadModel("whisper-base", tempDir())).rejects.toThrow(AvanzelError);
  });
});
