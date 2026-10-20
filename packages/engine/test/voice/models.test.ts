import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
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
  parakeetFileNames,
  VAD_MODEL,
} from "../../src/voice/models.ts";
import { pinnedSizeFiles, tempDir, useHfCache } from "./helpers.ts";

const V3 = "nemo-parakeet-tdt-0.6b-v3";
const V3_REPO = "istupakov/parakeet-tdt-0.6b-v3-onnx";
const REVISION = "0123456789abcdef0123456789abcdef01234567"; // what the test specs pin; no real commit
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

/**
 * A Hugging Face cache snapshot of `repo`, laid out like huggingface_hub does. `files` are names (each holding
 * "cached <name>") or names with the bytes to put in them.
 */
function hfSnapshot(repo: string, files: string[] | Record<string, string | Buffer>, revision = "0123abcd"): string {
  const bodies = Array.isArray(files) ? Object.fromEntries(files.map((name) => [name, `cached ${name}`])) : files;
  const base = join(hub, `models--${repo.replace("/", "--")}`);
  const snapshot = join(base, "snapshots", revision);
  mkdirSync(join(base, "blobs"), { recursive: true });
  mkdirSync(snapshot, { recursive: true });
  mkdirSync(join(base, "refs"), { recursive: true });
  writeFileSync(join(base, "refs", "main"), revision);
  for (const [name, body] of Object.entries(bodies)) {
    writeFileSync(join(base, "blobs", `${revision}-${name}`), body);
    symlinkSync(join("..", "..", "blobs", `${revision}-${name}`), join(snapshot, name));
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

  it("pins a revision, a size and a SHA-256 for every file it lists", () => {
    for (const [id, model] of Object.entries(MODELS)) {
      expect(model.revision, `${id} revision`).toMatch(/^[0-9a-f]{40}$/);
      for (const name of Object.values(model.files).flat()) {
        expect(model.digests[name]?.size, `${id} ${name} size`).toBeGreaterThan(0);
        expect(model.digests[name]?.sha256, `${id} ${name} sha256`).toMatch(/^[0-9a-f]{64}$/);
      }
    }
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
    pinnedSizeFiles(join(models, V3), V3, INT8);
    hfSnapshot(V3_REPO, INT8);
    expect(locateModel(V3, models)).toBe(join(models, V3));
  });

  it("does not take a copy in the app's models directory with a file of the wrong size, such as one an older build left short", () => {
    const models = tempDir();
    pinnedSizeFiles(join(models, V3), V3, INT8);
    writeFileSync(join(models, V3, "encoder-model.int8.onnx"), "only the start of it");
    expect(locateModel(V3, models)).toBeNull();
    // A Hugging Face cache snapshot still counts when every file is there, whatever its size.
    const snapshot = hfSnapshot(V3_REPO, INT8);
    expect(locateModel(V3, models)).toBe(snapshot);
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
    pinnedSizeFiles(join(models, V3), V3, INT8.slice(1));
    symlinkSync(join(models, "gone.onnx"), join(models, V3, INT8[0]!));
    expect(locateModel(V3, models)).toBeNull();
  });

  it("needs the full-precision files when quantization is empty", () => {
    const models = tempDir();
    pinnedSizeFiles(join(models, V3), V3, INT8);
    expect(locateModel(V3, models, "")).toBeNull();
    pinnedSizeFiles(join(models, V3), V3, FULL);
    expect(locateModel(V3, models, "")).toBe(join(models, V3));
  });

  it("finds Silero VAD in the Hugging Face cache", () => {
    const snapshot = hfSnapshot("istupakov/silero-vad-onnx", ["config.json", "silero_vad.onnx"]);
    expect(locateModel("silero-vad", tempDir())).toBe(snapshot);
  });
});

type Behaviour = { notFound?: string; truncate?: string; short?: string; stall?: string };

/**
 * A local stand-in for huggingface.co: serves `/<repo>/resolve/<revision>/<file>` for `files` and records every
 * request. `behaviour` names a file to answer 404, to cut the connection half way, to serve whole but only half as
 * long (`short`), or to stall after the first kilobyte.
 */
