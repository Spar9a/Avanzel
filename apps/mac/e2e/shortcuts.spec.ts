// A shortcut another app holds (AVANZEL_FAKE_TAKEN_SHORTCUTS stands in for those apps): the capsule names it at launch
// with two free ones to pick, the menu stops showing it, and Settings → Voice offers the same free ones.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { CapsuleState, SettingsSnapshot } from "../src/shared/ipc.ts";
import { call, capsuleKind, launch, makeLibrary, snap, windowFor } from "./helpers.ts";

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
  // The best one first.
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveText(["Use ⌃⇧Space", "Use ⌃⌥R"]);
  await snap(settings, "settings-shortcut-taken");

  await settings.getByRole("button", { name: "Use ⌃⇧Space" }).click();
  // The capsule's notice goes too: that shortcut works now.
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  const after = await snapshot(app);
  expect(after.app.shortcuts.dictate).toBe("Control+Shift+Space");
  expect(after.shortcutProblems).toEqual({});
  await expect(settings.getByRole("button", { name: /^Use / })).toHaveCount(0);
  await expect(settings.getByText(/is used by another app/)).toHaveCount(0);
  // The buttons went with the pick, so the focus is on the shortcut it changed.
  await expect(settings.getByRole("button", { name: "Record a thought shortcut" })).toBeFocused();
  await expect(settings.getByRole("button", { name: "Record a thought shortcut" })).toHaveText("⌃⇧Space");
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
  // Its body would point at a Record a thought the menu doesn't have yet; Settings opens on its own instead.
  expect(await capsuleKind(app)).toBe("hidden");
  const settings = await windowFor(app, "settings");
  await settings.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Use ⌃⇧Space" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Use ⌃⌥R" })).toBeVisible();
  await app.close();
});
