// A shortcut another app holds (AVANZEL_FAKE_TAKEN_SHORTCUTS stands in for those apps): the capsule names it at launch
// with two free ones to pick, the menu stops showing it, and Settings → Voice offers the same free ones.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { CapsuleState, SettingsSnapshot } from "../src/shared/ipc.ts";
import { call, capsuleKind, emptyHfCache, launch, makeLibrary, openSettings, snap, windowFor } from "./helpers.ts";

const snapshot = async (app: ElectronApplication) => (await call(app, "snapshot")) as SettingsSnapshot;
const capsuleState = async (app: ElectronApplication) => (await call(app, "capsuleStateForTests")) as CapsuleState;

/** The menu's item for `action`: Record a thought is "dictate". */
const menuItem = async (app: ElectronApplication, action: string) =>
  ((await call(app, "menuForTests")) as MenuItemModel[]).find((item) => item.type === "item" && item.action === action);
const recordItem = (app: ElectronApplication) => menuItem(app, "dictate");

/** A folder for the app's own data that more than one launch can share. */
const userDataDir = () => mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));

test("a taken ⌥Space is named at launch, and a free one picked there says it works", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space" });
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText(/⌥Space is used by another app/)).toBeVisible();
  await expect(capsule.getByText("Pick another shortcut. “Record a thought” is still in the menu bar.", { exact: true })).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Use ⌃⇧Space" })).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Use ⌃⌥R" })).toBeVisible();
  // Hide first; the best one last, as the primary.
  await expect(capsule.getByRole("button")).toHaveText(["Hide", "Use ⌃⌥R", "Use ⌃⇧Space"]);
  await expect(capsule.getByRole("button", { name: "Use ⌃⇧Space" })).toHaveAttribute("data-variant", "primary");
  for (const button of await capsule.getByRole("button").all()) await expect(button).toHaveAttribute("data-size", "small");
  expect(await recordItem(app)).not.toHaveProperty("accelerator");
  await snap(capsule, "capsule-shortcut-taken");

  await capsule.getByRole("button", { name: "Use ⌃⌥R" }).click();
  await capsule.mouse.move(0, 0); // off the capsule, which stays while the pointer is on it
  // The capsule says the pick works, in its live region (beside Zel, whose drawing VoiceOver skips), then goes by itself.
  await expect(capsule.getByRole("status").getByText("Record a thought now uses ⌃⌥R", { exact: true })).toBeVisible();
  await snap(capsule, "capsule-shortcut-picked");
  await expect.poll(() => capsuleKind(app), { timeout: 15_000 }).toBe("hidden");
  const after = await snapshot(app);
  expect(after.app.shortcuts.dictate).toBe("Control+Alt+R");
  expect(after.shortcutProblems).toEqual({});
  expect(await recordItem(app)).toMatchObject({ accelerator: "Control+Alt+R" });
  await app.close();
});

test("the launch notice names each taken shortcut once, and again only after it has worked", async () => {
  test.setTimeout(240_000);
  const library = await makeLibrary();
  const userData = userDataDir(); // where the noticed shortcuts are kept, from one launch to the next
  const start = async (taken: string) => {
    const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_USER_DATA: userData, AVANZEL_FAKE_TAKEN_SHORTCUTS: taken });
    await call(app, "snapshot"); // it has started: a launch notice would show by now
    return app;
  };
  let app = await start("Alt+Space");
  expect(await capsuleState(app)).toMatchObject({ kind: "shortcut-taken", key: "dictate" });
  await app.close();
  // Still taken: not named again, while Settings → Voice and the menu still say so.
  app = await start("Alt+Space");
  expect(await capsuleKind(app)).toBe("hidden");
  expect((await snapshot(app)).shortcutProblems).toHaveProperty("dictate");
  expect(await recordItem(app)).not.toHaveProperty("accelerator");
  await app.close();
  // A shortcut taken since is named, once.
  app = await start("Alt+Space,Alt+Shift+S");
  expect(await capsuleState(app)).toMatchObject({ kind: "shortcut-taken", key: "capture" });
  await app.close();
  // Both work for a launch; taken again after that, ⌥Space is named again.
  app = await start("");
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
  app = await start("Alt+Space");
  expect(await capsuleState(app)).toMatchObject({ kind: "shortcut-taken", key: "dictate" });
  await app.close();
});

