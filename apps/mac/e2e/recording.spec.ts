// The recording state machine: tap to start, tap to stop, and what happens when taps or audio go astray.
import { expect, test } from "@playwright/test";
import { call, capsuleKind, filesUnder, launch, makeLibrary, speechWav, windowFor } from "./helpers.ts";

const WAIT_FOR_AUDIO_MS = 3000; // AVANZEL_AUDIO_TIMEOUT_MS: how long the app waits for audio after a stop (15 s outside tests)

test("a second stop while stopping is ignored, so it never cuts the next dictation short", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "a thought said twice over",
    AVANZEL_AUDIO_TIMEOUT_MS: String(WAIT_FOR_AUDIO_MS),
  });
  await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  // A double tap on stop: both reach the controller before the audio does.
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: { toggleDictate(): Promise<void> } }).__avanzel;
    void controller.toggleDictate();
    void controller.toggleDictate();
  });
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toMatch(/^(filing|filed)$/); // its audio arrived
  await call(app, "toggleDictate"); // the next thought, right away
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_AUDIO_MS + 1000)); // nothing may fire meanwhile
  expect(await capsuleKind(app)).toBe("listening");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(filesUnder(library, "inbox")).toEqual([]);
  expect(filesUnder(library, "raw").filter((rel) => rel.endsWith(".md"))).toHaveLength(2);
  await app.close();
});

test("start and stop sent before the capsule page listens still reach it (a shortcut right after launch)", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "said while the capsule was loading",
    AVANZEL_AUDIO_TIMEOUT_MS: String(WAIT_FOR_AUDIO_MS),
  });
  await windowFor(app, "capsule");
  await call(app, "capsuleStateForTests");
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"))!;
    const controller = (globalThis as unknown as { __avanzel: { toggleDictate(): Promise<void> } }).__avanzel;
    const page = win.webContents.getURL();
    await win.webContents.loadURL("about:blank"); // nothing listens until the capsule page is back
    await controller.toggleDictate();
    await controller.toggleDictate();
    void win.webContents.loadURL(page);
  });
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filed");
  await app.close();
});

test("a recording whose audio never arrives is given up, and the capsule is told to let go of the microphone", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "lost on the way",
    AVANZEL_AUDIO_TIMEOUT_MS: String(WAIT_FOR_AUDIO_MS),
  });
  const capsule = await windowFor(app, "capsule");
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    ipcMain.removeHandler("capsule:audio");
    ipcMain.handle("capsule:audio", () => undefined); // the audio is lost on its way to the controller
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"))!;
    const commands: unknown[] = [];
    (globalThis as unknown as { __commands: unknown[] }).__commands = commands;
    const send = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel: string, ...args: unknown[]) => {
      if (channel === "capsule:command") commands.push(args[0]);
      send(channel, ...args);
    };
  });
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: WAIT_FOR_AUDIO_MS + 10_000 }).toBe("error");
  await expect(capsule.getByText("The recording didn't arrive")).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ action: "open-settings:voice" }); // its Open Settings opens Voice
  expect(await app.evaluate(() => (globalThis as unknown as { __commands: unknown[] }).__commands)).toEqual(["start", "stop", "cancel"]);
  await app.close();
});
