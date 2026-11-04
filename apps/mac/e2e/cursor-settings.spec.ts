// Settings → Voice → "Dictate into any app": the switch, the key, and the line that says which permission is missing. The Mac's side
// (the permissions) is the fake cursor helper (AVANZEL_FAKE_CURSOR), whose script says what macOS has granted.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CursorHelper } from "../src/main/cursor-helper.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { answerMenus, call, launch, makeLibrary, openSettings, shownMenus } from "./helpers.ts";

const snapshot = async (app: ElectronApplication) => (await call(app, "snapshot")) as SettingsSnapshot;

/** A fake helper's script that says what is granted; returns the file, to be written again when the person grants more. */
function fakeCursor(permissions: { accessibility: boolean; inputMonitoring: boolean }): string {
  const script = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-cursor-")), "cursor.json");
  writeFileSync(script, JSON.stringify({ permissions }));
  return script;
}

const group = (settings: Page) => settings.locator("section", { has: settings.getByRole("heading", { name: "Dictate into any app", level: 3 }) });

test("the switch is off to begin with, turns dictating on at once, and is still on after Avanzel opens again", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const env = { AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData, AVANZEL_FAKE_CURSOR: fakeCursor({ accessibility: true, inputMonitoring: true }) };
  const app = await launch(env);
  const settings = await openSettings(app, "Voice");
  const toggle = settings.getByRole("switch", { name: "Dictate into any app" });
  await expect(toggle).not.toBeChecked();
  await expect(settings.getByText("Tap the key once to start and once to finish. The words go where the cursor is.", { exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await snapshot(app)).app.cursorDictation).toEqual({ enabled: true, key: "right-option" });
  await app.close();

  const again = await launch(env);
  const settingsAgain = await openSettings(again, "Voice");
  await expect(settingsAgain.getByRole("switch", { name: "Dictate into any app" })).toBeChecked();
  await again.close();
});

test("the key is chosen from Right Option, Left Option, Right Command and Right Control, and the choice is kept", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const env = { AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData, AVANZEL_FAKE_CURSOR: fakeCursor({ accessibility: true, inputMonitoring: true }) };
  const app = await launch(env);
  const settings = await openSettings(app, "Voice");
  const choose = settings.getByRole("group", { name: "Dictation key: Right Option", exact: true }).getByRole("button", { name: "Choose…" });
  await answerMenus(app, "Right Command");
  await choose.click();
  await expect.poll(() => shownMenus(app)).toHaveLength(1);
  expect((await shownMenus(app))[0]).toEqual([
    { label: "Right Option", checked: true },
    { label: "Left Option", checked: false },
    { label: "Right Command", checked: false },
    { label: "Right Control", checked: false },
  ]);
  await expect.poll(async () => (await snapshot(app)).app.cursorDictation.key).toBe("right-command");
  // Choosing a key doesn't turn dictating on.
  expect((await snapshot(app)).app.cursorDictation.enabled).toBe(false);
  await expect(settings.getByRole("group", { name: "Dictation key: Right Command", exact: true })).toBeVisible();
  await app.close();

  const again = await launch(env);
  const settingsAgain = await openSettings(again, "Voice");
  await expect(settingsAgain.getByRole("group", { name: "Dictation key: Right Command", exact: true })).toBeVisible();
  await again.close();
});

test("with both permissions granted the group says so, with nothing to press, even while dictating is off", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_CURSOR: fakeCursor({ accessibility: true, inputMonitoring: true }) });
  const settings = await openSettings(app, "Voice");
  expect((await snapshot(app)).app.cursorDictation.enabled).toBe(false);
  await expect(group(settings).getByText("Avanzel can see the key and type for you.", { exact: true })).toBeVisible();
  await expect(group(settings).getByRole("button", { name: "Open System Settings" })).toHaveCount(0);
  await app.close();
});

test("with Accessibility missing the group says so and its button asks macOS and opens that pane; granting it clears the line when Settings is back in front", async () => {
  const script = fakeCursor({ accessibility: false, inputMonitoring: true });
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_CURSOR: script });
  const settings = await openSettings(app, "Voice");
  await expect(group(settings).getByText("Avanzel needs Accessibility to type for you.", { exact: true })).toBeVisible();
  await expect(settings.getByText("Avanzel can see the key and type for you.", { exact: true })).toHaveCount(0);
  expect(await call(app, "openedForTests")).toEqual([]);

  await group(settings).getByRole("button", { name: "Open System Settings" }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Accessibility"]);
  // It still lacks it: the line stays, since nothing was granted yet.
  await expect(group(settings).getByText("Avanzel needs Accessibility to type for you.", { exact: true })).toBeVisible();

  // The person grants it in System Settings and comes back: the window gets the focus again.
  writeFileSync(script, JSON.stringify({ permissions: { accessibility: true, inputMonitoring: true } }));
  await settings.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(group(settings).getByText("Avanzel can see the key and type for you.", { exact: true })).toBeVisible();
  await expect(group(settings).getByRole("button", { name: "Open System Settings" })).toHaveCount(0);
  await app.close();
});

test("with Input Monitoring missing the group says so, and its button opens that pane", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_CURSOR: fakeCursor({ accessibility: true, inputMonitoring: false }) });
  const settings = await openSettings(app, "Voice");
  await expect(group(settings).getByText("Avanzel needs Input Monitoring to see the key.", { exact: true })).toBeVisible();
  await group(settings).getByRole("button", { name: "Open System Settings" }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Input Monitoring"]);
  await app.close();
});

test("with both missing the group says both in one sentence, turning dictating on still works, and the line stays", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_CURSOR: fakeCursor({ accessibility: false, inputMonitoring: false }) });
  const settings = await openSettings(app, "Voice");
  const line = "Avanzel needs Input Monitoring to see the key and Accessibility to type for you.";
  await expect(group(settings).getByText(line, { exact: true })).toBeVisible();
  await group(settings).getByRole("switch", { name: "Dictate into any app" }).click();
  await expect.poll(async () => (await snapshot(app)).app.cursorDictation.enabled).toBe(true);
  await expect(group(settings).getByText(line, { exact: true })).toBeVisible();
  // Input Monitoring is asked for first: the key can't be seen without it.
  await group(settings).getByRole("button", { name: "Open System Settings" }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Input Monitoring"]);
  await app.close();
});

// The quiet stage can't take the built helper away, so this runs where it isn't built (a Mac that can't dictate into any app has none).
test("on a Mac where the helper isn't there, the group says dictating isn't available and its controls are off", async () => {
  test.skip(CursorHelper.available(), "the helper is built on this Mac");
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app, "Voice");
  await expect(group(settings).getByText("Dictating into any app isn't available on this Mac.", { exact: true })).toBeVisible();
  await expect(group(settings).getByRole("switch", { name: "Dictate into any app" })).toBeDisabled();
  await expect(group(settings).getByRole("button", { name: "Choose…" })).toBeDisabled();
  await app.close();
});
