// A shortcut another app holds (AVANZEL_FAKE_TAKEN_SHORTCUTS stands in for those apps): the capsule names it at launch
// with two free ones to pick, the menu stops showing it, and Settings → Voice offers the same free ones. And ⌥⇧Z, the shortcut
// that takes the last filing back from any app, or says there is none to take back.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "../../../packages/engine/src/index.ts";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { CapsuleState, SettingsSnapshot } from "../src/shared/ipc.ts";
import { dictate, filedFromTheCapsule, holdTheQueue, inbox, launchOn, letTheQueueGo, notified, reachedUndo, undoCalls, undone, watchUndos, type Left } from "./capsule-helpers.ts";
import { call, capsuleKind, emptyHfCache, firstRun, launch, makeLibrary, openSettings, snap, windowFor } from "./helpers.ts";
import { zel } from "./setup-helpers.ts";

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
  // The shortcut is set as a key, as the listening hint sets its keys, and not as plain text; the sentence still reads whole.
  await expect(capsule.getByRole("status").locator("kbd")).toHaveText("⌃⌥R");
  await snap(capsule, "capsule-shortcut-picked");
  await expect.poll(() => capsuleKind(app), { timeout: 15_000 }).toBe("hidden");
  const after = await snapshot(app);
  expect(after.app.shortcuts.dictate).toBe("Control+Alt+R");
  expect(after.shortcutProblems).toEqual({});
  expect(await recordItem(app)).toMatchObject({ accelerator: "Control+Alt+R" });
  await app.close();
});

