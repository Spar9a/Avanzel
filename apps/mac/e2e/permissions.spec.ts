// Microphone and Screen Recording turned down (AVANZEL_FAKE_PERMISSIONS stands in for macOS):
// the capsule says what to do, and nothing half-made is left in the library. Settings → Privacy
// says what each permission is for, where it stands, and how to allow it, offers Quit and reopen
// for the screen (which relaunches nothing under AVANZEL_TEST=1), and follows System Settings.
import { expect, test } from "@playwright/test";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { expectProblem } from "./capsule-helpers.ts";
import { call, capsuleKind, filesUnder, launch, makeLibrary, openSettings, screenshotFixture, snap, speechWav, windowFor } from "./helpers.ts";

const saved = (root: string) => ({
  inbox: filesUnder(root, "inbox"),
  audio: filesUnder(root, "raw/audio"),
  attachments: filesUnder(root, "raw/attachments"),
});

const quiet = { AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "words that must not be saved" };

test("with the microphone denied, dictating says how to allow it and saves nothing", async () => {
  const library = await makeLibrary();
  const before = saved(library);
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_PERMISSIONS: "microphone:denied", ...quiet });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("error");
  // What happened, what to do, and the one fix: Open System Settings, on the Microphone pane.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    message: "Avanzel can't hear you yet.",
    detail: "Allow it in System Settings, under Microphone.",
    action: "open-microphone-settings",
    actionLabel: "Open System Settings",
  });
  await expectProblem(capsule, {
    title: "Avanzel can't hear you yet.",
    lines: ["Allow it in System Settings, under Microphone."],
    fix: "Open System Settings",
  });
  await snap(capsule, "mic-denied");
  expect(saved(library)).toEqual(before);
  // With AVANZEL_TEST=1 System Settings stays shut, and openedForTests says which pane the button went to.
  await capsule.getByRole("button", { name: "Open System Settings", exact: true }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Microphone"]);
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("with Screen Recording denied, a screen capture says how to allow it, relaunch included, and saves nothing", async () => {
  const library = await makeLibrary();
  const before = saved(library);
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_PERMISSIONS: "screen:denied",
    AVANZEL_FAKE_SCREEN: screenshotFixture(),
    AVANZEL_FAKE_FRONT_APP: "Safari|A page|https://example.com",
    ...quiet,
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("error");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    message: "Avanzel can't see the screen yet.",
    detail: "Allow it in System Settings, under Screen Recording, then quit and reopen Avanzel.",
    action: "open-screen-settings",
    actionLabel: "Open System Settings",
  });
  await expectProblem(capsule, {
    title: "Avanzel can't see the screen yet.",
    lines: ["Allow it in System Settings, under Screen Recording, then quit and reopen Avanzel."],
    fix: "Open System Settings",
  });
  await snap(capsule, "screen-denied");
  expect(saved(library)).toEqual(before);
  await capsule.getByRole("button", { name: "Open System Settings", exact: true }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Screen Recording"]);
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("a blank first screen capture asks for Screen Recording and a relaunch, and saves nothing", async () => {
  const library = await makeLibrary();
  const before = saved(library);
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_PERMISSIONS: "screen:not-determined",
    AVANZEL_FAKE_SCREEN: screenshotFixture({ blank: true }),
    ...quiet,
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("error");
  await expectProblem(capsule, {
    title: "Avanzel can't see the screen yet.",
    lines: ["Allow it in System Settings, under Screen Recording, then quit and reopen Avanzel."],
    fix: "Open System Settings",
  });
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    message: "Avanzel can't see the screen yet.",
    action: "open-screen-settings",
    actionLabel: "Open System Settings",
  });
  expect(saved(library)).toEqual(before);
  await app.close();
});