test("setting up a library names a taken shortcut at once, and the next launch doesn't again", async () => {
  test.setTimeout(180_000);
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the library is remembered here, not in ~/.config
  const env = { AVANZEL_USER_DATA: userDataDir(), AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space", XDG_CONFIG_HOME: config };
  const app = await launch(env);
  await call(app, "snapshot"); // it has started
  expect(await capsuleKind(app)).toBe("hidden"); // no library, no Record a thought in the menu yet
  await call(app, "createLibrary", path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-lib-")), "Avanzel"));
  expect(await capsuleState(app)).toMatchObject({ kind: "shortcut-taken", key: "dictate" });
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText("Pick another shortcut. “Record a thought” is still in the menu bar.", { exact: true })).toBeVisible();
  await app.close();
  const again = await launch(env); // its settings, kept in the same folder, open that library
  expect((await snapshot(again)).library?.exists).toBe(true);
  expect(await capsuleKind(again)).toBe("hidden");
  await again.close();
});

test("a shortcut two of Avanzel's actions have is the earlier one's: no notice, no free ones, and only its item shows it", async () => {
  const userData = userDataDir();
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ version: 1, shortcuts: { type: "Alt+Space" } }));
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData });
  const { shortcutProblems, shortcutAlternatives } = await snapshot(app);
  expect(shortcutProblems).toEqual({ type: "⌥Space is already the shortcut for Record a thought. Pick another shortcut." });
  expect(shortcutAlternatives).toEqual({});
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await recordItem(app)).toMatchObject({ accelerator: "Alt+Space" });
  expect(await menuItem(app, "type")).not.toHaveProperty("accelerator");
  await call(app, "showSettings", "voice");
  const settings = await windowFor(app, "settings");
  await expect(settings.getByText("⌥Space is already the shortcut for Record a thought. Pick another shortcut.")).toBeVisible();
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveCount(0);
  await app.close();
});

test("with no free shortcut the notice offers Open Settings", async () => {
  const app = await launch({
    AVANZEL_LIBRARY: await makeLibrary(),
    // ⌥Space and every one Record a thought could move to.
    AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space,Control+Shift+Space,Control+Alt+R,Control+Alt+D",
  });
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText(/⌥Space is used by another app/)).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Open Settings" })).toBeVisible();
  await expect(capsule.getByRole("button", { name: /^Use / })).toHaveCount(0);
  await snap(capsule, "capsule-shortcut-taken-none-free");

  await capsule.getByRole("button", { name: "Open Settings" }).click();
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("heading", { name: "Voice" })).toBeVisible();
  await expect(settings.getByText(/⌥Space is used by another app/)).toBeVisible();
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("Settings → Voice offers the free ones under the taken shortcut's problem", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space" });
  await expect.poll(() => capsuleKind(app)).toBe("shortcut-taken");
  await call(app, "showSettings", "voice");
  const settings = await windowFor(app, "settings");
  await expect(settings.getByText(/⌥Space is used by another app.* Pick another shortcut\./)).toBeVisible();
  await expect(settings.getByText("“Record a thought” is still in the menu bar.", { exact: true })).toBeVisible();
  // The best one last, and as this is the pane's first Notice, the primary.
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveText(["Use ⌃⌥R", "Use ⌃⇧Space"]);
  await expect(settings.getByRole("button", { name: "Use ⌃⇧Space" })).toHaveAttribute("data-variant", "primary");
  await expect(settings.getByRole("button", { name: "Use ⌃⌥R" })).toHaveAttribute("data-variant", "secondary");
  await snap(settings, "settings-shortcut-taken");

  await settings.getByRole("button", { name: "Use ⌃⇧Space" }).click();
  // The capsule's notice goes too: that shortcut works now.
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  const after = await snapshot(app);
  expect(after.app.shortcuts.dictate).toBe("Control+Shift+Space");
  expect(after.shortcutProblems).toEqual({});
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveCount(0);
  await expect(settings.getByText(/is used by another app/)).toHaveCount(0);
  // The buttons went with the pick, so the focus is on the row of the shortcut it changed.
  const row = settings.getByRole("group", { name: "Record a thought", exact: true });
  await expect(row.getByText("⌃⇧Space", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Change", exact: true })).toBeFocused();
  await app.close();
});

/**
 * Settings → Voice of a library whose speech model fails to download at once (an empty cache, so that this Mac's own copy
 * stays out of it, and launch()'s dead port), with the `taken` shortcuts held by other apps. Its Notices come in the
 * menu's order: Record a thought's, Capture screen with a comment's, and the speech model's last.
 */
async function voiceWithProblems(taken: string): Promise<{ app: ElectronApplication; settings: Page }> {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_TAKEN_SHORTCUTS: taken, HF_HUB_CACHE: emptyHfCache() });
  return { app, settings: await openSettings(app, "Voice") };
}

