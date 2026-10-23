// Microphone and Screen Recording turned down (AVANZEL_FAKE_PERMISSIONS stands in for macOS):
// the capsule says what to do, and nothing half-made is left in the library. Settings → Privacy
// says what each permission is for, where it stands, and how to allow it.
import { expect, test } from "@playwright/test";
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
  await expect(capsule.getByText("Avanzel can't use the microphone")).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Open Settings" })).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ action: "open-microphone-settings" });
  await snap(capsule, "mic-denied");
  expect(saved(library)).toEqual(before);
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
  await expect(capsule.getByText("Avanzel can't see the screen yet")).toBeVisible();
  await expect(capsule.getByText(/then quit and reopen Avanzel\.$/)).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Open Settings" })).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ action: "open-screen-settings" });
  await snap(capsule, "screen-denied");
  expect(saved(library)).toEqual(before);
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
  await expect(capsule.getByText(/then quit and reopen Avanzel\.$/)).toBeVisible();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ action: "open-screen-settings" });
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
  await expect(screen.getByRole("button")).toHaveText(["Open System Settings"]);
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
  await expect(settings.getByRole("group", { name: "Screen recording", exact: true }).getByRole("button")).toHaveText(["Open System Settings"]);
  await expect(settings.getByRole("button", { name: "Allow…" })).toHaveCount(0);
  await app.close();
});