test("Settings → Privacy says what each permission is for, and Open System Settings goes where it's allowed", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_PERMISSIONS: "screen:denied" });
  const settings = await openSettings(app, "Privacy");
  const microphone = settings.getByRole("group", { name: "Microphone", exact: true });
  const screen = settings.getByRole("group", { name: "Screen recording", exact: true });
  // Each row says what its permission is for; its control says where it stands.
  await expect(settings.getByText("Only while the capsule shows it listening.", { exact: true })).toBeVisible();
  await expect(settings.getByText("Needed only to capture the screen with a comment.", { exact: true })).toBeVisible();
  await expect(microphone.getByText("Allowed", { exact: true })).toBeVisible();
  await expect(microphone.getByRole("button")).toHaveCount(0);
  // Screen recording applies only once Avanzel starts again, so its row offers that beside the way to allow it; the group's
  // note, which says so, stays.
  await expect(screen.getByRole("button")).toHaveText(["Open System Settings", "Quit and reopen"]);
  await expect(settings.getByText("After you allow screen recording, quit and reopen Avanzel: macOS applies it only then.", { exact: true })).toBeVisible();
  // What leaves this Mac names a captured screen too, since a screenshot goes to the agent as well as the words.
  await expect(
    settings.getByText(
      "Your voice never leaves this Mac. Your words, and any screen you capture with a comment, go only to the agent you chose, the same way your code already does.",
      { exact: true },
    ),
  ).toBeVisible();
  await snap(settings, "settings-privacy-screen-denied");
  // With AVANZEL_TEST=1 System Settings stays shut, and openedForTests says which pane it would have opened.
  await screen.getByRole("button", { name: "Open System Settings" }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Screen Recording"]);
  await app.close();
});

test("Settings → Privacy says the voice goes to the library's command, for a library whose voice is one", async () => {
  const library = await makeLibrary();
  const voice = { backend: "command", model: "", quantization: "", command: ["true"], maxRecordSeconds: 600, dictionary: [], dictionarySoundAlike: true };
  saveSettings(library, { ...loadSettings(library), voice });
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Privacy");
  // A command is the library's own and can send the voice anywhere, so the pane says where it goes, and doesn't promise it stays.
  await expect(
    settings.getByText(
      "Your voice goes to the command in this library's settings. Your words, and any screen you capture with a comment, go only to the agent you chose, the same way your code already does.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(settings.getByText(/never leaves this Mac/)).toHaveCount(0);
  await snap(settings, "settings-privacy-command");
  await app.close();
});

test("with the microphone denied, Settings → Privacy offers Open System Settings, not Allow…, since macOS asks only once", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_PERMISSIONS: "microphone:denied" });
  const settings = await openSettings(app, "Privacy");
  const microphone = settings.getByRole("group", { name: "Microphone", exact: true });
  // macOS has been asked and refused, and doesn't ask again: Allow… would do nothing. Only System Settings can turn it on.
  await expect(microphone.getByRole("button")).toHaveText(["Open System Settings"]);
  await expect(microphone.getByText("Allowed", { exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Allow…" })).toHaveCount(0);
  await snap(settings, "settings-privacy-microphone-denied");
  await microphone.getByRole("button", { name: "Open System Settings" }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Microphone"]);
  await app.close();
});

test("Allow… asks macOS for the microphone once, and the row then says Allowed", async () => {
  const app = await launch({
    AVANZEL_LIBRARY: await makeLibrary(),
    AVANZEL_FAKE_PERMISSIONS: "microphone:not-determined",
    AVANZEL_FAKE_MIC_ANSWER: "granted",
  });
  const settings = await openSettings(app, "Privacy");
  const microphone = settings.getByRole("group", { name: "Microphone", exact: true });
  // macOS hasn't asked yet: the row offers to ask, and doesn't say Allowed.
  await expect(microphone.getByRole("button")).toHaveText(["Allow…"]);
  await expect(microphone.getByText("Allowed", { exact: true })).toHaveCount(0);
  await snap(settings, "settings-privacy-microphone-not-asked");
  await microphone.getByRole("button", { name: "Allow…" }).click();
  // The answer is the microphone's status from then on, so the row says Allowed and has nothing left to offer.
  await expect(microphone.getByText("Allowed", { exact: true })).toBeVisible();
  await expect(microphone.getByRole("button")).toHaveCount(0);
  await app.close();
});

test("Screen recording never offers Allow…, since Electron can't tell never asked from denied", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_PERMISSIONS: "screen:not-determined" });
  const settings = await openSettings(app, "Privacy");
  await expect(settings.getByRole("group", { name: "Screen recording", exact: true }).getByRole("button")).toHaveText([
    "Open System Settings",
    "Quit and reopen",
  ]);
  await expect(settings.getByRole("button", { name: "Allow…" })).toHaveCount(0);
  await app.close();
});

