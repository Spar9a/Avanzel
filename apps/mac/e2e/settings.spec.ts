// The Settings window, built from @avanzel/ui: its toolbar, and each pane's controls.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import {
  agentCalls,
  answerDialogs,
  answerMenus,
  audioContexts,
  call,
  emptyHfCache,
  launch,
  makeLibrary,
  muteWindows,
  openedWith,
  openSettings,
  played,
  read,
  shownMenus,
  snap,
  stubOpening,
  stubPicker,
  watchAudioContexts,
  windowFor,
} from "./helpers.ts";

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
  // Quiet is for dismissing: Change… is one more way to act on the library, as Show in Finder is.
  await expect(settings.getByRole("button", { name: "Change…" })).toHaveAttribute("data-variant", "secondary");
  await settings.getByRole("button", { name: "Change…" }).click();
  await expect.poll(async () => (await snapshot(app)).library?.path).toBe(other);
  await expect(
    settings.getByText("Your first thought will fill a shelf. This folder has no git history, so changes can't be undone.", { exact: true }),
  ).toBeVisible();
  await app.close();
});

test("Settings has Play sounds, off, in a group of its own before Startup, and switching it on plays the Stamp", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app);
  await muteWindows(app); // the page plays all the same; the Mac it runs on does not hear it
  await settings.evaluate(watchAudioContexts);
  expect((await settings.getByRole("heading", { level: 3 }).allTextContents()).slice(-2)).toEqual(["Sounds", "Startup"]);
  const sounds = settings.getByRole("switch", { name: "Play sounds" });
  await expect(sounds).toHaveAttribute("aria-checked", "false");
  await expect(sounds).toHaveAccessibleDescription(
    "A soft tick when you start and stop, a stamp when a card is filed, and two notes when the evening review is done.",
  );
  expect((await snapshot(app)).app.sounds).toBe(false);
  expect(await played(settings)).toEqual([]);
  // On: saved, and the Stamp is played, as the sign that it is on.
  await sounds.click();
  await expect.poll(async () => (await snapshot(app)).app.sounds).toBe(true);
  await expect(sounds).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => played(settings)).toEqual(["stamp"]);
  expect(await audioContexts(settings)).toHaveLength(1);
  // Off: saved, nothing is played, and the page lets go of its audio device.
  await sounds.click();
  await expect.poll(async () => (await snapshot(app)).app.sounds).toBe(false);
  await expect(sounds).toHaveAttribute("aria-checked", "false");
  expect(await played(settings)).toEqual(["stamp"]);
  await expect.poll(() => audioContexts(settings)).toEqual(["closed"]);
  await app.close();
});

test("Settings is sent a fresh snapshot when it has the focus again, and reading it asks no agent anything", async () => {
  const library = await makeLibrary();
  const record = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-record-")), "runs.jsonl");
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_RECORD: record });
  const settings = await openSettings(app);
  await expect(
    settings.getByText("Your first thought will fill a shelf. This folder has no git history, so changes can't be undone.", { exact: true }),
  ).toBeVisible();
  const before = await agentCalls(app);
  // Something outside Avanzel changes what Settings shows, a page landing on a shelf, and the person comes back to Settings:
  // the window has the focus again, as setup's has when they come back from Terminal.
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/settings/"))?.emit("focus");
  });
  await expect(settings.getByText("1 page on six shelves. This folder has no git history, so changes can't be undone.", { exact: true })).toBeVisible();
  // The refresh only reads: no agent's sign-in was read, and the library's agent was asked nothing, since each costs quota.
  expect(await agentCalls(app)).toEqual(before);
  expect(existsSync(record)).toBe(false);
  await app.close();
});

