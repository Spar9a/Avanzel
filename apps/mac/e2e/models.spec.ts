// The speech models: which ones the app waits for, and when it fetches them. Every test gets an empty Hugging Face
// cache (this Mac's own copies stay out of it) and a fakeModelHub in place of huggingface.co.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, MODELS, saveSettings } from "../../../packages/engine/src/index.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { call, closeModelHubs, emptyHfCache, fakeModelHub, hfSnapshot, launch, makeLibrary, windowFor } from "./helpers.ts";

const PARAKEET = "nemo-parakeet-tdt-0.6b-v3";
const SILERO = "silero-vad";

/** The pinned sizes of model `id`'s int8 files, added up. */
const pinnedSize = (id: string) => MODELS[id]!.files.int8!.reduce((sum, name) => sum + MODELS[id]!.digests[name]!.size, 0);
/** Both speech models, as a clean Mac downloads them. */
const total = pinnedSize(PARAKEET) + pinnedSize(SILERO);

const modelStatus = async (app: ElectronApplication) => ((await call(app, "snapshot")) as SettingsSnapshot).model;

test.afterEach(closeModelHubs);

test("with a library, both speech models start downloading at launch, the small one first", async () => {
  const hub = await fakeModelHub("stall");
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  await expect.poll(() => modelStatus(app)).toMatchObject({ kind: "downloading", totalBytes: total });
  await expect.poll(() => hub.requests[0]).toContain("silero-vad-onnx");
  await app.close();
});

test("without a library nothing downloads, and Settings offers the download with its size", async () => {
  const hub = await fakeModelHub("stall");
  const app = await launch({ AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  expect(await modelStatus(app)).toEqual({ kind: "missing", bytes: total });
  const settings = await windowFor(app, "settings");
  await settings.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Download (673 MB)" })).toBeVisible();
  expect(hub.requests).toEqual([]);
  await app.close();
});

test("creating a library starts the download", async () => {
  const hub = await fakeModelHub("stall");
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the library is remembered here, not in ~/.config
  const app = await launch({ AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache(), XDG_CONFIG_HOME: config });
  expect((await modelStatus(app)).kind).toBe("missing");
  const library = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel");
  await call(app, "createLibrary", library);
  await expect.poll(() => modelStatus(app)).toMatchObject({ kind: "downloading", totalBytes: total });
  await app.close();
});

test("a cached Parakeet leaves only Silero to fetch", async () => {
  const cache = emptyHfCache();
  hfSnapshot(cache, PARAKEET);
  const hub = await fakeModelHub("stall");
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: cache });
  await expect.poll(() => modelStatus(app)).toMatchObject({ kind: "downloading", totalBytes: 2_327_524 });
  expect(hub.requests).not.toEqual([]);
  expect(hub.requests.filter((request) => !request.endsWith("/silero_vad.onnx"))).toEqual([]);
  await app.close();
});

test("a command backend needs no models", async () => {
  const hub = await fakeModelHub("stall");
  const library = await makeLibrary();
  const voice = { backend: "command", model: "", quantization: "", command: ["true"], maxRecordSeconds: 600 };
  saveSettings(library, { ...loadSettings(library), voice });
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  expect((await modelStatus(app)).kind).toBe("ready");
  expect(hub.requests).toEqual([]);
  await app.close();
});