/** The pane's primary buttons: one moment, one primary. */
const primaries = (settings: Page) => settings.locator('button[data-variant="primary"]');

/** The failed download's Try again. */
const tryAgain = (settings: Page) =>
  settings.getByRole("alert").filter({ hasText: "The speech model didn't finish downloading." }).getByRole("button", { name: "Try again" });

// A running Alfred or Raycast is named after ⌥Space, so the titles below match its words, not spell them out.
const TAKEN_TITLES = [/^⌥Space is used by another app.* Pick another shortcut\.$/, /^⌥⇧S is used by another app.* Pick another shortcut\.$/];

test("with more than one shortcut problem, the best free shortcut of the first Notice is the pane's only primary", async () => {
  // Record a thought and Capture screen with a comment are both taken, and each has two free shortcuts to offer.
  const { app, settings } = await voiceWithProblems("Alt+Space,Alt+Shift+S");
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveText(["Use ⌃⌥R", "Use ⌃⇧Space", "Use ⌃⌥C", "Use ⌃⌥S"]);
  await expect(settings.getByRole("button", { name: "Use ⌃⇧Space" })).toHaveAttribute("data-variant", "primary");
  for (const name of ["Use ⌃⌥R", "Use ⌃⌥C", "Use ⌃⌥S"]) {
    await expect(settings.getByRole("button", { name })).toHaveAttribute("data-variant", "secondary");
  }
  await expect(settings.getByText(/is used by another app/)).toHaveText(TAKEN_TITLES);
  // The failed download's Notice comes last, and its Try again is not a second primary.
  await expect(tryAgain(settings)).toHaveAttribute("data-variant", "secondary");
  await expect(primaries(settings)).toHaveCount(1);
  await app.close();
});

test("a Notice with no free shortcut to offer leaves the primary to the next one that has some", async () => {
  // Every shortcut that Record a thought could move to is taken too, so its Notice has no button. Capture screen with a
  // comment's still has two.
  const { app, settings } = await voiceWithProblems("Alt+Space,Control+Shift+Space,Control+Alt+R,Control+Alt+D,Alt+Shift+S");
  await expect(settings.getByText(/is used by another app/)).toHaveText(TAKEN_TITLES);
  await expect(settings.getByRole("alert").filter({ hasText: "⌥Space is used by another app" }).getByRole("button")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveText(["Use ⌃⌥C", "Use ⌃⌥S"]);
  // The best of those is the primary, as it would be in the first Notice, and Try again is not a second one.
  await expect(settings.getByRole("button", { name: "Use ⌃⌥S" })).toHaveAttribute("data-variant", "primary");
  await expect(settings.getByRole("button", { name: "Use ⌃⌥C" })).toHaveAttribute("data-variant", "secondary");
  await expect(tryAgain(settings)).toHaveAttribute("data-variant", "secondary");
  await expect(primaries(settings)).toHaveCount(1);
  await app.close();
});

test("with no free shortcut to offer anywhere, a failed download's Try again is the pane's only primary", async () => {
  // Record a thought is taken, and so is every shortcut it could move to: its Notice has no button.
  const { app, settings } = await voiceWithProblems("Alt+Space,Control+Shift+Space,Control+Alt+R,Control+Alt+D");
  await expect(settings.getByText(/⌥Space is used by another app/)).toBeVisible();
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveCount(0);
  await expect(tryAgain(settings)).toHaveAttribute("data-variant", "primary");
  await expect(primaries(settings)).toHaveCount(1);
  await app.close();
});

test("Change records the next shortcut; Esc, leaving the row or the window, a key with no modifier, and a move to another pane keep the old one", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app, "Voice");
  const row = settings.getByRole("group", { name: "Type a thought", exact: true });
  const change = row.getByRole("button", { name: "Change", exact: true });
  const listening = row.getByRole("button", { name: "Type the new shortcut…", exact: true });
  const record = async () => {
    await change.click();
    await expect(listening).toBeVisible();
  };
  // However a recording ends without a whole shortcut, the button reads Change again and the shortcut is as it was.
  const kept = async () => {
    await expect(change).toBeVisible();
    await expect(listening).toHaveCount(0);
    expect((await snapshot(app)).app.shortcuts.type).toBe("Alt+Shift+Space");
  };

  await record();
  await settings.keyboard.press("Escape");
  await kept();

  await record();
  await settings.getByRole("radio", { name: "Voice", exact: true }).focus(); // the focus leaves the row
  await kept();

  await record();
  await settings.evaluate(() => window.dispatchEvent(new Event("blur"))); // the window loses the focus
  await kept();

  await record();
  await settings.keyboard.press("Tab"); // the focus moves on to the next row, which ends it: a recording is no keyboard trap
  await kept();
  await expect(settings.getByRole("group", { name: "Ask your library", exact: true }).getByRole("button", { name: "Change", exact: true })).toBeFocused();

  await record();
  for (const key of ["K", "Enter", "Space"]) {
    // No modifier, so it keeps listening. Enter and Space press a focused button, but not this one while it listens.
    await settings.keyboard.press(key);
    await expect(listening).toBeVisible();
  }
  await settings.keyboard.press("Escape");
  await kept();

  // Another pane unmounts Voice, and a key pressed there goes nowhere. Voice, opened again, starts afresh.
  await record();
  await call(app, "openSettingsFor", "open-settings:privacy");
  await expect(settings.getByRole("radio", { name: "Privacy", exact: true })).toHaveAttribute("aria-checked", "true");
  await settings.keyboard.press("Control+Alt+K");
  await call(app, "showSettings", "voice");
  await expect(settings.getByRole("heading", { name: "Voice", exact: true })).toBeVisible();
  await kept();

  // A whole shortcut is saved, and the focus is on the row's Change.
  await record();
  await settings.keyboard.press("Control+Alt+K");
  await expect.poll(async () => (await snapshot(app)).app.shortcuts.type).toBe("Control+Alt+K");
  await expect(row.getByText("⌃⌥K", { exact: true })).toBeVisible();
  await expect(change).toBeVisible();
  await expect(change).toBeFocused();
  await app.close();
});