async function fakeHub(
  { repo, revision }: Pick<ModelSpec, "repo" | "revision">,
  files: Record<string, Buffer>,
  behaviour: Behaviour = {},
) {
  const requests: string[] = [];
  const encodings = new Set<string | undefined>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push(`${req.method} ${req.url}`);
    encodings.add(req.headers["accept-encoding"]);
    const prefix = `/${repo}/resolve/${revision}/`;
    const name = req.url!.startsWith(prefix) ? decodeURIComponent(req.url!.slice(prefix.length)) : "";
    const body = files[name];
    if (body === undefined || name === behaviour.notFound) {
      res.writeHead(404).end("Entry not found");
      return;
    }
    const half = body.subarray(0, body.length / 2);
    const sent = name === behaviour.short ? half : body;
    res.writeHead(200, { "content-length": sent.length, "content-type": "application/octet-stream" });
    if (name === behaviour.truncate) {
      res.write(half);
      res.destroy();
    } else if (name === behaviour.stall) {
      res.write(body.subarray(0, 1024)); // then hang until the client gives up
    } else {
      res.end(sent);
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

/** Parakeet v3's spec pinned to `files`, as MODELS pins the real ones: a made-up revision, each file's size and SHA-256. */
function pinnedSpec(files: Record<string, Buffer>): ModelSpec {
  const digests = Object.entries(files).map(([name, body]) => [
    name,
    { size: body.length, sha256: createHash("sha256").update(body).digest("hex") },
  ]);
  return { repo: V3_REPO, revision: REVISION, files: { int8: INT8, "": FULL }, digests: Object.fromEntries(digests) };
}

const get = (name: string) => `GET /${V3_REPO}/resolve/${REVISION}/${name}`;

describe("downloadModelFiles", () => {
  it("downloads every file from the pinned revision, reporting progress against the pinned sizes", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl, requests, encodings } = await fakeHub(model, files);
    const models = tempDir();
    const dir = join(models, V3);
    const events: DownloadProgress[] = [];
    expect(await downloadModelFiles(model, dir, { baseUrl, onProgress: (p) => events.push({ ...p }) })).toBe(dir);

    for (const name of INT8) expect(readFileSync(join(dir, name)).equals(files[name]!)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual([...INT8].sort()); // no .part leftovers
    // One GET per file at the pinned revision, and no HEAD requests to ask how long they are.
    expect(requests.sort()).toEqual(INT8.map(get).sort());
    // Asked for as they are: no content encoding between the server's bytes and their digest.
    expect([...encodings]).toEqual(["identity"]);

    const total = INT8.reduce((sum, name) => sum + files[name]!.length, 0);
    expect(events.every((e) => e.overallTotal === total)).toBe(true);
    expect(events.at(-1)).toMatchObject({ overallReceived: total, overallTotal: total });
    for (const name of INT8) {
      const size = files[name]!.length;
      expect(events.filter((e) => e.file === name).at(-1)).toMatchObject({ receivedBytes: size, totalBytes: size });
    }
    const overall = events.map((e) => e.overallReceived);
    expect(overall).toEqual([...overall].sort((a, b) => a - b));
    expect(events.filter((e) => e.file === "encoder-model.int8.onnx").length).toBeGreaterThan(1);
  });

  it("links what the Hugging Face cache has, downloading a cached file of the wrong size instead", async () => {
    // The cache holds the int8 model (what onnx-asr fetched), except that its config.json is not the pinned one;
    // the owner switches to full precision.
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl, requests } = await fakeHub(model, files);
    const snapshot = hfSnapshot(V3_REPO, {
      ...Object.fromEntries(INT8.map((name) => [name, files[name]!])),
      "config.json": Buffer.concat([files["config.json"]!, Buffer.from("\n")]),
    });
    const before = listTree(hub);
    const models = tempDir();
    const events: DownloadProgress[] = [];

    const dir = await downloadModelFiles(model, join(models, V3), {
      baseUrl,
      quantization: "",
      onProgress: (p) => events.push({ ...p }),
    });

    const downloaded = ["encoder-model.onnx", "encoder-model.onnx.data", "decoder_joint-model.onnx", "config.json"];
    expect(requests.sort()).toEqual(downloaded.map(get).sort());
    const total = downloaded.reduce((sum, name) => sum + files[name]!.length, 0); // what is linked is not counted
    expect(events.at(-1)).toMatchObject({ overallReceived: total, overallTotal: total });
    expect(lstatSync(join(dir, "vocab.txt")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(dir, "vocab.txt"))).toBe(join(snapshot, "vocab.txt"));
    expect(lstatSync(join(dir, "config.json")).isSymbolicLink()).toBe(false);
    for (const name of ["vocab.txt", "config.json", "encoder-model.onnx.data"]) {
      expect(readFileSync(join(dir, name)).equals(files[name]!)).toBe(true);
    }
    expect(listTree(hub)).toEqual(before); // nothing written into the HF cache
    for (const name of FULL) expect(statSync(join(dir, name)).size).toBe(files[name]!.length); // every file, at its pinned size
  });

  it("links the snapshot whose copy has the pinned size when another snapshot holds an outdated one", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl, requests } = await fakeHub(model, files);
    const current = hfSnapshot(V3_REPO, { "vocab.txt": files["vocab.txt"]! }, "aaaa1111");
    hfSnapshot(V3_REPO, { "vocab.txt": "an older vocab" }, "bbbb2222"); // refs/main names this one, so it is tried first
    const dir = join(tempDir(), V3);

    await downloadModelFiles(model, dir, { baseUrl });

    expect(readlinkSync(join(dir, "vocab.txt"))).toBe(join(current, "vocab.txt"));
    expect(requests.some((r) => r.endsWith("/vocab.txt"))).toBe(false);
  });

  it("replaces a dangling link left by a cache that was cleaned", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl, requests } = await fakeHub(model, files);
    const models = tempDir();
    const dir = join(models, V3);
    mkdirSync(dir);
    // An earlier run linked both into a cache that has since been cleaned out ...
    for (const name of ["vocab.txt", "config.json"]) symlinkSync(join(hub, "cleaned", name), join(dir, name));
    expect(locateModel(V3, models)).toBeNull();
    // ... and the cache has config.json again.
    const snapshot = hfSnapshot(V3_REPO, { "config.json": files["config.json"]! });

    await downloadModelFiles(model, dir, { baseUrl });

    expect(lstatSync(join(dir, "vocab.txt")).isSymbolicLink()).toBe(false); // downloaded over the link
    expect(readFileSync(join(dir, "vocab.txt")).equals(files["vocab.txt"]!)).toBe(true);
    expect(readlinkSync(join(dir, "config.json"))).toBe(join(snapshot, "config.json")); // linked afresh
    expect(requests.some((r) => r.endsWith("/config.json"))).toBe(false);
    for (const name of INT8) expect(statSync(join(dir, name)).size).toBe(files[name]!.length); // every file, at its pinned size
  });

  it('fetches the full-precision files when quantization is ""', async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl, requests } = await fakeHub(model, files);
    const dir = join(tempDir(), V3);
    const events: DownloadProgress[] = [];

    await downloadModelFiles(model, dir, { baseUrl, quantization: "", onProgress: (p) => events.push({ ...p }) });

    expect(requests.sort()).toEqual(modelFiles(V3, "").map(get).sort());
    expect(readdirSync(dir).sort()).toEqual([...FULL].sort());
    expect(events.at(-1)?.overallTotal).toBe(FULL.reduce((sum, name) => sum + files[name]!.length, 0));
  });

  it("keeps files that are already there with their pinned size, without reading them", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl, requests } = await fakeHub(model, files);
    const dir = join(tempDir(), V3);
    const mine = Buffer.alloc(files["vocab.txt"]!.length, "m"); // the pinned size; what is in it isn't checked
    writeFiles(dir, { "vocab.txt": mine, "config.json": files["config.json"]! });
    await downloadModelFiles(model, dir, { baseUrl });
    expect(readFileSync(join(dir, "vocab.txt")).equals(mine)).toBe(true);
    expect(requests.some((r) => r.endsWith("/vocab.txt") || r.endsWith("/config.json"))).toBe(false);
  });

  it("replaces a file of the wrong size, such as one an older build left short: downloaded, or linked from the cache", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl, requests } = await fakeHub(model, files);
    const dir = join(tempDir(), V3);
    writeFiles(dir, {
      ...Object.fromEntries(INT8.map((name) => [name, files[name]!])),
      "encoder-model.int8.onnx": files["encoder-model.int8.onnx"]!.subarray(0, 1000), // cut short
      "config.json": "{}",
    });
    const snapshot = hfSnapshot(V3_REPO, { "config.json": files["config.json"]! });

    await downloadModelFiles(model, dir, { baseUrl });

    expect(requests).toEqual([get("encoder-model.int8.onnx")]);
    expect(readFileSync(join(dir, "encoder-model.int8.onnx")).equals(files["encoder-model.int8.onnx"]!)).toBe(true);
    expect(readlinkSync(join(dir, "config.json"))).toBe(join(snapshot, "config.json"));
    expect(readdirSync(dir).sort()).toEqual([...INT8].sort()); // no .part leftovers
  });

  it("starts a file over when an earlier attempt left its .part behind", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl } = await fakeHub(model, files);
    const dir = join(tempDir(), V3);
    writeFiles(dir, { "encoder-model.int8.onnx.part": randomBytes(500_000) }); // longer than the file itself
    await downloadModelFiles(model, dir, { baseUrl });
    expect(readdirSync(dir).sort()).toEqual([...INT8].sort());
    expect(readFileSync(join(dir, "encoder-model.int8.onnx")).equals(files["encoder-model.int8.onnx"]!)).toBe(true);
  });

  it("fails with an AvanzelError when a file is not found", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl } = await fakeHub(model, files, { notFound: "vocab.txt" });
    const download = downloadModelFiles(model, join(tempDir(), V3), { baseUrl });
    await expect(download).rejects.toThrow(AvanzelError);
    await expect(download).rejects.toThrow(/vocab\.txt.*404/);
  });

  it("refuses a file whose SHA-256 doesn't match, leaving nothing behind", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const damaged = Buffer.from(files["encoder-model.int8.onnx"]!);
    damaged[1000] = damaged[1000]! ^ 0xff; // the same size, one byte different
    const { baseUrl } = await fakeHub(model, { ...files, "encoder-model.int8.onnx": damaged });
    const dir = join(tempDir(), V3);

    const download = downloadModelFiles(model, dir, { baseUrl });

    await expect(download).rejects.toThrow(AvanzelError);
    await expect(download).rejects.toThrow(/encoder-model\.int8\.onnx.*try again$/);
    expect(readdirSync(dir)).toEqual([]); // neither the file nor its .part
  });

  it("refuses a short download, leaving nothing behind", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl } = await fakeHub(model, files, { short: "encoder-model.int8.onnx" });
    const dir = join(tempDir(), V3);

    await expect(downloadModelFiles(model, dir, { baseUrl })).rejects.toThrow(
      /encoder-model\.int8\.onnx.*got 150000 of 300000 bytes; try again$/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it("fails when the connection drops half way and leaves no partial file", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl } = await fakeHub(model, files, { truncate: "encoder-model.int8.onnx" });
    const dir = join(tempDir(), V3);
    await expect(downloadModelFiles(model, dir, { baseUrl })).rejects.toThrow(AvanzelError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("stops when aborted and leaves no partial file", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const { baseUrl } = await fakeHub(model, files, { stall: "encoder-model.int8.onnx" });
    const dir = join(tempDir(), V3);
    const controller = new AbortController();
    const download = downloadModelFiles(model, dir, {
      baseUrl,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.file === "encoder-model.int8.onnx") controller.abort();
      },
    });
    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("downloads nothing for a spec that pins no digest for a file it lists", async () => {
    const files = v3Files();
    const model = pinnedSpec(files);
    const digests = Object.entries(model.digests).filter(([name]) => name !== "vocab.txt");
    const { baseUrl, requests } = await fakeHub(model, files);
    const download = downloadModelFiles({ ...model, digests: Object.fromEntries(digests) }, join(tempDir(), V3), { baseUrl });
    await expect(download).rejects.toThrow(/vocab\.txt/);
    expect(requests).toEqual([]);
  });
});