test("a screen row that isn't allowed offers Quit and reopen, secondary, which relaunches once; the microphone's row has none", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_PERMISSIONS: "microphone:denied,screen:denied" });
  const settings = await openSettings(app, "Privacy");
  const microphone = settings.getByRole("group", { name: "Microphone", exact: true });
  const screen = settings.getByRole("group", { name: "Screen recording", exact: true });
  // macOS applies a microphone grant at once, so only the screen row restarts.
  await expect(microphone.getByRole("button")).toHaveText(["Open System Settings"]);
  await expect(screen.getByRole("button")).toHaveText(["Open System Settings", "Quit and reopen"]);
  // Neither is the moment's one primary: both are secondary, as the table's Privacy row says.
  await expect(screen.getByRole("button", { name: "Open System Settings", exact: true })).toHaveAttribute("data-variant", "secondary");
  await expect(screen.getByRole("button", { name: "Quit and reopen", exact: true })).toHaveAttribute("data-variant", "secondary");
  await snap(settings, "settings-privacy-quit-and-reopen");
  expect(await call(app, "relaunchedForTests")).toBe(0);
  await screen.getByRole("button", { name: "Quit and reopen", exact: true }).click();
  // With AVANZEL_TEST=1 nothing relaunches: the ask is only noted, and Avanzel goes on running.
  await expect.poll(() => call(app, "relaunchedForTests")).toBe(1);
  expect(await call(app, "openedForTests")).toEqual([]);
  await expect(settings.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  await app.close();
});

test("a screen that is allowed has no Quit and reopen", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_PERMISSIONS: "microphone:denied" });
  const settings = await openSettings(app, "Privacy");
  await expect(settings.getByRole("group", { name: "Screen recording", exact: true }).getByText("Allowed", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Quit and reopen" })).toHaveCount(0);
  await app.close();
});

test("Settings → Privacy follows System Settings: a permission allowed there shows as Allowed once Settings has the focus again", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_PERMISSIONS: "microphone:denied,screen:denied" });
  const settings = await openSettings(app, "Privacy");
  const microphone = settings.getByRole("group", { name: "Microphone", exact: true });
  const screen = settings.getByRole("group", { name: "Screen recording", exact: true });
  await expect(microphone.getByRole("button")).toHaveText(["Open System Settings"]);
  await expect(screen.getByRole("button")).toHaveText(["Open System Settings", "Quit and reopen"]);
  // The person allows both in System Settings (the stand-in for macOS now says granted) and comes back: Settings has the
  // focus again. Main sends a fresh snapshot then, as setup reads the sign-ins again when it has the focus.
  await app.evaluate(({ BrowserWindow }) => {
    process.env.AVANZEL_FAKE_PERMISSIONS = "microphone:granted,screen:granted";
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/settings/"))?.emit("focus");
  });
  await expect(microphone.getByText("Allowed", { exact: true })).toBeVisible();
  await expect(screen.getByText("Allowed", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Open System Settings" })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Quit and reopen" })).toHaveCount(0);
  // And back again: a permission taken away there reads as not allowed.
  await app.evaluate(({ BrowserWindow }) => {
    process.env.AVANZEL_FAKE_PERMISSIONS = "microphone:denied,screen:granted";
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/settings/"))?.emit("focus");
  });
  await expect(microphone.getByRole("button")).toHaveText(["Open System Settings"]);
  await expect(screen.getByText("Allowed", { exact: true })).toBeVisible();
  await app.close();
});