test("General says when Tonight files only while the evening review is on, and offers to turn it on", async () => {
  const library = await makeLibrary();
  // The evening review is off.
  const evening = path.join(library, "tasks", "evening-review.md");
  writeFileSync(evening, readFileSync(evening, "utf8").replace("enabled: true", "enabled: false"));
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app);
  await expect(
    settings.getByText("Right away uses your agent now. Tonight keeps new thoughts in the inbox until the evening review runs.", { exact: true }),
  ).toBeVisible();
  const notice = settings.getByRole("status").filter({ hasText: "The evening review is off, so new thoughts stay in the inbox." });
  await expect(notice).toHaveCount(0); // Right away files now: nothing waits for the review
  // Tonight, with the review off: a Notice says where the thoughts stay, that they are safe, and offers its one fix.
  await settings.getByRole("radio", { name: "Tonight", exact: true }).click();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("They're safe there.");
  const turnOn = notice.getByRole("button", { name: "Turn on the evening review", exact: true });
  await expect(turnOn).toHaveAttribute("data-variant", "primary");
  await snap(settings, "settings-general-evening-off");
  await turnOn.click();
  await expect.poll(() => readFileSync(evening, "utf8")).toContain("enabled: true");
  await expect(notice).toHaveCount(0);
  // On, daily: Tonight says when it files.
  await expect(settings.getByText("Right away uses your agent now. Tonight waits for the evening review at 21:00.", { exact: true })).toBeVisible();
  expect((await snapshot(app)).app.fileMode).toBe("evening");
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
  const choose = settings.getByRole("group", { name: /^Microphone: / }).getByRole("button", { name: "Choose…" });
  await expect(settings.getByText("Microphone not connected", { exact: true })).toBeVisible();
  // Choose…'s group says the microphone in use, so VoiceOver hears it beside the button.
  await expect(settings.getByRole("group", { name: "Microphone: Microphone not connected", exact: true })).toBeVisible();
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
  await expect(settings.getByRole("group", { name: "Microphone: System default", exact: true })).toBeVisible();

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

test("General says only what is true of the library's history: commits, automatic commits turned off, no git, and a Mac that can't run git", async () => {
  const commits = "Every change is a commit you can undo.";
  const noHistory = "This folder has no git history, so changes can't be undone.";
  const noGitHere = "This Mac has no git yet, so changes can't be undone.";
  const cases = [
    { git: true, autoCommit: true, usable: true, line: commits },
    // config.toml's auto_commit = false: git is there, and no change is a commit.
    { git: true, autoCommit: false, usable: true, line: "Automatic commits are off in this library's settings, so changes can't be undone from Avanzel." },
    // Without a .git folder there is no history, and nothing to turn off: the folder's own line, whatever the setting says.
    { git: false, autoCommit: false, usable: true, line: noHistory },
    // A .git folder on a Mac whose only git is Apple's stub (AVANZEL_GIT_USABLE=0 plays that Mac): the folder has its history, and this
    // Mac can't run git. No promise of Undo, and no claim that the folder has no history: it says what is true of the Mac.
    { git: true, autoCommit: true, usable: false, line: noGitHere },
    // Nothing commits there, whatever the library's settings say of automatic commits.
    { git: true, autoCommit: false, usable: false, line: noGitHere },
    // No .git folder, on a Mac without git: still the folder with no history.
    { git: false, autoCommit: true, usable: false, line: noHistory },
  ];
  for (const { git, autoCommit, usable, line } of cases) {
    const library = await makeLibrary({ git });
    writeFileSync(path.join(library, "goals", "a.md"), "# A page\n");
    saveSettings(library, { ...loadSettings(library), autoCommit });
    const app = await launch({ AVANZEL_LIBRARY: library, ...(usable ? {} : { AVANZEL_GIT_USABLE: "0" }) });
    const settings = await openSettings(app);
    await expect(settings.getByText(`1 page on six shelves. ${line}`, { exact: true })).toBeVisible();
    // The snapshot carries what the line is made from: whether the folder has a .git, whether this Mac can run git, and
    // whether the library commits by itself.
    expect((await snapshot(app)).library).toMatchObject({ isGit: git, gitUsable: usable, autoCommit });
    await app.close();
  }
});

test("General looks for git again each time Settings has the focus while this Mac has none, so an install is noticed", async () => {
  const library = await makeLibrary({ git: true });
  writeFileSync(path.join(library, "goals", "a.md"), "# A page\n");
  // AVANZEL_GIT_USABLE=0 plays a Mac whose only git is Apple's stub; the app keeps that answer until it is told to look again.
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_GIT_USABLE: "0" });
  const settings = await openSettings(app);
  await expect(settings.getByText("1 page on six shelves. This Mac has no git yet, so changes can't be undone.", { exact: true })).toBeVisible();
  // The person installs the Command Line Tools from Terminal (here: the stand-in is dropped, and this Mac's own git is read) and
  // comes back to Settings: the window has the focus again, and git is looked for afresh before the pane is drawn.
  await app.evaluate(({ BrowserWindow }) => {
    delete process.env.AVANZEL_GIT_USABLE;
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/settings/"))?.emit("focus");
  });
  await expect(settings.getByText("1 page on six shelves. Every change is a commit you can undo.", { exact: true })).toBeVisible();
  expect((await snapshot(app)).library).toMatchObject({ isGit: true, gitUsable: true });
  await app.close();
});

