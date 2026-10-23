// The speech models: which ones the app waits for, when it fetches them, and what the shortcut shows until they are
// here. Every test gets an empty Hugging Face cache (this Mac's own copies stay out of it) and a fakeModelHub in place
// of huggingface.co.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, MODELS, saveSettings } from "../../../packages/engine/src/index.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { call, capsuleKind, closeModelHubs, emptyHfCache, fakeModelHub, hfSnapshot, launch, makeLibrary, openSettings, shown, snap, windowFor } from "./helpers.ts";

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
  await call(app, "snapshot"); // the app has started: the poll's 5 s count from here, not from launch
  await expect.poll(() => modelStatus(app)).toMatchObject({ kind: "downloading", totalBytes: total });
  await expect.poll(() => hub.requests[0]).toContain("silero-vad-onnx");
  await app.close();
});

test("without a library nothing downloads, and Settings offers the download with its size", async () => {
  const hub = await fakeModelHub("stall");
  const app = await launch({ AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  expect(await modelStatus(app)).toEqual({ kind: "missing", bytes: total });
  await call(app, "showSettings"); // without a library, setup opens by itself, not Settings
  const settings = await windowFor(app, "settings");
  await settings.getByRole("radio", { name: "Voice", exact: true }).click();
  const download = settings.getByRole("button", { name: "Download (673 MB)" });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute("data-variant", "secondary");
  expect(hub.requests).toEqual([]);
  // Download starts it, and the row turns to the progress, which the stalled hub holds at 0 of 673 MB.
  await download.click();
  await expect.poll(() => modelStatus(app)).toMatchObject({ kind: "downloading", totalBytes: total });
  await expect(settings.getByRole("progressbar", { name: "Downloading the speech model" })).toBeVisible();
  await expect(settings.getByText("0 of 673 MB", { exact: true })).toBeVisible();
  await expect(download).toHaveCount(0);
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

test("Settings → Voice says Ready once both speech models are on this Mac, and offers nothing to fetch", async () => {
  const cache = emptyHfCache();
  hfSnapshot(cache, PARAKEET);
  hfSnapshot(cache, SILERO);
  const hub = await fakeModelHub("stall");
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: cache });
  expect((await modelStatus(app)).kind).toBe("ready");
  const settings = await openSettings(app, "Voice");
  await expect(settings.getByText("Ready", { exact: true })).toBeVisible();
  // The row says which languages it hears, and names no model.
  await expect(
    settings.getByText("Turns your voice into text on this Mac, in 25 European languages including English, Ukrainian and Russian. Nothing is sent anywhere.", { exact: true }),
  ).toBeVisible();
  await expect(settings.getByRole("button", { name: /^Download|^Try again/ })).toHaveCount(0);
  await expect(settings.getByRole("progressbar")).toHaveCount(0);
  await expect(settings.getByRole("alert")).toHaveCount(0);
  expect(hub.requests).toEqual([]);
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
  // The card stays up while the test reads it; it hides by itself after 8 s otherwise.
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache(), AVANZEL_PREPARING_SHOW_MS: "120000" });
  await call(app, "snapshot"); // the app has started: the poll's 5 s count from here, not from launch
  await expect.poll(async () => (await modelStatus(app)).kind).toBe("downloading");
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect(capsule.getByRole("progressbar", { name: "Downloading the speech model" })).toBeVisible();
  // The headline is the card's only live region, so VoiceOver hears the start once, not each step of the progress.
  await expect(capsule.getByRole("status")).toHaveText("The speech model is still downloading");
  await expect(capsule.getByRole("alert")).toHaveCount(0);
  // The hub sends 64 KB and holds on; the total is known before the first byte.
  await expect(capsule.getByText("0 of 673 MB. Typing works now.")).toBeVisible();
  await expect(capsule.getByRole("button")).toHaveText(["Hide", "Type instead"]);
  for (const button of await capsule.getByRole("button").all()) await expect(button).toHaveAttribute("data-size", "small");
  await snap(capsule, "capsule-preparing");
  await capsule.getByRole("button", { name: "Type instead" }).click();
  await expect.poll(() => shown(app, "quick")).toBe(true);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("the download's card hides itself, though not while the pointer is on it, and the next press shows it again", async () => {
  test.setTimeout(150_000); // it waits out the card's time twice
  const hub = await fakeModelHub("stall");
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache(), AVANZEL_PREPARING_SHOW_MS: "3000" });
  await call(app, "snapshot"); // the app has started: the poll's 5 s count from here, not from launch
  await expect.poll(async () => (await modelStatus(app)).kind).toBe("downloading");
  await call(app, "toggleDictate");
  expect(await capsuleKind(app)).toBe("preparing");
  await expect.poll(() => capsuleKind(app), { timeout: 15_000 }).toBe("hidden");
  // The download goes on, and Settings → Voice keeps showing it.
  await call(app, "showSettings", "voice");
  const settings = await windowFor(app, "settings");
  await expect(settings.getByText(/^\d+ of 673 MB$/)).toBeVisible();
  // The next press shows the card again. With the pointer on it (what the card's pointer-enter sends), it stays.
  await call(app, "setKeepOpen", true);
  await call(app, "toggleDictate");
  expect(await capsuleKind(app)).toBe("preparing");
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText("The speech model is still downloading")).toBeVisible();
  await capsule.waitForTimeout(4_500); // past its 3 s
  expect(await capsuleKind(app)).toBe("preparing");
  await call(app, "setKeepOpen", false);
  await expect.poll(() => capsuleKind(app), { timeout: 15_000 }).toBe("hidden");
  await app.close();
});