test("the picked shortcut's bar is a piece of the stack: as wide as the others, it says each action in full and holds while the pointer is on it", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const capsule = await windowFor(app, "capsule");
  const bar = capsule.getByRole("status");
  const PICKED_MS = 3_000; // the bar's own time: the pointer must be on it before its first look, which leaves room under load
  // The longest name an action has, with the longest shortcut: nothing of the line is cut off.
  await call(app, "setCapsule", { kind: "shortcut-picked", key: "capture", accelerator: "Control+Alt+Shift+Command+Space" }, PICKED_MS);
  const line = bar.getByText("Capture screen with a comment now uses ⌃⌥⇧⌘Space", { exact: true });
  await expect(line).toBeVisible();
  expect(await line.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect((await bar.boundingBox())!.width).toBeCloseTo(560, 0); // as wide as the other bars of the stack
  // The pointer on it holds it past its time, as it holds any card (it took no pointer, and hid under it, when it was no piece of the stack) ...
  await bar.hover();
  await capsule.waitForTimeout(PICKED_MS + 800);
  expect(await capsuleKind(app)).toBe("shortcut-picked");
  // ... and once the pointer is off it, the bar goes at its next time.
  await capsule.mouse.move(0, 0);
  await expect.poll(() => capsuleKind(app), { timeout: 8_000 }).toBe("hidden");
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

test("Change takes no shortcut without ⌃ or ⌥, which apps use themselves, and lets ⌘ keys go on to the app", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app, "Voice");
  const row = settings.getByRole("group", { name: "Type a thought", exact: true });
  const listening = row.getByRole("button", { name: "Type the new shortcut…", exact: true });
  // What reaches the page past the recorder, by key: each one with ⌘ or ⇧, and whether something kept it from the app.
  await settings.evaluate(() => {
    const page = window as unknown as { passed: { code: string; prevented: boolean }[] };
    page.passed = [];
    document.addEventListener("keydown", (event) => {
      if (event.metaKey || event.shiftKey) page.passed.push({ code: event.code, prevented: event.defaultPrevented });
    });
  });
  await row.getByRole("button", { name: "Change", exact: true }).click();
  await expect(listening).toBeVisible();
  // ⌘W, ⌘⇧Z and ⇧A would take a key from every app: the recorder keeps listening, and saves nothing.
  for (const keys of ["Meta+W", "Meta+Shift+Z", "Shift+A"]) {
    await settings.keyboard.press(keys);
    await expect(listening).toBeVisible();
  }
  expect((await snapshot(app)).app.shortcuts.type).toBe("Alt+Shift+Space");
  // The ⌘ ones went on to the app as if nothing listened (so ⌘Q would quit); ⇧A was kept from it.
  const passed = await settings.evaluate(() => (window as unknown as { passed: { code: string; prevented: boolean }[] }).passed);
  expect(passed.filter(({ code }) => code.startsWith("Key"))).toEqual([
    { code: "KeyW", prevented: false },
    { code: "KeyZ", prevented: false },
  ]);
  // A whole shortcut, with ⌃ or ⌥, is then recorded.
  await settings.keyboard.press("Control+Alt+K");
  await expect.poll(async () => (await snapshot(app)).app.shortcuts.type).toBe("Control+Alt+K");
  await expect(row.getByText("⌃⌥K", { exact: true })).toBeVisible();
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

// ---- ⌥⇧Z: Undo the last filing, from any app ----

/** The Undone card's note, under the default evening review at 21:00: what a take-back tells. */
const UNDONE_NOTE = "Your words are back in the inbox for the evening review at 21:00.";

/** ⌥⇧Z, pressed as the person would: the callback the shortcut stand-in holds for it runs. False when it holds none. */
const pressUndo = (app: ElectronApplication) => call(app, "pressShortcutForTests", "undo") as Promise<boolean>;

/** A thought filed and its card put away: only the menu and ⌥⇧Z offer to take it back now. */
async function filedAndPutAway(app: ElectronApplication): Promise<void> {
  await filedFromTheCapsule(app);
  await call(app, "dismiss");
}

test("⌥⇧Z takes the last filing back, as the menu's Undo does, and says so once", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await launchOn(library);
  await watchUndos(app);
  await filedAndPutAway(app);
  expect(await pressUndo(app)).toBe(true);
  await expect.poll(() => undoCalls(app), { timeout: 10_000 }).toBe(1);
  await expect.poll(() => notified(app, "Undone"), { timeout: 10_000 }).toEqual([{ title: "Undone", body: UNDONE_NOTE }]);
  // The page is gone, and the note is back in the inbox.
  expect(undone(library)).toHaveLength(1);
  expect(inbox(library)).toHaveLength(1);
  // Nothing is left to take back: a second press says so, and asks the library for nothing.
  expect(await pressUndo(app)).toBe(true);
  expect(await capsuleState(app)).toEqual({ kind: "nothing-to-undo" });
  expect(await undoCalls(app)).toBe(1);
  expect(await notified(app, "Undone")).toHaveLength(1);
  await app.close();
});

for (const relaunched of [false, true]) {
  test(`⌥⇧Z pressed twice while its take-back waits answers once${relaunched ? ", after a relaunch" : ""}: no bar, one take-back, told once`, async () => {
    const library = await makeLibrary({ git: true });
    const first = await launchOn(library);
    await filedFromTheCapsule(first.app);
    let app = first.app;
    if (relaunched) {
      // The filing was kept in the app's profile: the new run offers it, with nothing up.
      await first.app.close();
      ({ app } = await launchOn(library, { AVANZEL_USER_DATA: first.userData }));
      await expect.poll(() => menuItem(app, "undo-filing"), { timeout: 20_000 }).toBeDefined();
      expect(await capsuleKind(app)).toBe("hidden");
    }
    await watchUndos(app, { hold: true });
    expect(await pressUndo(app)).toBe(true);
    await expect.poll(() => reachedUndo(app), { timeout: 10_000 }).toBe(true);
    // The take-back waits at the library's door, and the card it will tell is still up. A second press would put the bar over that
    // card, and the take-back would then tell by notification.
    expect(await pressUndo(app)).toBe(true);
    expect(await capsuleKind(app)).toBe(relaunched ? "hidden" : "filed");
    expect(await undoCalls(app)).toBe(1);
    await app.evaluate(() => (globalThis as Left).letUndoIn?.());
    if (relaunched) {
      await expect.poll(() => notified(app, "Undone"), { timeout: 10_000 }).toEqual([{ title: "Undone", body: UNDONE_NOTE }]);
      expect(await capsuleKind(app)).toBe("hidden");
    } else {
      await expect.poll(() => capsuleState(app), { timeout: 10_000 }).toMatchObject({ kind: "saved", undone: true });
      expect(await notified(app, "Undone")).toEqual([]);
    }
    expect(await undoCalls(app)).toBe(1);
    await app.close();
  });
}

test("with a filing to undo, ⌥⇧Z during a recording takes it back, leaves the recording's card, and its notification is silent", async () => {
  const library = await makeLibrary({ git: true });
  const { app } = await launchOn(library);
  await watchUndos(app);
  await filedAndPutAway(app);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 10_000 }).toBe("listening");
  expect(await pressUndo(app)).toBe(true);
  await expect.poll(() => undoCalls(app), { timeout: 10_000 }).toBe(1);
  // macOS's sound for the notification would be heard in the words: the recorder keeps no echo cancellation.
  await expect.poll(() => notified(app, "Undone"), { timeout: 10_000 }).toEqual([{ title: "Undone", body: UNDONE_NOTE, silent: true }]);
  expect(await capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  await app.close();
});