/** The Notice a change main refused is told in: one `alert` in the window, headed "That change wasn't saved.". */
const notSaved = (settings: Page) => settings.getByRole("alert").filter({ hasText: "That change wasn't saved." });

/** What it says when the disk won't take a write to the library's settings (the tasks/ folder's review files too), and what is safe. */
const LIBRARY_KEPT = "Avanzel can't write to the library's settings. The setting keeps its old value.";

test("a change that fails says so, with why, and the next change that works takes it away", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Agents");
  // The Notice tells a refusal, and the console has it too, so that a change that fails for a reason of the app's own, not of the
  // disk's, isn't only a Notice.
  const logged: string[] = [];
  settings.on("console", (message) => {
    if (message.type() === "error") logged.push(message.text());
  });
  const model = settings.getByRole("textbox", { name: "fake model", exact: true });
  const config = path.join(library, ".avanzel", "config.toml");
  const before = read(library, ".avanzel/config.toml");
  // Nothing can be written in .avanzel/ now, so the agent's model can't be saved, and the library's settings stay as they were.
  chmodSync(path.join(library, ".avanzel"), 0o555);
  try {
    await model.fill("small-model");
    await model.press("Enter");
    const problem = notSaved(settings);
    await expect(problem).toBeVisible();
    await expect(settings.getByRole("alert")).toHaveCount(1);
    // Why, in plain words and not Electron's or the system's: no "Error invoking remote method", no code, no temporary file's path;
    // and what is safe: the setting is as it was.
    await expect(problem.getByText("Avanzel can't write to the library's settings. The setting keeps its old value.", { exact: true })).toBeVisible();
    await expect(problem).not.toContainText("Error invoking remote method");
    await expect(problem).not.toContainText(/EACCES|\.tmp|\//);
    expect(readFileSync(config, "utf8")).toBe(before);
    await expect.poll(() => logged.join("\n")).toMatch(/EACCES: permission denied/);
    await snap(settings, "settings-change-failed");
    // It has no button of its own: it is told, and goes with the next change that works.
    await expect(problem.getByRole("button")).toHaveCount(0);
  } finally {
    chmodSync(path.join(library, ".avanzel"), 0o755);
  }
  await model.press("Enter");
  await expect.poll(() => readFileSync(config, "utf8")).toContain('fake = "small-model"');
  await expect(notSaved(settings)).toHaveCount(0);

  // It goes with a pane, too. The button's change is refused the same way, and leaving the pane takes the Notice away.
  chmodSync(path.join(library, ".avanzel"), 0o555);
  try {
    await settings.getByRole("button", { name: "Use automatic" }).click();
    await expect(notSaved(settings)).toBeVisible();
    await settings.getByRole("radio", { name: "General", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
    await expect(notSaved(settings)).toHaveCount(0);
    await settings.getByRole("radio", { name: "Agents", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
    await expect(notSaved(settings)).toHaveCount(0);
    expect(loadSettings(library).harness).toBe("fake"); // still the library's own choice
  } finally {
    chmodSync(path.join(library, ".avanzel"), 0o755);
  }
  await app.close();
});

test("a change the app can't keep says so wherever it is made, and stays as it was", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData });
  const settings = await openSettings(app);
  // A refusal that nothing catches is an unhandled rejection, which is how a change that failed used to go unheard.
  const unheard: string[] = [];
  settings.on("pageerror", (error) => unheard.push(error.message));
  // The app can't write a file of its own when a folder stands where the temporary file it writes first would go.
  const blockWriting = (file: string) => mkdirSync(path.join(userData, `${file}.tmp`));
  const allowWriting = (file: string) => rmSync(path.join(userData, `${file}.tmp`), { recursive: true });
  const problem = notSaved(settings);
  const refused = async () => {
    await expect(problem).toBeVisible();
    // The system's words without the file they name, then what is safe: the setting is as it was.
    await expect(problem.getByText("EISDIR: illegal operation on a directory. The setting keeps its old value.", { exact: true })).toBeVisible();
  };
  /** Shows `pane` by way of another, which takes the Notice of an earlier refusal away: the next one is then a new one. */
  const fresh = async (pane: string) => {
    await settings.getByRole("radio", { name: pane === "Privacy" ? "General" : "Privacy", exact: true }).click();
    await settings.getByRole("radio", { name: pane, exact: true }).click();
    await expect(settings.getByRole("heading", { name: pane, exact: true })).toBeVisible();
    await expect(problem).toHaveCount(0);
  };
  blockWriting("settings.json");
  blockWriting("run-state.json");

  // General: a switch, and the choice of when to file. Refused, so not kept: the control says so, and so does a snapshot taken now
  // (Settings is sent a fresh one when it has the focus again), instead of showing a change that never reached the file.
  const login = settings.getByRole("switch", { name: "Open Avanzel when you log in" });
  await login.click();
  await refused();
  await expect(login).toHaveAttribute("aria-checked", "false");
  expect((await snapshot(app)).app.launchAtLogin).toBe(false);
  await fresh("General");
  await settings.getByRole("radio", { name: "Tonight", exact: true }).click();
  await refused();
  await expect(settings.getByRole("radio", { name: "Right away", exact: true })).toHaveAttribute("aria-checked", "true");
  expect((await snapshot(app)).app.fileMode).toBe("now");

  // Voice: the microphone, and a shortcut.
  await fresh("Voice");
  await answerMenus(app, "System default");
  await settings.getByRole("group", { name: /^Microphone: / }).getByRole("button", { name: "Choose…" }).click();
  await refused();
  await fresh("Voice");
  const row = settings.getByRole("group", { name: "Type a thought", exact: true });
  await row.getByRole("button", { name: "Change", exact: true }).click();
  await settings.keyboard.press("Control+Alt+K");
  await refused();
  expect((await snapshot(app)).app.shortcuts.type).toBe("Alt+Shift+Space");
  await expect(row.getByText("⌥⇧Space", { exact: true })).toBeVisible();

  // Reviews: Run now first keeps when the review ran, in run-state.json, so with that file blocked the run doesn't start. It saves
  // no setting, so its Notice is headed by what didn't happen, and says why and no more.
  await fresh("Reviews");
  await answerDialogs(app, 0); // Run Now, each time it is pressed: Settings asks before it runs a review
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  await weekly.getByRole("button", { name: "Run now" }).click();
  const notStarted = settings.getByRole("alert").filter({ hasText: "Weekly review didn't start." });
  await expect(notStarted).toBeVisible();
  await expect(notStarted.getByText("EISDIR: illegal operation on a directory.", { exact: true })).toBeVisible();
  await expect(settings.getByRole("alert")).toHaveCount(1);
  await expect(settings.getByText("That change wasn't saved.")).toHaveCount(0);
  await expect(settings.getByText("The setting keeps its old value.")).toHaveCount(0);
  await expect(weekly.getByText("Not run yet.", { exact: true })).toBeVisible();

  // Once they can be written, the next change works, and the Notice goes with it, on the pane it is on.
  allowWriting("run-state.json");
  await weekly.getByRole("button", { name: "Run now" }).click();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await expect.poll(async () => (await snapshot(app)).tasks.find((task) => task.id === "weekly-review")?.lastRun ?? null).not.toBeNull();
  await call(app, "idleForTests");
  allowWriting("settings.json");
  await settings.getByRole("radio", { name: "General", exact: true }).click();
  await login.click();
  await expect.poll(async () => (await snapshot(app)).app.launchAtLogin).toBe(true);
  await expect(login).toHaveAttribute("aria-checked", "true");
  expect(unheard).toEqual([]);
  await app.close();
});

test("an app setting the disk won't take is told as Avanzel's own, in plain words", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData });
  const settings = await openSettings(app);
  // The temporary file the settings are written through is there already, and can't be written to.
  const tmp = path.join(userData, "settings.json.tmp");
  writeFileSync(tmp, "");
  chmodSync(tmp, 0o444);
  const login = settings.getByRole("switch", { name: "Open Avanzel when you log in" });
  try {
    await login.click();
    const problem = notSaved(settings);
    await expect(problem.getByText("Avanzel can't write to its own settings. The setting keeps its old value.", { exact: true })).toBeVisible();
    await expect(problem).not.toContainText(/EACCES|settings\.json|\.tmp/);
    await expect(login).toHaveAttribute("aria-checked", "false");
    expect((await snapshot(app)).app.launchAtLogin).toBe(false);
  } finally {
    rmSync(tmp, { force: true });
  }
  await app.close();
});

