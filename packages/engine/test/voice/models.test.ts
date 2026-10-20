import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { AvanzelError } from "../../src/types.ts";
import {
  type DownloadProgress,
  downloadModel,
  hfCacheDir,
  locateModel,
  MODELS,
  modelFiles,
  parakeetFileNames,
} from "../../src/voice/models.ts";
import { tempDir, useHfCache } from "./helpers.ts";

const V3 = "nemo-parakeet-tdt-0.6b-v3";
const V3_REPO = "istupakov/parakeet-tdt-0.6b-v3-onnx";
const INT8 = ["encoder-model.int8.onnx", "decoder_joint-model.int8.onnx", "vocab.txt", "config.json"];
const FULL = ["encoder-model.onnx", "encoder-model.onnx.data", "decoder_joint-model.onnx", "vocab.txt", "config.json"];

let hub: string;
beforeEach(() => {
  hub = useHfCache(); // every test gets its own empty Hugging Face cache
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

  it("lists the files for each quantization (the nemo128 preprocessor ships with the engine)", () => {
    expect(modelFiles(V3, "int8")).toEqual(INT8);
    expect(modelFiles(V3)).toEqual(INT8);
    expect(modelFiles("nemo-parakeet-tdt-0.6b-v2", "")).toEqual(FULL);
    expect(modelFiles("silero-vad")).toEqual(["silero_vad.onnx"]);
  });

  it("rejects unknown models and quantizations", () => {
    expect(() => modelFiles("whisper-base")).toThrow(AvanzelError);
    expect(() => modelFiles("constructor")).toThrow(AvanzelError);
    expect(() => modelFiles(V3, "fp16")).toThrow(/fp16/);
  });
});

describe("parakeetFileNames", () => {
  it("names the encoder and decoder files by quantization", () => {
    expect(parakeetFileNames("int8")).toEqual({ encoder: "encoder-model.int8.onnx", decoder: "decoder_joint-model.int8.onnx" });
    expect(parakeetFileNames("")).toEqual({ encoder: "encoder-model.onnx", decoder: "decoder_joint-model.onnx" });
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
    writeFiles(join(models, V3), Object.fromEntries(INT8.map((name) => [name, name])));
    hfSnapshot(V3_REPO, INT8);
    expect(locateModel(V3, models)).toBe(join(models, V3));
  });

  it("falls back to a complete Hugging Face cache snapshot", () => {
    const models = tempDir();
    writeFiles(join(models, V3), { "vocab.txt": "partial" });
    const snapshot = hfSnapshot(V3_REPO, INT8);
    expect(locateModel(V3, models)).toBe(snapshot);
  });

  it("prefers the snapshot refs/main names", () => {
    const models = tempDir();
    const aaaa = hfSnapshot(V3_REPO, INT8, "aaaa1111");
    const bbbb = hfSnapshot(V3_REPO, INT8, "bbbb2222"); // refs/main names the snapshot made last
    expect(locateModel(V3, models)).toBe(bbbb);
    writeFileSync(join(aaaa, "..", "..", "refs", "main"), "aaaa1111"); // <repo dir>/refs/main
    expect(locateModel(V3, models)).toBe(aaaa);
  });

  it("returns null when no copy has every file", () => {
    const models = tempDir();
    hfSnapshot(V3_REPO, INT8.filter((name) => name !== "config.json"));
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
    writeFiles(join(models, V3), Object.fromEntries(FULL.map((name) => [name, name])));
    expect(locateModel(V3, models, "")).toBe(join(models, V3));
  });

  it("finds Silero VAD in the Hugging Face cache", () => {
    const snapshot = hfSnapshot("istupakov/silero-vad-onnx", ["config.json", "silero_vad.onnx"]);
    expect(locateModel("silero-vad", tempDir())).toBe(snapshot);
  });
});

type Behaviour = { notFound?: string; truncate?: string; stall?: string };