test("only one shortcut is recorded at a time, and Change again stops it", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app, "Voice");
  const listening = settings.getByRole("button", { name: "Type the new shortcut…", exact: true });
  const change = (name: string) => settings.getByRole("group", { name, exact: true }).getByRole("button", { name: "Change", exact: true });
  await change("Type a thought").click();
  await expect(listening).toHaveCount(1);
  // Starting another row's recording ends the first one's.
  await change("Ask your library").click();
  await expect(listening).toHaveCount(1);
  await expect(settings.getByRole("group", { name: "Ask your library", exact: true }).getByRole("button", { name: "Type the new shortcut…" })).toBeVisible();
  // Change on the row that listens stops it.
  await settings.getByRole("button", { name: "Type the new shortcut…" }).click();
  await expect(listening).toHaveCount(0);
  const { shortcuts } = (await snapshot(app)).app;
  expect(shortcuts).toMatchObject({ type: "Alt+Shift+Space", ask: "Alt+Shift+A" });
  await app.close();
});

test("a picked shortcut another app took meanwhile gets the notice, with fresh free ones", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space,Control+Alt+D" });
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText(/⌥Space is used by another app/)).toBeVisible();
  // As if ⌃⌥D had been offered, and another app took it before the click.
  await call(app, "useShortcut", "dictate", "Control+Alt+D");
  await expect(capsule.getByText("⌃⌥D is used by another app.")).toBeVisible();
  await expect(capsule.getByRole("button", { name: /^Use / })).toHaveText(["Use ⌃⌥R", "Use ⌃⇧Space"]);
  expect((await snapshot(app)).app.shortcuts.dictate).toBe("Control+Alt+D");
  await app.close();
});

test("without a library a taken shortcut shows no notice, and Settings → Voice offers the free ones", async () => {
  const app = await launch({ AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space" });
  await call(app, "snapshot"); // the app has started
  // Its body would point at a Record a thought the menu doesn't have yet.
  expect(await capsuleKind(app)).toBe("hidden");
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await settings.getByRole("radio", { name: "Voice", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Use ⌃⇧Space" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Use ⌃⌥R" })).toBeVisible();
  // The menu has no Record a thought yet, so the Notice doesn't say it is still there.
  await expect(settings.getByText(/⌥Space is used by another app/)).toBeVisible();
  await expect(settings.getByText(/is still in the menu bar/)).toHaveCount(0);
  await app.close();
});