test("Play sounds that can't be saved is told, stays off and plays no Stamp, and works once the settings can be written", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData });
  const settings = await openSettings(app);
  await muteWindows(app);
  // The app can't write its settings when a folder stands where the temporary file it writes first would go.
  mkdirSync(path.join(userData, "settings.json.tmp"));
  const sounds = settings.getByRole("switch", { name: "Play sounds" });
  await sounds.click();
  await expect(notSaved(settings)).toBeVisible();
  await expect(sounds).toHaveAttribute("aria-checked", "false");
  expect((await snapshot(app)).app.sounds).toBe(false);
  expect(await played(settings), "the Stamp is the sign that sounds are on, and they are not").toEqual([]);
  rmSync(path.join(userData, "settings.json.tmp"), { recursive: true });
  await sounds.click();
  await expect.poll(async () => (await snapshot(app)).app.sounds).toBe(true);
  await expect(notSaved(settings)).toHaveCount(0);
  await expect.poll(() => played(settings)).toEqual(["stamp"]);
  await app.close();
});

test("Run now refused for lack of permission says that a file was refused, in a plain sentence, and no setting was saved", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData });
  const settings = await openSettings(app, "Reviews");
  await answerDialogs(app, 0); // Run Now
  // The file that keeps when a review last ran is written through a temporary file that is there already, and can't be written to.
  const tmp = path.join(userData, "run-state.json.tmp");
  writeFileSync(tmp, "");
  chmodSync(tmp, 0o444);
  try {
    await settings.getByRole("group", { name: "Weekly review", exact: true }).getByRole("button", { name: "Run now" }).click();
    const alert = settings.locator(".settings-problem").getByRole("alert");
    await expect(alert.getByText("Weekly review didn't start.", { exact: true })).toBeVisible();
    await expect(alert.getByText("Avanzel was refused access to a file it needs.", { exact: true })).toBeVisible();
    // No code and no file in it, and it saved no setting, so it says nothing of what a setting keeps.
    await expect(alert).not.toContainText(/EACCES|run-state|\.tmp|The setting keeps/);
    await expect(settings.getByRole("alert")).toHaveCount(1);
  } finally {
    rmSync(tmp, { force: true });
  }
  await app.close();
});