/** A local stand-in for huggingface.co: serves `/<repo>/resolve/main/<file>` for `files` of `repo`. */
async function fakeHub(repo: string, files: Record<string, Buffer>, behaviour: Behaviour = {}) {
  const requests: string[] = [];
  const encodings = new Set<string | undefined>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push(`${req.method} ${req.url}`);
    encodings.add(req.headers["accept-encoding"]);
    const prefix = `/${repo}/resolve/main/`;
    const name = req.url!.startsWith(prefix) ? decodeURIComponent(req.url!.slice(prefix.length)) : "";
    const body = files[name];
    if (body === undefined || name === behaviour.notFound) {
      res.writeHead(404).end("Entry not found");
      return;
    }
    res.writeHead(200, { "content-length": body.length, "content-type": "application/octet-stream" });
    if (req.method === "HEAD") {
      res.end();
    } else if (name === behaviour.truncate) {
      res.write(body.subarray(0, body.length / 2));
      res.destroy();
    } else if (name === behaviour.stall) {
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

/** Parakeet v3's files in both quantizations, with random "weights". */
function v3Files(): Record<string, Buffer> {
  return {
    "encoder-model.int8.onnx": randomBytes(300_000),
    "decoder_joint-model.int8.onnx": randomBytes(70_000),
    "encoder-model.onnx": randomBytes(20_000),
    "encoder-model.onnx.data": randomBytes(200_000),
    "decoder_joint-model.onnx": randomBytes(30_000),
    "vocab.txt": Buffer.from("<unk> 0\n▁hi 1\n<blk> 2\n"),
    "config.json": Buffer.from('{"model_type": "nemo-conformer-tdt"}'),
  };
}

const get = (name: string) => `GET /${V3_REPO}/resolve/main/${name}`;

describe("downloadModel", () => {
  it("downloads every file into <modelsDir>/<id>/, reporting progress", async () => {
    const files = v3Files();
    const { baseUrl, requests, encodings } = await fakeHub(V3_REPO, files);
    const models = tempDir();
    const events: DownloadProgress[] = [];
    const dir = await downloadModel(V3, models, { baseUrl, onProgress: (p) => events.push({ ...p }) });

    expect(dir).toBe(join(models, V3));
    for (const name of INT8) expect(readFileSync(join(dir, name)).equals(files[name]!)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual([...INT8].sort()); // no .part leftovers
    expect(locateModel(V3, models)).toBe(dir);
    expect(requests.filter((r) => r.startsWith("GET")).sort()).toEqual(INT8.map(get).sort());
    // Hugging Face gzips text files and then omits their length; identity keeps sizes known.
    expect([...encodings]).toEqual(["identity"]);

    const total = INT8.reduce((sum, name) => sum + files[name]!.length, 0);
    expect(events.every((e) => e.overallTotal === total)).toBe(true);
    expect(events.at(-1)?.overallReceived).toBe(total);
    for (const name of INT8) {
      const size = files[name]!.length;
      expect(events.filter((e) => e.file === name).at(-1)).toMatchObject({ receivedBytes: size, totalBytes: size });
    }
    const overall = events.map((e) => e.overallReceived);
    expect(overall).toEqual([...overall].sort((a, b) => a - b));
    expect(events.filter((e) => e.file === "encoder-model.int8.onnx").length).toBeGreaterThan(1);
  });

  it("links what the Hugging Face cache has and downloads only the rest", async () => {
    // The cache holds the int8 model (what onnx-asr fetched); the owner switches to full precision.
    const files = v3Files();
    const { baseUrl, requests } = await fakeHub(V3_REPO, files);
    const snapshot = hfSnapshot(V3_REPO, INT8);
    const before = listTree(hub);
    const models = tempDir();

    const dir = await downloadModel(V3, models, { baseUrl, quantization: "" });

    expect(requests.filter((r) => r.startsWith("GET")).sort()).toEqual(
      ["encoder-model.onnx", "encoder-model.onnx.data", "decoder_joint-model.onnx"].map(get).sort(),
    );
    for (const name of ["vocab.txt", "config.json"]) {
      expect(lstatSync(join(dir, name)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(dir, name))).toBe(join(snapshot, name));
      expect(readFileSync(join(dir, name), "utf8")).toBe(`cached ${name}`);
    }
    expect(readFileSync(join(dir, "encoder-model.onnx.data")).equals(files["encoder-model.onnx.data"]!)).toBe(true);
    expect(listTree(hub)).toEqual(before); // nothing written into the HF cache
    expect(locateModel(V3, models, "")).toBe(dir);
  });

  it("keeps files that are already there", async () => {
    const { baseUrl, requests } = await fakeHub(V3_REPO, v3Files());
    const models = tempDir();
    writeFiles(join(models, V3), { "vocab.txt": "mine", "config.json": "{}" });
    await downloadModel(V3, models, { baseUrl });
    expect(readFileSync(join(models, V3, "vocab.txt"), "utf8")).toBe("mine");
    expect(requests.some((r) => r.endsWith("/vocab.txt") || r.endsWith("/config.json"))).toBe(false);
  });

  it("fails with an AvanzelError when a file is not found", async () => {
    const { baseUrl } = await fakeHub(V3_REPO, v3Files(), { notFound: "vocab.txt" });
    const download = downloadModel(V3, tempDir(), { baseUrl });
    await expect(download).rejects.toThrow(AvanzelError);
    await expect(download).rejects.toThrow(/vocab\.txt.*404/);
  });

  it("fails on a truncated download and leaves no partial file", async () => {
    const { baseUrl } = await fakeHub(V3_REPO, v3Files(), { truncate: "encoder-model.int8.onnx" });
    const models = tempDir();
    await expect(downloadModel(V3, models, { baseUrl })).rejects.toThrow(AvanzelError);
    expect(readdirSync(join(models, V3)).filter((name) => name.startsWith("encoder-model"))).toEqual([]);
  });

  it("stops when aborted and leaves no partial file", async () => {
    const { baseUrl } = await fakeHub(V3_REPO, v3Files(), { stall: "encoder-model.int8.onnx" });
    const models = tempDir();
    const controller = new AbortController();
    const download = downloadModel(V3, models, {
      baseUrl,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.file === "encoder-model.int8.onnx") controller.abort();
      },
    });
    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    const left = existsSync(join(models, V3)) ? readdirSync(join(models, V3)) : [];
    expect(left.filter((name) => name.startsWith("encoder-model"))).toEqual([]);
  });

  it("downloads Silero VAD from its own repo", async () => {
    const vad = randomBytes(10_000);
    const { baseUrl } = await fakeHub("istupakov/silero-vad-onnx", { "silero_vad.onnx": vad });
    const models = tempDir();
    const dir = await downloadModel("silero-vad", models, { baseUrl });
    expect(readFileSync(join(dir, "silero_vad.onnx")).equals(vad)).toBe(true);
    expect(locateModel("silero-vad", models)).toBe(dir);
  });

  it("rejects unknown models", async () => {
    await expect(downloadModel("whisper-base", tempDir())).rejects.toThrow(AvanzelError);
  });
});