test("the download's card says only that typing works while the size isn't known", async () => {
  const app = await launch({ HF_HUB_CACHE: emptyHfCache() }); // no library, so no download of its own ends the card
  const capsule = await windowFor(app, "capsule");
  await call(app, "setCapsule", { kind: "preparing", receivedBytes: 0, totalBytes: 0 });
  await expect(capsule.getByText("Typing works now.", { exact: true })).toBeVisible();
  await expect(capsule.getByText(/MB/)).toHaveCount(0);
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
  await expect(capsule.getByRole("button")).toHaveText(["Hide", "Type instead", "Try again"]);
  for (const button of await capsule.getByRole("button").all()) await expect(button).toHaveAttribute("data-size", "small");
  await snap(capsule, "capsule-model-failed");
  await capsule.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => hub.requests.length).toBeGreaterThan(asked);
  await expect.poll(() => capsuleKind(app)).toBe("model-failed");
  await expect(capsule.getByText("The speech model didn't finish downloading.")).toBeVisible();
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await settings.getByRole("radio", { name: "Voice", exact: true }).click();
  const alert = settings.getByRole("alert");
  await expect(alert).toContainText("The speech model didn't finish downloading.");
  await expect(alert).toContainText("Typing a thought works meanwhile.");
  // No shortcut has a problem, so this is the pane's first Notice, and its fix is the primary.
  const tryAgain = alert.getByRole("button", { name: "Try again" });
  await expect(tryAgain).toHaveAttribute("data-variant", "primary");
  await snap(settings, "settings-model-failed");
  // Try again here fetches it again, as the capsule's does.
  const retried = hub.requests.length;
  await tryAgain.click();
  await expect.poll(() => hub.requests.length).toBeGreaterThan(retried);
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
  await settings.getByRole("radio", { name: "Voice", exact: true }).click();
  const alert = settings.getByRole("alert");
  await expect(alert).toContainText("Avanzel can't use these voice settings.");
  await expect(alert).toContainText(/Speech model 'parakeet-v9' is not supported/);
  await expect(settings.getByRole("button", { name: "Try again" })).toHaveCount(0); // trying again can't help
  expect(hub.requests).toEqual([]);
  await app.close();
});

test("a fixed [voice] setting works on the next press", async () => {
  const hub = await fakeModelHub("stall");
  const library = await makeLibrary();
  const config = loadSettings(library);
  saveSettings(library, { ...config, voice: { ...config.voice, model: "parakeet-v9" } });
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_MODELS_URL: hub.url, HF_HUB_CACHE: emptyHfCache() });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect(capsule.getByText("Avanzel can't use these voice settings")).toBeVisible();
  expect(hub.requests).toEqual([]);
  saveSettings(library, config); // fixed by hand, with Avanzel running
  await call(app, "toggleDictate");
  await expect(capsule.getByRole("progressbar", { name: "Downloading the speech model" })).toBeVisible();
  await expect(capsule.getByText("The speech model is still downloading")).toBeVisible();
  await expect.poll(() => hub.requests.length).toBeGreaterThan(0);
  await app.close();
});
