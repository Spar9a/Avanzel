// The Settings window, built from @avanzel/ui: its toolbar, and each pane's controls.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { answerMenus, call, launch, makeLibrary, openedWith, openSettings, shownMenus, snap, stubOpening, stubPicker } from "./helpers.ts";

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

test("the microphone's Choose… lists System default first, and saves the choice", async () => {
  // The saved microphone is one this Mac has never listed, as when a USB microphone is unplugged.
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ version: 1, microphoneId: "gone" }));
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData });
  const settings = await openSettings(app, "Voice");
  const choose = settings.getByRole("group", { name: "Microphone" }).getByRole("button", { name: "Choose…" });
  await expect(settings.getByText("Microphone not connected", { exact: true })).toBeVisible();
  await expect(settings.getByText("Avanzel listens only while the capsule shows it listening.", { exact: true })).toBeVisible();
  await choose.scrollIntoViewIfNeeded(); // the group is under Voice's other groups, below the window's fold
  await snap(settings, "settings-voice-microphone");

  // A menu that closes without a pick saves nothing.
  await answerMenus(app, null);
  await choose.click();
  await expect.poll(() => shownMenus(app)).toHaveLength(1);
  const [closed] = await shownMenus(app);
  expect(closed![0]).toEqual({ label: "System default", checked: false });
  expect(closed!.some((item) => item.checked)).toBe(false); // the microphone in use isn't in the list
  expect((await snapshot(app)).app.microphoneId).toBe("gone");
  await expect(settings.getByText("Microphone not connected", { exact: true })).toBeVisible();

  // Picking System default saves it, and the row says so.
  await answerMenus(app, "System default");
  await choose.click();
  await expect.poll(() => shownMenus(app)).toHaveLength(1);
  await expect.poll(async () => (await snapshot(app)).app.microphoneId).toBe(null);
  await expect(settings.getByText("System default", { exact: true })).toBeVisible();
  await expect(settings.getByText("Microphone not connected", { exact: true })).toHaveCount(0);

  // The next menu checks the one in use.
  await answerMenus(app, null);
  await choose.click();
  await expect.poll(() => shownMenus(app)).toHaveLength(1);
  expect((await shownMenus(app))[0]![0]).toEqual({ label: "System default", checked: true });
  await app.close();
});

/** What the next test leaves in the Settings page: the way to answer enumerateDevices, and whether the row ever said "gone". */
interface DeviceProbe {
  answer(): void;
  saidMissing: boolean;
}

test("the microphone row doesn't call a connected microphone missing while the devices are still being listed", async () => {
  // The saved microphone is plugged in: the list the page is given, once it comes, names it.
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ version: 1, microphoneId: "studio" }));
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData });
  const settings = await openSettings(app);
  // From here the page's enumerateDevices answers only when the test says. A recorder notes whether the row ever said
  // "Microphone not connected": it is told of every change to the page, so even a single frame of it counts.
  await settings.evaluate(() => {
    const probe = window as unknown as DeviceProbe;
    probe.saidMissing = false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes("Microphone not connected")) probe.saidMissing = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
    navigator.mediaDevices.enumerateDevices = () =>
      new Promise((resolve) => {
        probe.answer = () => resolve([{ kind: "audioinput", deviceId: "studio", label: "Studio microphone" }] as MediaDeviceInfo[]);
      });
  });
  await settings.getByRole("radio", { name: "Voice", exact: true }).click();
  // The page has asked and hasn't been answered: the row has no name to show, and doesn't say the microphone is gone.
  await expect.poll(() => settings.evaluate(() => typeof (window as unknown as DeviceProbe).answer)).toBe("function");
  await expect(settings.getByText("Avanzel listens only while the capsule shows it listening.", { exact: true })).toBeVisible();
  await expect(settings.getByText("Microphone not connected", { exact: true })).toHaveCount(0);
  // Answered, the row names it, and it never said otherwise.
  await settings.evaluate(() => (window as unknown as DeviceProbe).answer());
  await expect(settings.getByText("Studio microphone", { exact: true })).toBeVisible();
  expect(await settings.evaluate(() => (window as unknown as DeviceProbe).saidMissing)).toBe(false);
  await app.close();
});