describe("downloadModel", () => {
  it("asks for the pinned revision of a real model", async () => {
    const pin = { repo: "istupakov/silero-vad-onnx", revision: "b3e3ee3cce4c11ceb63b1a0b229d916069c1ddf6" };
    const { baseUrl, requests } = await fakeHub(pin, { "silero_vad.onnx": randomBytes(10_000) }); // not the real bytes
    const models = tempDir();

    await expect(downloadModel(VAD_MODEL, models, { baseUrl })).rejects.toThrow(/silero_vad\.onnx.*try again$/);

    expect(requests).toEqual([`GET /${pin.repo}/resolve/${pin.revision}/silero_vad.onnx`]);
    expect(readdirSync(join(models, VAD_MODEL))).toEqual([]); // the wrong bytes were not kept
  });

  it("keeps a model's files in <modelsDir>/<id>/", async () => {
    const { baseUrl, requests } = await fakeHub(MODELS[VAD_MODEL]!, {});
    const models = tempDir();
    pinnedSizeFiles(join(models, VAD_MODEL), VAD_MODEL, ["silero_vad.onnx"]);
    expect(locateModel(VAD_MODEL, models)).toBe(join(models, VAD_MODEL)); // complete by the same rule
    expect(await downloadModel(VAD_MODEL, models, { baseUrl })).toBe(join(models, VAD_MODEL));
    expect(requests).toEqual([]);
  });

  it("rejects unknown models and quantizations", async () => {
    await expect(downloadModel("whisper-base", tempDir())).rejects.toThrow(AvanzelError);
    await expect(downloadModel(V3, tempDir(), { quantization: "fp16" })).rejects.toThrow(/fp16/);
  });
});
