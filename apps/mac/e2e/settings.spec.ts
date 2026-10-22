// The Settings window, built from @avanzel/ui: its toolbar, and each pane's controls.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { call, launch, makeLibrary, openedWith, openSettings, snap, stubOpening, stubPicker } from "./helpers.ts";

/** What Settings is sent now. */
const snapshot = async (app: ElectronApplication) => (await call(app, "snapshot")) as SettingsSnapshot;

const PANES = ["General", "Voice", "Agents", "Reviews", "Privacy"];

test("Settings moves between its five panes on its toolbar, by click and by the arrow keys", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app);
  await expect(settings.getByRole("radiogroup", { name: "Section" }).getByRole("radio")).toHaveText(PANES);
  for (const pane of PANES) {
    const radio = settings.getByRole("radio", { name: pane, exact: true });
    await radio.click();
    await expect(radio).toHaveAttribute("aria-checked", "true");
    await expect(settings.getByRole("heading", { name: pane, exact: true })).toBeVisible();
    await snap(settings, `settings-${pane.toLowerCase()}`);
  }
  // The arrow keys move along the toolbar, as in any segmented control, and the pane follows.
  const general = settings.getByRole("radio", { name: "General", exact: true });
  await general.click();
  await general.press("ArrowRight");
  const voice = settings.getByRole("radio", { name: "Voice", exact: true });
  await expect(voice).toHaveAttribute("aria-checked", "true");
  await expect(voice).toBeFocused();
  await expect(settings.getByRole("heading", { name: "Voice", exact: true })).toBeVisible();
  // The toolbar has no place for Tools & MCP, which offered nothing yet.
  await expect(settings.getByText("Tools & MCP")).toHaveCount(0);
  await app.close();
});

test("General shows the library with its shelves, and each of its controls applies at once", async () => {
  const library = await makeLibrary({ git: true });
  for (const page of ["goals/a.md", "ideas/b.md", "ideas/c.md"]) writeFileSync(path.join(library, page), "# A page\n");
  const other = await makeLibrary();
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
  const settings = await openSettings(app);
  await expect(settings.getByText("3 pages on six shelves. Every change is a commit you can undo.", { exact: true })).toBeVisible();
  for (const shelf of ["Goals", "Ideas", "Problems", "Memories", "People", "Topics"]) {
    await expect(settings.getByText(shelf, { exact: true })).toBeVisible();
  }
  await settings.getByRole("radio", { name: "Tonight", exact: true }).click();
  await expect.poll(async () => (await snapshot(app)).app.fileMode).toBe("evening");
  await settings.getByRole("switch", { name: "Open Avanzel when you log in" }).click();
  await expect.poll(async () => (await snapshot(app)).app.launchAtLogin).toBe(true);
  await stubOpening(app);
  await settings.getByRole("button", { name: "Show in Finder" }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect((await openedWith(app)).map((opened) => realpathSync(opened))).toEqual([realpathSync(library)]);
  // Obsidian hasn't opened this library: it has no .obsidian folder.
  await expect(settings.getByRole("button", { name: "Open in Obsidian" })).toHaveCount(0);
  await stubPicker(app, other);
  await settings.getByRole("button", { name: "Change…" }).click();
  await expect.poll(async () => (await snapshot(app)).library?.path).toBe(other);
  await expect(
    settings.getByText("Your first thought will fill a shelf. This folder has no git history, so changes can't be undone.", { exact: true }),
  ).toBeVisible();
  await app.close();
});

test("Open in Obsidian shows only for a library Obsidian has opened, and opens it there", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  // Obsidian is installed (a stand-in answers for its links), and has opened the library: it has an .obsidian folder.
  mkdirSync(path.join(library, ".obsidian"));
  await app.evaluate((electron) => {
    electron.app.getApplicationNameForProtocol = () => "Obsidian";
  });
  const settings = await openSettings(app);
  await stubOpening(app);
  await settings.getByRole("button", { name: "Open in Obsidian" }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  const [url = ""] = await openedWith(app);
  expect(url).toMatch(/^obsidian:\/\/open\?path=/);
  expect(realpathSync(decodeURIComponent(url.slice("obsidian://open?path=".length)))).toBe(realpathSync(library));
  await app.close();
});