test("a refused change is told in a row above the pane, which stays in view however far the pane is scrolled, and keeps the control that failed in view", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Agents");
  // A window short enough that the pane scrolls, and the pane scrolled to its end, where the model field is.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/settings/"))?.setSize(680, 480);
  });
  const pane = settings.locator("main.settings-pane");
  await pane.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const scrolledTo = await pane.evaluate((el) => el.scrollTop);
  expect(scrolledTo, "the pane scrolls").toBeGreaterThan(0);
  const model = settings.getByRole("textbox", { name: "fake model", exact: true });
  await expect(model).toBeInViewport();
  chmodSync(path.join(library, ".avanzel"), 0o555);
  try {
    await model.fill("small-model");
    await model.press("Enter");
    const problem = notSaved(settings);
    await expect(problem).toBeVisible();
    // It is in a row of its own between the toolbar and the pane, in view, and not in the pane: the pane isn't scrolled up to it.
    await expect(pane.getByRole("alert")).toHaveCount(0);
    const notice = (await problem.boundingBox())!;
    const toolbar = (await settings.getByRole("radiogroup", { name: "Section" }).boundingBox())!;
    const paneBox = (await pane.boundingBox())!;
    expect(notice.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
    expect(notice.y + notice.height).toBeLessThanOrEqual(paneBox.y + 1);
    await expect(problem).toBeInViewport({ ratio: 1 });
    // The row took its height from the pane, which left the field, at the pane's end, below its fold. The pane is scrolled just
    // enough to show the field whole (down to it, never up to the Notice), with its own box, the border and the ring round the
    // input that has the focus: below the Notice's row and above the window's bottom edge, and it still has the focus.
    expect(await pane.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(scrolledTo);
    const input = (await model.boundingBox())!;
    const box = (await model.locator("xpath=..").boundingBox())!; // what the person sees as the field
    const inner = await settings.evaluate(() => window.innerHeight);
    expect(box.height, "the field's box is more than its input").toBeGreaterThan(input.height + 4);
    expect(box.y, "below the Notice's row").toBeGreaterThanOrEqual(notice.y + notice.height);
    expect(box.y + box.height, "the field's box is above the window's bottom edge").toBeLessThanOrEqual(inner);
    await expect(model).toBeFocused();
    // A pane that shows after it starts at its top, with the Notice gone. The field is put back as it was saved first: leaving it
    // with what it holds would save that again, and be refused again, as the press that leaves it is told on the pane it shows.
    await model.fill("");
    await settings.getByRole("radio", { name: "Voice", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Voice", exact: true })).toBeVisible();
    await expect(notSaved(settings)).toHaveCount(0);
  } finally {
    chmodSync(path.join(library, ".avanzel"), 0o755);
  }
  await app.close();
});

test("a call that saves nothing and is refused says what didn't happen in its own title, not that a change wasn't saved", async () => {
  const app = await launch({
    AVANZEL_LIBRARY: await makeLibrary(),
    AVANZEL_FAKE_PERMISSIONS: "microphone:not-determined",
    HF_HUB_CACHE: emptyHfCache(), // no speech model here, and none to fetch: the Voice pane offers Try again
  });
  await call(app, "snapshot"); // the app has started, and registered its handlers: these replace them
  // Main refuses each of these calls. The disk is full is all it has to say.
  await app.evaluate(({ ipcMain }) => {
    for (const channel of ["settings:check-agents", "settings:check-agent", "settings:request-permission", "settings:download-model"]) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        throw new Error("ENOSPC: no space left on device");
      });
    }
  });
  const settings = await openSettings(app, "Agents");
  // The window's own Notice, in its row: a pane may have Notices of its own (Voice's, for a model that didn't download).
  const told = async (title: string) => {
    const row = settings.locator(".settings-problem");
    await expect(row.getByRole("alert")).toHaveCount(1);
    await expect(row.getByText(title, { exact: true })).toBeVisible();
    await expect(row.getByText("The disk is full.", { exact: true })).toBeVisible();
    await expect(settings.getByText("That change wasn't saved.")).toHaveCount(0);
    await expect(settings.getByText("The setting keeps its old value.")).toHaveCount(0);
  };
  // The pane checks the agents' sign-ins as it opens.
  await told("The agents couldn't be checked.");
  await settings.getByRole("group", { name: "Claude Code", exact: true }).getByRole("button", { name: /^Check/ }).click();
  await told("Claude Code couldn't be checked.");
  await settings.getByRole("radio", { name: "Privacy", exact: true }).click();
  await settings.getByRole("button", { name: "Allow…", exact: true }).click();
  await told("Avanzel couldn't ask macOS.");
  await settings.getByRole("radio", { name: "Voice", exact: true }).click();
  await settings.getByRole("button", { name: "Try again", exact: true }).click();
  await told("The download didn't start.");
  await app.close();
});