test("while setup's window is open, ⌥⇧Z does nothing", async () => {
  const app = await launch(firstRun().env);
  await windowFor(app, "setup");
  expect(await call(app, "setupStepForTests")).toBe("hello"); // setup's first thought has its own Undo on screen
  expect(await pressUndo(app)).toBe(true);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await call(app, "notificationsForTests")).toEqual([]);
  await app.close();
});

test("with nothing to undo, ⌥⇧Z says so in a calm bar that goes by itself", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const capsule = await windowFor(app, "capsule");
  expect(await pressUndo(app)).toBe(true);
  expect(await capsuleState(app)).toEqual({ kind: "nothing-to-undo" });
  await expect(capsule.getByRole("status").getByText("There's no filing to undo.", { exact: true })).toBeVisible();
  await expect(zel(capsule)).toHaveAttribute("data-mood", "filed");
  await expect(capsule.getByRole("button")).toHaveCount(0);
  expect(await call(app, "notificationsForTests")).toEqual([]);
  await snap(capsule, "capsule-nothing-to-undo");
  await expect.poll(() => capsuleKind(app), { timeout: 8_000 }).toBe("hidden");
  await app.close();
});

// A Stopped card that says the stopped run's edits stay is the one place the person is told, so it is not a finished card
// (`showsFinishedCard`): the bar does not replace it. A Stopped card with nothing more to say is replaced.
test("with nothing to undo, ⌥⇧Z leaves a Stopped card that says edits stay, and replaces one with nothing more to say", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const stopped = (partial: boolean, leftovers: number) => ({ kind: "cancelled", text: "Call the plumber on Monday", agent: "Claude Code", partial, leftovers, review: "at 21:00" });
  for (const [name, card] of [
    ["a commit of the stopped run that stays", stopped(true, 0)],
    ["two edits that no commit holds", stopped(false, 2)],
  ] as const) {
    await call(app, "setCapsule", card);
    expect(await pressUndo(app), name).toBe(true);
    expect(await capsuleState(app), name).toEqual(card);
  }
  await call(app, "setCapsule", stopped(false, 0));
  expect(await pressUndo(app)).toBe(true);
  expect(await capsuleState(app)).toEqual({ kind: "nothing-to-undo" });
  await app.close();
});

test("while a filing or a review runs, or over a recording, ⌥⇧Z does nothing", async () => {
  // A recording, then its filing, which the fake agent holds for 3 s.
  const { app } = await launchOn(await makeLibrary({ git: true }), { FAKE_AGENT_DELAY_MS: "3000" });
  await watchUndos(app);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 10_000 }).toBe("listening");
  expect(await pressUndo(app)).toBe(true);
  expect(await capsuleKind(app)).toBe("listening");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 10_000 }).toBe("filing");
  expect(await pressUndo(app)).toBe(true);
  expect(await capsuleKind(app)).toBe("filing");
  expect(await undoCalls(app)).toBe(0);
  await app.close();

  // The evening review, with a note in the inbox to file, shows no card: the press does nothing while it works all the same.
  const library = await makeLibrary({ git: true });
  new Vault(library).newCapture("An earlier thought", { source: "text" });
  const review = await launchOn(library, { FAKE_AGENT_DELAY_MS: "3000" });
  await call(review.app, "runTask", "evening-review");
  expect(await pressUndo(review.app)).toBe(true);
  expect(await capsuleKind(review.app)).toBe("hidden");
  await review.app.close();
});

