// The speech models: which ones the app waits for, when it fetches them, and what the shortcut shows until they are
// here. Every test gets an empty Hugging Face cache (this Mac's own copies stay out of it) and a fakeModelHub in place
// of huggingface.co.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, MODELS, saveSettings } from "../../../packages/engine/src/index.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { call, capsuleKind, closeModelHubs, emptyHfCache, fakeModelHub, hfSnapshot, launch, makeLibrary, snap, windowFor } from "./helpers.ts";

const PARAKEET = "nemo-parakeet-tdt-0.6b-v3";
const SILERO = "silero-vad";

/** The pinned sizes of model `id`'s int8 files, added up. */
const pinnedSize = (id: string) => MODELS[id]!.files.int8!.reduce((sum, name) => sum + MODELS[id]!.digests[name]!.size, 0);
/** Both speech models, as a clean Mac downloads them. */
const total = pinnedSize(PARAKEET) + pinnedSize(SILERO);

const modelStatus = async (app: ElectronApplication) => ((await call(app, "snapshot")) as SettingsSnapshot).model;

/** Whether the window of renderer `name` (say "quick") is on screen. */
const shown = (app: ElectronApplication, name: string) =>
  app.evaluate(({ BrowserWindow }, page) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes(`/renderer/${page}/`) && w.isVisible()), name);

test.afterEach(closeModelHubs);

test("with a library, both speech models start downloading at launch, the small one first", async () => {
  const hub = await fakeModelHub("stall");
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  await call(app, "snapshot"); // the app has started: the poll's 5 s count from here, not from launch
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
  await call(app, "snapshot"); // the app has started: the poll's 5 s count from here, not from launch
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

test("pressing the shortcut while the models download shows progress, and Type instead opens Quick", async () => {
  const hub = await fakeModelHub("stall");
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  await call(app, "snapshot"); // the app has started: the poll's 5 s count from here, not from launch
  await expect.poll(async () => (await modelStatus(app)).kind).toBe("downloading");
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect(capsule.getByRole("progressbar", { name: "Downloading the speech model" })).toBeVisible();
  await expect(capsule.getByText("The speech model is still downloading")).toBeVisible();
  // The hub sends 64 KB and holds on; the total is known before the first byte.
  await expect(capsule.getByText("0 of 673 MB. Typing works now.")).toBeVisible();
  await snap(capsule, "capsule-preparing");
  await capsule.getByRole("button", { name: "Type instead" }).click();
  await expect.poll(() => shown(app, "quick")).toBe(true);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("a failed download waits quietly, then offers Try again", async () => {
  const hub = await fakeModelHub("missing");
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  await call(app, "snapshot"); // the app has started: the poll's 5 s count from here, not from launch
  await expect.poll(async () => (await modelStatus(app)).kind).toBe("error");
  expect(await capsuleKind(app)).toBe("hidden");
  const asked = hub.requests.length;
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect(capsule.getByText("The speech model didn't finish downloading.")).toBeVisible();
  expect(hub.requests.length).toBe(asked); // the shortcut says what happened; only Try again fetches
  await snap(capsule, "capsule-model-failed");
  await capsule.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => hub.requests.length).toBeGreaterThan(asked);
  await expect.poll(() => capsuleKind(app)).toBe("model-failed");
  await expect(capsule.getByText("The speech model didn't finish downloading.")).toBeVisible();
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await settings.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Try again" })).toBeVisible();
  await app.close();
});

test("voice settings Avanzel can't use are named at the shortcut, and nothing downloads", async () => {
  const hub = await fakeModelHub("stall");
  const library = await makeLibrary();
  const config = loadSettings(library);
  saveSettings(library, { ...config, voice: { ...config.voice, model: "parakeet-v9" } });
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  expect(await modelStatus(app)).toMatchObject({ kind: "error", cause: "settings" });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect(capsule.getByText("Avanzel can't use these voice settings")).toBeVisible();
  await expect(capsule.getByText(/Speech model 'parakeet-v9' is not supported/)).toBeVisible();
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await settings.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(settings.getByText(/Speech model 'parakeet-v9' is not supported/)).toBeVisible();
  await expect(settings.getByRole("button", { name: "Try again" })).toHaveCount(0); // trying again can't help
  expect(hub.requests).toEqual([]);
  await app.close();
});
