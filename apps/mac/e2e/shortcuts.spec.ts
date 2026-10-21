// A shortcut another app holds (AVANZEL_FAKE_TAKEN_SHORTCUTS stands in for those apps): the capsule names it at launch
// with two free ones to pick, the menu stops showing it, and Settings → Voice offers the same free ones.
import { expect, test, type ElectronApplication } from "@playwright/test";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { call, capsuleKind, launch, makeLibrary, snap, windowFor } from "./helpers.ts";

const snapshot = async (app: ElectronApplication) => (await call(app, "snapshot")) as SettingsSnapshot;

/** The menu's Record a thought item. */
const recordItem = async (app: ElectronApplication) =>
  ((await call(app, "menuForTests")) as MenuItemModel[]).find((item) => item.type === "item" && item.action === "dictate");

test("a taken ⌥Space is named at launch, and a free one can be picked", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space" });
  const capsule = await windowFor(app, "capsule");
  await expect(capsule.getByText(/⌥Space is used by another app/)).toBeVisible();
  await expect(capsule.getByText("Pick another shortcut. Record a thought is still in the menu bar.")).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Use ⌃⇧Space" })).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Use ⌃⌥R" })).toBeVisible();
  // Hide first; the best one last, as the primary.
  await expect(capsule.getByRole("button")).toHaveText(["Hide", "Use ⌃⌥R", "Use ⌃⇧Space"]);
  await expect(capsule.getByRole("button", { name: "Use ⌃⇧Space" })).toHaveAttribute("data-variant", "primary");
  expect(await recordItem(app)).not.toHaveProperty("accelerator");
  await snap(capsule, "capsule-shortcut-taken");

  await capsule.getByRole("button", { name: "Use ⌃⌥R" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  const after = await snapshot(app);
  expect(after.app.shortcuts.dictate).toBe("Control+Alt+R");
  expect(after.shortcutProblems).toEqual({});
  expect(await recordItem(app)).toMatchObject({ accelerator: "Control+Alt+R" });
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