// Words filed again after an edit are in flight until the work that files them has its turn (`settleEdit`): they are in neither
// `queuedToFile` nor `runs` meanwhile, and once their card is put away nothing shows them. Only `capturing` says so (B1), and the bar
// must not say that there is no filing while a thought waits to be filed.
test("with nothing to undo, ⌥⇧Z does nothing while words filed again after an edit wait for their turn, their card put away", async () => {
  const { app } = await launchOn(await makeLibrary({ git: true }), { FAKE_AGENT_DELAY_MS: "3000" });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await call(app, "edit"); // Edit stops its run, and the editor opens
  await call(app, "idleForTests"); // the stopped run is over
  await holdTheQueue(app); // the corrected words wait for their turn
  await call(app, "submitEdit", "Plant tulips in late October");
  expect(await capsuleState(app)).toMatchObject({ kind: "filing", waiting: true });
  await call(app, "dismiss"); // their card is put away: nothing shows the thought now
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await pressUndo(app)).toBe(true);
  expect(await capsuleKind(app)).toBe("hidden");
  await letTheQueueGo(app);
  await app.close();
});

// A library that has just opened has its saved Undo checked against its git (`checkUndo`), and until that ends no filing is offered
// (`undoChecked`) though one may be about to be: the bar must not say that there is none. The check is held at its door.
test("⌥⇧Z says nothing while the saved Undo of the library just opened is being checked, and answers once it is", async () => {
  const config = mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")); // the library that opens is remembered here, not in ~/.config
  const { app } = await launchOn(await makeLibrary({ git: true }), { XDG_CONFIG_HOME: config });
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: { checkUndo(vault: unknown): Promise<void> } }).__avanzel;
    const checkUndo = controller.checkUndo.bind(controller);
    controller.checkUndo = async (vault) => {
      await new Promise<void>((resolve) => Object.assign(globalThis, { letTheCheckIn: resolve }));
      return checkUndo(vault);
    };
  });
  await call(app, "useLibrary", await makeLibrary({ git: true })); // another library opens, and its check waits
  expect(await call(app, "undoChecked")).toBe(false);
  expect(await pressUndo(app)).toBe(true);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.evaluate(() => (globalThis as { letTheCheckIn?: () => void }).letTheCheckIn?.());
  await expect.poll(() => call(app, "undoChecked"), { timeout: 10_000 }).toBe(true);
  expect(await pressUndo(app)).toBe(true);
  expect(await capsuleState(app)).toEqual({ kind: "nothing-to-undo" });
  await app.close();
});

test("Undo the last filing has its row in Settings → Voice, recorded and saved like the others", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app, "Voice");
  const row = settings.getByRole("group", { name: "Undo the last filing", exact: true });
  await expect(row.getByText("⌥⇧Z", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Change", exact: true }).click();
  await settings.keyboard.press("Control+Alt+U");
  await expect.poll(async () => (await snapshot(app)).app.shortcuts.undo).toBe("Control+Alt+U");
  await expect(row.getByText("⌃⌥U", { exact: true })).toBeVisible();
  // The new shortcut is registered: a press of it is heard.
  await expect.poll(() => pressUndo(app)).toBe(true);
  await app.close();
});

test("a taken ⌥⇧Z gets the launch notice, with ⌃⌥Z and ⌃⌥U, and says where its item is", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Shift+Z" });
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText(/⌥⇧Z is used by another app/)).toBeVisible();
  await expect(capsule.getByText("Pick another shortcut. “Undo the last filing” is in the menu bar after each filing.", { exact: true })).toBeVisible();
  // Hide first; the best one last, as the primary.
  await expect(capsule.getByRole("button")).toHaveText(["Hide", "Use ⌃⌥U", "Use ⌃⌥Z"]);
  // Settings → Voice keeps the problem, and says of the item what the capsule does: it is in the menu after a filing, not "still" there.
  await call(app, "showSettings", "voice");
  const settings = await windowFor(app, "settings");
  await expect(settings.getByText(/⌥⇧Z is used by another app.* Pick another shortcut\./)).toBeVisible();
  await expect(settings.getByText("“Undo the last filing” is in the menu bar after each filing.", { exact: true })).toBeVisible();
  await capsule.getByRole("button", { name: "Use ⌃⌥Z" }).click();
  await expect(capsule.getByRole("status").getByText("Undo the last filing now uses ⌃⌥Z", { exact: true })).toBeVisible();
  expect((await snapshot(app)).app.shortcuts.undo).toBe("Control+Alt+Z");
  await app.close();
});
