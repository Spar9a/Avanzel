// Microphone and Screen Recording turned down (AVANZEL_FAKE_PERMISSIONS stands in for macOS):
// the capsule says what to do, and nothing half-made is left in the library.
import { expect, test } from "@playwright/test";
import { call, capsuleKind, filesUnder, launch, makeLibrary, screenshotFixture, snap, speechWav, windowFor } from "./helpers.ts";

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