test("a change that is refused after the person has gone to another pane is told on that pane, not lost", async () => {
  // The evening review is off, and a run of the weekly review holds the library for 6 s: a save waits behind it in the queue.
  const library = await makeLibrary();
  const evening = path.join(library, "tasks", "evening-review.md");
  writeFileSync(evening, readFileSync(evening, "utf8").replace("enabled: true", "enabled: false"));
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_DELAY_MS: "6000", FAKE_AGENT_DELAY_TASK: "review" });
  const settings = await openSettings(app, "Reviews");
  await answerDialogs(app, 0); // Run Now
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  await weekly.getByRole("button", { name: "Run now" }).click();
  await expect(weekly.getByText("Running now…", { exact: true })).toBeVisible();
  await settings.getByRole("radio", { name: "General", exact: true }).click();
  await settings.getByRole("radio", { name: "Tonight", exact: true }).click();
  chmodSync(path.join(library, "tasks"), 0o555);
  try {
    // Turn on waits behind the run; the person goes on to Privacy meanwhile, where nothing mentions a review.
    await settings.getByRole("button", { name: "Turn on the evening review", exact: true }).click();
    await settings.getByRole("radio", { name: "Privacy", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
    await expect(notSaved(settings)).toHaveCount(0); // not yet: the run still has the library
    // The run ends, the save is tried and refused, and the Notice is on the pane they are on.
    await expect(notSaved(settings)).toBeVisible({ timeout: 20_000 });
    await expect(notSaved(settings).getByText(LIBRARY_KEPT, { exact: true })).toBeVisible();
    expect(readFileSync(evening, "utf8")).toContain("enabled: false");
    // Told where they were, and told once: General had gone when it was refused, and the evening review doesn't say it again.
    await settings.getByRole("radio", { name: "Reviews", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Reviews", exact: true })).toBeVisible();
    await expect(settings.getByRole("alert")).toHaveCount(0);
  } finally {
    chmodSync(path.join(library, "tasks"), 0o755);
  }
  await app.close();
});

test("a save refused as the person presses another tab is told on that tab, and goes with the next move", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Agents");
  const model = settings.getByRole("textbox", { name: "fake model", exact: true });
  chmodSync(path.join(library, ".avanzel"), 0o555);
  try {
    // A model typed is saved as its field loses the focus, which pressing a tab does. The press is held, as a person's is: long
    // enough for the refusal to come in while it lasts, on the pane they are leaving, and before the tab has been shown.
    await model.fill("small-model");
    const general = settings.getByRole("radio", { name: "General", exact: true });
    const at = (await general.boundingBox())!;
    await settings.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await settings.mouse.down();
    await expect(notSaved(settings)).toBeVisible();
    await settings.mouse.up();
    await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
    // They had not seen it: the switch doesn't take it away, and it is told on the pane they are on.
    await expect(notSaved(settings)).toBeVisible();
    await expect(notSaved(settings).getByText(LIBRARY_KEPT, { exact: true })).toBeVisible();
    // The next press of a tab does.
    await settings.getByRole("radio", { name: "Voice", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Voice", exact: true })).toBeVisible();
    await expect(notSaved(settings)).toHaveCount(0);
  } finally {
    chmodSync(path.join(library, ".avanzel"), 0o755);
  }
  await app.close();
});

test("a press that leaves its tab shows no pane, and the next move still takes the problem away", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Agents");
  chmodSync(path.join(library, ".avanzel"), 0o555);
  try {
    // Pressed on the Voice tab, and let go over the pane: no click, so no pane.
    const voice = settings.getByRole("radio", { name: "Voice", exact: true });
    const at = (await voice.boundingBox())!;
    await settings.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await settings.mouse.down();
    await settings.mouse.move(at.x + at.width / 2, at.y + 300);
    await settings.mouse.up();
    await expect(settings.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
    // A refusal is told, and a move by the keyboard takes it away, as it always does.
    await settings.getByRole("button", { name: "Use automatic" }).click();
    await expect(notSaved(settings)).toBeVisible();
    await settings.getByRole("radio", { name: "Agents", exact: true }).press("ArrowRight");
    await expect(settings.getByRole("heading", { name: "Reviews", exact: true })).toBeVisible();
    await expect(notSaved(settings)).toHaveCount(0);
  } finally {
    chmodSync(path.join(library, ".avanzel"), 0o755);
  }
  await app.close();
});

test("Turn on the evening review that fails says so in General, and the review stays off", async () => {
  const library = await makeLibrary();
  // The evening review is off, and Tonight waits for it.
  const evening = path.join(library, "tasks", "evening-review.md");
  writeFileSync(evening, readFileSync(evening, "utf8").replace("enabled: true", "enabled: false"));
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app);
  await settings.getByRole("radio", { name: "Tonight", exact: true }).click();
  const notice = settings.getByRole("status").filter({ hasText: "The evening review is off, so new thoughts stay in the inbox." });
  const turnOn = notice.getByRole("button", { name: "Turn on the evening review", exact: true });
  // Nothing can be written in tasks/ now, so the review's file can't be saved.
  chmodSync(path.join(library, "tasks"), 0o555);
  try {
    await turnOn.click();
    const problem = notSaved(settings);
    await expect(problem).toBeVisible();
    await expect(problem.getByText(LIBRARY_KEPT, { exact: true })).toBeVisible();
    await expect(settings.getByRole("alert")).toHaveCount(1);
    expect(readFileSync(evening, "utf8")).toContain("enabled: false");
    await expect(notice).toBeVisible(); // still off, and still offered
    await expect(turnOn).not.toHaveAttribute("aria-busy", "true"); // the save is over: Turn on can be pressed again
    // Told once: General's Notice has said it, so the evening review on Reviews doesn't say it again under itself.
    await settings.getByRole("radio", { name: "Reviews", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Reviews", exact: true })).toBeVisible();
    await expect(settings.getByRole("group", { name: "Evening review", exact: true })).toBeVisible();
    await expect(settings.getByRole("alert")).toHaveCount(0);
    await settings.getByRole("radio", { name: "General", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  } finally {
    chmodSync(path.join(library, "tasks"), 0o755);
  }
  // Pressed again once it can be written: the review is on, and the Notice goes with the change that worked.
  await turnOn.click();
  await expect.poll(() => readFileSync(evening, "utf8")).toContain("enabled: true");
  await expect(notSaved(settings)).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  await app.close();
});

test("Choose… is answered to the Settings window alone, not to another window's page", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const settings = await openSettings(app, "Voice");
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await answerMenus(app, "Studio");
  const options = [{ label: "Studio", value: "studio", checked: false }];
  // Every window has the same bridge, so the Ask window's page can send settings:pick all the same.
  const pick = (page: Page) => page.evaluate((list) => window.avanzel.settings.pick(list, null), options);
  expect(await pick(ask)).toBeNull();
  expect(await shownMenus(app)).toEqual([]); // main popped up no menu over Settings for it
  // Settings' own page is answered: the menu shows, and the item picked comes back.
  expect(await pick(settings)).toBe("studio");
  expect(await shownMenus(app)).toEqual([[{ label: "Studio", checked: false }]]);
  await app.close();
});
