// The library around the captures: shadow tasks, their run state, and libraries that misbehave or aren't there.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import type { MenuItemModel } from "../src/main/menu-model.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import {
  agentPath,
  answerDialogs,
  answerMenus,
  call,
  capsuleKind,
  dialogsAsked,
  exists,
  filesUnder,
  firstRun,
  gitOut,
  launch,
  makeLibrary,
  openSettings,
  read,
  shown,
  shownMenus,
  snap,
  stubPicker,
  windowFor,
} from "./helpers.ts";
import { callsTo, settingsSnap, setupSnap, windowsTitled } from "./setup-helpers.ts";

/** Closes the setup window, as its red button does, and waits until it has gone. */
async function closeSetup(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }) => {
    const open = BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes("/renderer/setup/"));
    await Promise.all(open.map((w) => new Promise<void>((resolve) => {
      w.once("closed", () => resolve());
      w.close();
    })));
  });
}

test("a review file that can't be used is listed with why, and the evening review still runs", async () => {
  const library = await makeLibrary();
  writeFileSync(path.join(library, "tasks", "broken.md"), "---\nschedule: sometimes\n---\nDo things.\n");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "setApp", { fileMode: "evening" });
  await call(app, "submitQuick", "a thought for tonight");
  const settings = await openSettings(app, "Reviews");
  await expect(settings.getByRole("heading", { name: "Files that can't be used", exact: true })).toBeVisible();
  await expect(settings.getByText("tasks/broken.md", { exact: true })).toBeVisible();
  await expect(settings.getByText(/Unknown schedule "sometimes"/)).toBeVisible();
  await expect(settings.getByRole("group", { name: "Evening review", exact: true })).toBeVisible();
  await snap(settings, "settings-task-problem");
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  expect(filesUnder(library, "inbox")).toEqual([]);
  await app.close();
});

test("a scheduled review's switch, schedule, agent and instructions are edited in Settings and saved to its file", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  await expect(weekly.getByText("Sundays at 18:00", { exact: true })).toBeVisible();
  await expect(weekly.getByText("Not run yet.", { exact: true })).toBeVisible();

  // The switch says what it turns on (the group names the review), and saves at once.
  await weekly.getByRole("switch", { name: "Run on schedule", exact: true }).click();
  await expect.poll(() => read(library, "tasks/weekly-review.md")).toContain("enabled: false");

  // A time that isn't one is refused, and the file keeps its schedule.
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  const time = weekly.getByRole("textbox", { name: "Time", exact: true });
  await time.fill("25:00");
  await weekly.getByRole("button", { name: "Save", exact: true }).click();
  await expect(weekly.getByText("Use a time like 21:00.", { exact: true })).toBeVisible();
  expect(read(library, "tasks/weekly-review.md")).toContain("schedule: weekly sun 18:00");

  // The day comes from a menu of the seven days, with the one saved checked. Its row's group says the day, so VoiceOver
  // hears it beside Choose….
  await answerMenus(app, "Monday");
  await weekly.getByRole("group", { name: "Day: Sunday", exact: true }).getByRole("button", { name: "Choose…" }).click();
  await expect.poll(() => shownMenus(app)).toHaveLength(1);
  expect((await shownMenus(app))[0]).toEqual([
    { label: "Sunday", checked: true },
    { label: "Monday", checked: false },
    { label: "Tuesday", checked: false },
    { label: "Wednesday", checked: false },
    { label: "Thursday", checked: false },
    { label: "Friday", checked: false },
    { label: "Saturday", checked: false },
  ]);
  await expect(weekly.getByText("Monday", { exact: true })).toBeVisible();
  await expect(weekly.getByRole("group", { name: "Day: Monday", exact: true })).toBeVisible();
  // Every day has no day to choose, and Every week brings back the one chosen.
  await weekly.getByRole("radio", { name: "Every day", exact: true }).click();
  await expect(weekly.getByRole("group", { name: /^Day: / })).toHaveCount(0);
  await weekly.getByRole("radio", { name: "Every week", exact: true }).click();
  await expect(weekly.getByText("Monday", { exact: true })).toBeVisible();

  // A time without its leading zero is one, and the agent comes from a menu that starts with the library's own.
  await time.fill("7:30");
  await answerMenus(app, "Codex");
  await weekly.getByRole("group", { name: "Agent: The library's agent", exact: true }).getByRole("button", { name: "Choose…" }).click();
  await expect.poll(() => shownMenus(app)).toHaveLength(1);
  expect((await shownMenus(app))[0]![0]).toEqual({ label: "The library's agent", checked: true });
  await expect(weekly.getByText("Codex", { exact: true })).toBeVisible();
  await expect(weekly.getByRole("group", { name: "Agent: Codex", exact: true })).toBeVisible();

  await weekly.getByRole("textbox", { name: "Instructions" }).fill("Look for stale goals.");
  await weekly.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => read(library, "tasks/weekly-review.md")).toContain("schedule: weekly mon 07:30");
  const file = read(library, "tasks/weekly-review.md");
  expect(file).toContain("agent: codex");
  expect(file).toContain("Look for stale goals.");
  expect(file).toContain("enabled: false"); // Save keeps what the switch saved
  await expect(weekly.getByText("Mondays at 07:30", { exact: true })).toBeVisible();
  // The editor is closed.
  await expect(weekly.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(weekly.getByRole("textbox")).toHaveCount(0);

  // One editor is open at a time, and Cancel drops what it held: the next Edit starts from the file.
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(time).toHaveValue("07:30");
  await time.fill("9:00");
  const evening = settings.getByRole("group", { name: "Evening review", exact: true });
  await evening.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(evening.getByRole("textbox", { name: "Time", exact: true })).toHaveValue("21:00");
  await expect(weekly.getByRole("textbox")).toHaveCount(0);
  await evening.getByRole("button", { name: "Cancel", exact: true }).click();
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(time).toHaveValue("07:30");
  expect(read(library, "tasks/weekly-review.md")).toContain("schedule: weekly mon 07:30");
  await app.close();
});

test("a review's editor keeps what was typed when Settings gets a new snapshot", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  await weekly.getByRole("radio", { name: "Every day", exact: true }).click();
  await weekly.getByRole("textbox", { name: "Time", exact: true }).fill("7:30");
  await answerMenus(app, "Codex");
  await weekly.getByRole("group", { name: /^Agent: / }).getByRole("button", { name: "Choose…" }).click();
  await expect(weekly.getByText("Codex", { exact: true })).toBeVisible();
  await weekly.getByRole("textbox", { name: "Instructions" }).fill("Look for stale goals.");
  // Another review runs: main sends Settings a snapshot as it starts, and another as it ends.
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  await expect(settings.getByRole("group", { name: "Evening review", exact: true }).getByText(/^Last run today at/)).toBeVisible();
  // The draft is as it was typed, and nothing was saved.
  await expect(weekly.getByRole("radio", { name: "Every day", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(weekly.getByRole("textbox", { name: "Time", exact: true })).toHaveValue("7:30");
  await expect(weekly.getByText("Codex", { exact: true })).toBeVisible();
  await expect(weekly.getByRole("textbox", { name: "Instructions" })).toHaveValue("Look for stale goals.");
  await expect(weekly.getByText("Sundays at 18:00", { exact: true })).toBeVisible();
  await app.close();
});

test("a review's editor keeps what was typed while another pane shows, and Cancel drops it", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  const instructions = weekly.getByRole("textbox", { name: "Instructions" });
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  // The editor's buttons are one row under it, Cancel and then Save, the primary. The row above has no Close, and Edit,
  // the way in, has gone with the focus it had: the focus is on the editor's first control.
  await expect(weekly.getByRole("button", { name: /^(Cancel|Save)$/ })).toHaveText(["Cancel", "Save"]);
  await expect(weekly.getByRole("button", { name: "Cancel", exact: true })).toHaveAttribute("data-variant", "quiet");
  await expect(weekly.getByRole("button", { name: "Save", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(weekly.getByRole("button", { name: /^(Edit|Close)$/ })).toHaveCount(0);
  await expect(weekly.getByRole("radio", { name: "Every week", exact: true })).toBeFocused();
  await instructions.fill("Look for stale goals.");

  // General and back, on the toolbar: the editor is open still, with what was typed.
  await settings.getByRole("radio", { name: "General", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  await expect(instructions).toHaveCount(0);
  await settings.getByRole("radio", { name: "Reviews", exact: true }).click();
  await expect(instructions).toHaveValue("Look for stale goals.");
  // The arrow keys move along the toolbar and show each pane they pass, and the draft outlasts that too.
  await settings.getByRole("radio", { name: "Reviews", exact: true }).press("ArrowRight");
  await expect(settings.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  await settings.getByRole("radio", { name: "Privacy", exact: true }).press("ArrowLeft");
  await expect(settings.getByRole("heading", { name: "Reviews", exact: true })).toBeVisible();
  await expect(instructions).toHaveValue("Look for stale goals.");
  expect(read(library, "tasks/weekly-review.md")).not.toContain("Look for stale goals.");

  // Cancel drops the draft and closes the editor, the focus goes back to Edit, and the next Edit starts from the file.
  await weekly.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(weekly.getByRole("textbox")).toHaveCount(0);
  const edit = weekly.getByRole("button", { name: "Edit", exact: true });
  await expect(edit).toBeFocused();
  await edit.click();
  await expect(instructions).toBeVisible();
  await expect(instructions).not.toHaveValue("Look for stale goals.");
  expect(read(library, "tasks/weekly-review.md")).not.toContain("Look for stale goals.");

  // A Save that works closes the editor too, and gives the focus back to Edit, as Cancel does.
  await instructions.fill("Look for stale goals.");
  await weekly.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => read(library, "tasks/weekly-review.md")).toContain("Look for stale goals.");
  await expect(weekly.getByRole("textbox")).toHaveCount(0);
  await expect(edit).toBeFocused();
  await app.close();
});

test("a review's draft goes when another library opens, whose review of the same name it isn't", async () => {
  const library = await makeLibrary();
  const other = await makeLibrary();
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  await weekly.getByRole("textbox", { name: "Instructions" }).fill("Look for stale goals.");
  await settings.getByRole("radio", { name: "General", exact: true }).click();
  await stubPicker(app, other);
  await settings.getByRole("button", { name: "Change…" }).click();
  await expect.poll(async () => ((await call(app, "snapshot")) as SettingsSnapshot).library?.path).toBe(other);
  // The other library's weekly review has the same id: its editor is closed, so a Save can't write the draft into it.
  await settings.getByRole("radio", { name: "Reviews", exact: true }).click();
  await expect(weekly.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(weekly.getByRole("textbox")).toHaveCount(0);
  await app.close();
});

test("Run now runs a review at once, and the review says when it last ran", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  await answerDialogs(app, 0); // Run Now: Settings asks before it runs a review
  await weekly.getByRole("button", { name: "Run now" }).click();
  // The run has started once main notes when it ran; then it runs to its end.
  await expect
    .poll(async () => ((await call(app, "snapshot")) as SettingsSnapshot).tasks.find((task) => task.id === "weekly-review")?.lastRun ?? null)
    .not.toBeNull();
  await call(app, "idleForTests");
  await expect(weekly.getByText(/^Last run today at \d\d:\d\d\.$/)).toBeVisible();
  expect(await call(app, "notificationsForTests")).toContainEqual(expect.objectContaining({ title: "Weekly review is ready" }));
  await app.close();
});

test("a review's save waits behind a run, and nothing else saves that review over it meanwhile", async () => {
  // Each weekly review run holds the library for 4 s, and a save waits behind it in the queue.
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_DELAY_MS: "4000", FAKE_AGENT_DELAY_TASK: "review" });
  const settings = await openSettings(app, "Reviews");
  await answerDialogs(app, 0); // Run Now, each time hold() presses Run now
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  const evening = settings.getByRole("group", { name: "Evening review", exact: true });
  const on = evening.getByRole("switch", { name: "Run on schedule", exact: true });
  const instructions = evening.getByRole("textbox", { name: "Instructions" });
  const save = evening.getByRole("button", { name: "Save", exact: true });
  const hold = async () => {
    await weekly.getByRole("button", { name: "Run now" }).click();
    await expect(weekly.getByText("Running now…", { exact: true })).toBeVisible();
  };

  // The switch, then Save: while the switch's save waits, the switch and Save wait too, Return in the time included.
  await hold();
  await evening.getByRole("button", { name: "Edit", exact: true }).click();
  await instructions.fill("File it all, and keep my words.");
  await on.click();
  await expect(on).toBeDisabled();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await save.click();
  await evening.getByRole("textbox", { name: "Time", exact: true }).press("Enter");
  await call(app, "idleForTests");
  await expect(on).toBeEnabled();
  await expect(on).toHaveAttribute("aria-checked", "false");
  expect(read(library, "tasks/evening-review.md")).toContain("enabled: false");
  expect(read(library, "tasks/evening-review.md")).not.toContain("File it all");
  // The editor kept what was typed, and Save now writes it with the review left off.
  await save.click();
  await expect.poll(() => read(library, "tasks/evening-review.md")).toContain("File it all, and keep my words.");
  expect(read(library, "tasks/evening-review.md")).toContain("enabled: false");
  await expect(save).toHaveCount(0);

  // Save, then the switch: while Save waits, the switch does too, so it can't write the old instructions back.
  await hold();
  await evening.getByRole("button", { name: "Edit", exact: true }).click();
  await instructions.fill("File only what's ready.");
  await save.click();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(on).toBeDisabled();
  // Settings, not the pane, holds the save on its way: leaving the pane and coming back meanwhile, Save is busy still
  // and the switch waits still, so neither can write the old fields over it.
  await settings.getByRole("radio", { name: "General", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  await settings.getByRole("radio", { name: "Reviews", exact: true }).click();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(on).toBeDisabled();
  await call(app, "idleForTests");
  await expect(save).toHaveCount(0);
  await on.click();
  await expect.poll(() => read(library, "tasks/evening-review.md")).toContain("enabled: true");
  expect(read(library, "tasks/evening-review.md")).toContain("File only what's ready.");

  // From the keyboard: the switch drops the focus while it is disabled, and gets it back once its save is written.
  await hold();
  await on.press("Space");
  await expect(on).toBeDisabled();
  await call(app, "idleForTests");
  await expect(on).toBeEnabled();
  await expect(on).toBeFocused();
  expect(read(library, "tasks/evening-review.md")).toContain("enabled: false");
  await app.close();
});

test("running the evening review by hand on an empty inbox says so", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toContainEqual({ title: "Evening review", body: "Inbox was empty." });
  await app.close();
});

test("a custom review is skipped, and its notification says so plainly", async () => {
  const library = await makeLibrary();
  writeFileSync(path.join(library, "tasks", "standup.md"), "---\nname: Standup\nschedule: daily 09:00\nkind: custom\n---\nAsk about the day.\n");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "runTask", "standup");
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toContainEqual({
    title: "Standup",
    body: "Avanzel doesn't run custom reviews yet, so this one was skipped.",
  });
  await app.close();
});

test("saving a review whose file has gone says so plainly", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const patch = { id: "standup", name: "Standup", schedule: "daily 09:00", agent: "auto", enabled: true, instructions: "Ask about the day." };
  await expect(call(app, "saveTaskFromSettings", patch)).rejects.toThrow("No scheduled review called standup.");
  // In Settings, the review's Save says so under it, in main's words, then what is true of the review now: its file is
  // missing or can't be used, so it doesn't run (and never that it still runs). The editor keeps what was typed.
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  await weekly.getByRole("textbox", { name: "Instructions" }).fill("Look for stale goals.");
  rmSync(path.join(library, "tasks", "weekly-review.md"));
  await weekly.getByRole("button", { name: "Save", exact: true }).click();
  const problem = weekly.getByRole("alert");
  await expect(problem.getByText("This review couldn't be saved.", { exact: true })).toBeVisible();
  await expect(
    problem.getByText("No scheduled review called weekly-review. Its file, tasks/weekly-review.md, is missing or can't be used, so it doesn't run.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(problem).not.toContainText("still runs");
  await expect(weekly.getByRole("textbox", { name: "Instructions" })).toHaveValue("Look for stale goals.");
  // Cancel drops the draft, and the failed save with it.
  await weekly.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(weekly.getByRole("alert")).toHaveCount(0);
  await app.close();
});

test("a review that is off, whose switch can't be saved, is said to stay off", async () => {
  const library = await makeLibrary();
  // The weekly review is off.
  const weeklyFile = path.join(library, "tasks", "weekly-review.md");
  writeFileSync(weeklyFile, read(library, "tasks/weekly-review.md").replace("enabled: true", "enabled: false"));
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  const on = weekly.getByRole("switch", { name: "Run on schedule", exact: true });
  await expect(on).toHaveAttribute("aria-checked", "false");
  // Nothing can be written in tasks/ now, so turning it on fails, and its file stays as it was.
  chmodSync(path.join(library, "tasks"), 0o555);
  try {
    await on.click();
    const problem = weekly.getByRole("alert");
    await expect(problem.getByText("This review couldn't be saved.", { exact: true })).toBeVisible();
    // The switch above says it is off, and so does the Notice: never that it still runs.
    await expect(problem).toContainText(/\. It stays off, as last saved\.$/);
    await expect(problem).not.toContainText("still runs");
    await expect(on).toHaveAttribute("aria-checked", "false");
    expect(read(library, "tasks/weekly-review.md")).toContain("enabled: false");
  } finally {
    chmodSync(path.join(library, "tasks"), 0o755);
  }
  await app.close();
});

test("a review's failed save is told under the review only, and is still told after a pane switch", async () => {
  const library = await makeLibrary();
  // The weekly review is off.
  const weeklyFile = path.join(library, "tasks", "weekly-review.md");
  writeFileSync(weeklyFile, read(library, "tasks/weekly-review.md").replace("enabled: true", "enabled: false"));
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  const on = weekly.getByRole("switch", { name: "Run on schedule", exact: true });
  const problem = weekly.getByRole("alert");
  // Nothing can be written in tasks/ now, so turning it on fails, and its file stays as it was.
  chmodSync(path.join(library, "tasks"), 0o555);
  try {
    await on.click();
    await expect(problem.getByText("This review couldn't be saved.", { exact: true })).toBeVisible();
    await expect(problem).toContainText(/\. It stays off, as last saved\.$/);
    // Why, in plain words: not the system's code, nor the temporary file it names.
    await expect(problem).toContainText("Avanzel can't write to the library's settings. It stays off, as last saved.");
    await expect(problem).not.toContainText(/EACCES|\.tmp/);
    // Told once, where the review is: the window's own "That change wasn't saved." is for the changes with no Notice of their own.
    await expect(settings.getByText("That change wasn't saved.", { exact: true })).toHaveCount(0);
    await expect(settings.getByRole("alert")).toHaveCount(1);

    // The failure is the window's, not the pane's: another pane and back, and the review still says its save failed.
    await settings.getByRole("radio", { name: "General", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
    await expect(settings.getByRole("alert")).toHaveCount(0);
    await settings.getByRole("radio", { name: "Reviews", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Reviews", exact: true })).toBeVisible();
    await expect(problem.getByText("This review couldn't be saved.", { exact: true })).toBeVisible();
    await expect(problem).toContainText(/\. It stays off, as last saved\.$/);
    await expect(on).toHaveAttribute("aria-checked", "false");
    expect(read(library, "tasks/weekly-review.md")).toContain("enabled: false");
  } finally {
    chmodSync(path.join(library, "tasks"), 0o755);
  }
  // It goes when that review is saved: turned on now that it can be written.
  await on.click();
  await expect.poll(() => read(library, "tasks/weekly-review.md")).toContain("enabled: true");
  await expect(problem).toHaveCount(0);
  await app.close();
});

test("when shadow tasks last ran is kept with the app, not in the library (an old state.json carried over once)", async () => {
  const library = await makeLibrary({ git: true });
  const ran = new Date().toISOString(); // just now: no shadow task comes due at launch, whatever the hour
  writeFileSync(path.join(library, ".avanzel", "state.json"), JSON.stringify({ checked: { "evening-review": ran }, ran: { "evening-review": ran } }));
  const app = await launch({ AVANZEL_LIBRARY: library });
  const before = (await call(app, "snapshot")) as SettingsSnapshot;
  expect(before.tasks.find((task) => task.id === "evening-review")?.lastRun).toBe(ran);
  expect(exists(library, ".avanzel/state.json")).toBe(false);
  await call(app, "runTask", "weekly-review");
  await call(app, "idleForTests");
  const after = (await call(app, "snapshot")) as SettingsSnapshot;
  expect(after.tasks.find((task) => task.id === "weekly-review")?.lastRun).not.toBeNull();
  expect(after.tasks.find((task) => task.id === "evening-review")?.lastRun).toBe(ran);
  expect(exists(library, ".avanzel/state.json")).toBe(false);
  await app.close();
});

test("a library that can't be opened is explained in Settings and the menu, and Choose a folder… fixes it", async () => {
  const library = await makeLibrary();
  const good = await makeLibrary();
  rmSync(path.join(library, "tasks"), { recursive: true });
  chmodSync(library, 0o555); // read-only: the default shadow tasks can't be created
  try {
    // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
    const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
    const settings = await windowFor(app, "settings");
    await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
    const problem = settings.getByRole("alert");
    await expect(problem).toContainText(/Avanzel couldn't open the library/);
    await expect(problem).toContainText(/permission denied/);
    await snap(settings, "settings-library-problem");
    const [setUp] = (await call(app, "menuForTests")) as { label: string; sublabel?: string }[];
    expect(setUp?.sublabel).toMatch(/^Avanzel couldn't open the library/);
    await stubPicker(app, good);
    await problem.getByRole("button", { name: "Choose a folder…" }).click();
    await expect.poll(async () => ((await call(app, "snapshot")) as SettingsSnapshot).library?.path).toBe(good);
    await expect(settings.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
    await app.close();
  } finally {
    chmodSync(library, 0o755);
  }
});

test("a library folder renamed while Avanzel runs is named in Settings, and choosing it where it is brings it back", async () => {
  const library = await makeLibrary();
  // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
  const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
  await expect.poll(async () => ((await call(app, "snapshot")) as SettingsSnapshot).library?.exists).toBe(true); // it is open
  const moved = `${library}-moved`;
  renameSync(library, moved);
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  // Not a blank window: General says where it can't find the library, and offers to choose it again.
  await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  const missing = settings.getByRole("alert");
  await expect(missing.getByText(`Avanzel can't find your library at ${library}.`, { exact: true })).toBeVisible();
  await expect(missing.getByText("Choose it again once it's back, or choose another folder.", { exact: true })).toBeVisible();
  const choose = missing.getByRole("button", { name: "Choose a folder…", exact: true });
  await expect(choose).toHaveAttribute("data-variant", "primary");
  await expect(settings.getByRole("button", { name: "Set up Avanzel…" })).toHaveCount(0);
  await snap(settings, "settings-library-missing");
  // Choosing the folder where it is now brings the Library group back.
  await stubPicker(app, moved);
  await choose.click();
  await expect.poll(async () => ((await call(app, "snapshot")) as SettingsSnapshot).library?.path).toBe(moved);
  await expect(settings.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await app.close();
});

test("a library whose .avanzel folder goes while Avanzel runs is named as missing, and setup still opens from Settings", async () => {
  const library = await makeLibrary();
  // Setup then suggests ~/Avanzel, so the test has a home of its own: it never looks into this Mac's.
  const app = await launch({ ...firstRun().env, AVANZEL_LIBRARY: library });
  await expect.poll(async () => ((await call(app, "snapshot")) as SettingsSnapshot).library?.exists).toBe(true); // it is open
  rmSync(path.join(library, ".avanzel"), { recursive: true, force: true });
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  const missing = settings.getByRole("alert");
  await expect(missing.getByText(`Avanzel can't find your library at ${library}.`, { exact: true })).toBeVisible();
  await expect(missing.getByRole("button", { name: "Choose a folder…", exact: true })).toBeVisible();
  // Asked for from Settings, setup opens: the library it would stand in for isn't there.
  await call(app, "openSetupFromSettings");
  await expect.poll(() => shown(app, "setup")).toBe(true);
  await app.close();
});

test("a remembered library that is missing at launch is named in Settings, and setup is not the first thing a person sees", async () => {
  const { env, home } = firstRun();
  const gone = path.join(home, "Brain"); // remembered, and not there any more: moved, renamed or unmounted since
  const app = await launch({ ...env, AVANZEL_LIBRARY: gone });
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  // Settings, not setup: this is no first run, and a window that starts over says nothing of the library that went.
  expect(await windowsTitled(app, "Set up Avanzel")).toBe(0);
  expect(await shown(app, "setup")).toBe(false);
  const missing = settings.getByRole("alert");
  await expect(missing.getByText("Avanzel can't find your library at ~/Brain.", { exact: true })).toBeVisible();
  await expect(missing.getByText("Choose it again once it's back, or choose another folder.", { exact: true })).toBeVisible();
  await expect(missing.getByRole("button", { name: "Choose a folder…", exact: true })).toHaveAttribute("data-variant", "primary");
  const setUpNew = missing.getByRole("button", { name: "Set up a new library", exact: true });
  await expect(setUpNew).toHaveAttribute("data-variant", "secondary");
  await snap(settings, "settings-library-missing-at-launch");
  // The menu's top item says the same, and opens Settings.
  const [top] = (await call(app, "menuForTests")) as MenuItemModel[];
  expect(top).toEqual({ type: "item", label: "Set up Avanzel…", action: "settings", sublabel: "Can't find your library at ~/Brain." });
  // So do opening Avanzel again, and the shortcuts and the menu items that need a library: none starts setup over.
  await app.evaluate(({ app: electronApp }) => electronApp.emit("activate"));
  await call(app, "openQuick");
  await call(app, "menuAction", "settings");
  expect(await windowsTitled(app, "Set up Avanzel")).toBe(0);
  expect(await windowsTitled(app, "Avanzel Settings")).toBe(1);
  // Set up a new library opens setup, and Settings closes. Setup suggests ~/Avanzel, not the place that went missing.
  const closed = settings.waitForEvent("close");
  await setUpNew.click().catch(() => undefined); // closes Settings, before the click returns
  await closed;
  await expect.poll(() => shown(app, "setup")).toBe(true);
  expect(await call(app, "setupStepForTests")).toBe("hello");
  expect(await setupSnap(app)).toMatchObject({ libraryPath: path.join(home, "Avanzel"), libraryLabel: "~/Avanzel", folder: "missing", libraryReady: false });
  const setup = await windowFor(app, "setup");
  await setup.getByRole("button", { name: "Set me up" }).click();
  await expect(setup.getByText("~/Avanzel", { exact: true })).toBeVisible();
  await expect(setup.getByText("~/Brain", { exact: true })).toHaveCount(0);
  // The library that went is still the one remembered, until a new one is made: nothing was forgotten or made by asking.
  expect((await settingsSnap(app)).app.libraryPath).toBe(gone);
  await app.close();
});

test("a remembered library that is missing at launch can be chosen again where it is, and then Settings shows it", async () => {
  const { env, home } = firstRun();
  const moved = await makeLibrary();
  const app = await launch({ ...env, AVANZEL_LIBRARY: path.join(home, "Brain") });
  const settings = await windowFor(app, "settings");
  await stubPicker(app, moved);
  await settings.getByRole("alert").getByRole("button", { name: "Choose a folder…", exact: true }).click();
  await expect.poll(async () => (await settingsSnap(app)).library?.path).toBe(moved);
  await expect(settings.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  // Back in use, the menu is the library's own.
  const [top] = (await call(app, "menuForTests")) as MenuItemModel[];
  expect(top).toMatchObject({ action: "open-library" }); // the new library's inbox is empty, so the head's words don't name it
  expect(await windowsTitled(app, "Set up Avanzel")).toBe(0);
  await app.close();
});

test("a system folder is refused as a library before any question is asked, and the library stays as it was", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
  await expect.poll(async () => ((await call(app, "snapshot")) as SettingsSnapshot).library?.exists).toBe(true); // it is open
  // A folder that holds files is asked about first (Turn it into your library?): this box is never answered yes, so nothing is
  // made, whatever the app does, and its calls are kept.
  await answerDialogs(app, 1);
  // macOS's own folders, where nothing can be made or nothing is kept, send the person to their home folder.
  for (const place of ["/Applications", "/usr", "/tmp"]) {
    await stubPicker(app, place);
    await expect(call(app, "chooseLibrary")).rejects.toThrow(`${place} is one of macOS's own folders. Choose or make a folder in your home folder.`);
  }
  // The home folder, here by the data volume's path for it, is too broad, and a folder inside it will do.
  const home = path.join("/System/Volumes/Data", homedir());
  await stubPicker(app, home);
  await expect(call(app, "chooseLibrary")).rejects.toThrow(`${home} is too broad for a library. Choose or make a folder inside it.`);
  expect(await dialogsAsked(app)).toEqual([]);
  expect(((await call(app, "snapshot")) as SettingsSnapshot).library).toMatchObject({ path: library, exists: true });
  expect(exists("/Applications", ".avanzel")).toBe(false);
  expect(exists("/usr", ".avanzel")).toBe(false);
  await app.close();
});

test("Change… on a folder that is too broad says so in Settings, asks nothing, and leaves the library as it was", async () => {
  const library = await makeLibrary();
  const good = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
  const settings = await openSettings(app);
  // A folder that holds files is asked about first (Turn it into your library?): this box is never answered yes, and its calls are kept.
  await answerDialogs(app, 1);
  await stubPicker(app, "/Applications");
  await settings.getByRole("button", { name: "Change…" }).click();
  const problem = settings.getByRole("alert");
  await expect(problem.getByText("That change wasn't saved.", { exact: true })).toBeVisible();
  // Why, and what is safe: the library is the one it was.
  await expect(
    problem.getByText("/Applications is one of macOS's own folders. Choose or make a folder in your home folder. The setting keeps its old value.", { exact: true }),
  ).toBeVisible();
  await expect(problem).not.toContainText("Error invoking remote method");
  await snap(settings, "settings-library-too-broad");
  // No box asked anything, and the library is the one it was.
  expect(await dialogsAsked(app)).toEqual([]);
  expect(((await call(app, "snapshot")) as SettingsSnapshot).library).toMatchObject({ path: library, exists: true });
  await expect(settings.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  // A folder that works is the next change, and the Notice goes with it.
  await stubPicker(app, good);
  await settings.getByRole("button", { name: "Change…" }).click();
  await expect.poll(async () => ((await call(app, "snapshot")) as SettingsSnapshot).library?.path).toBe(good);
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await app.close();
});

test("Change… on a folder Avanzel can't read says it can't use that folder, not that it can't write its settings, and leaves the library as it was", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
  const settings = await openSettings(app);
  // Choosing a library reads the folder, and makes the library in it, before anything of Avanzel's own is written: the folder is
  // what a refused permission is about.
  const folder = mkdtempSync(path.join(tmpdir(), "avz-e2e-locked-"));
  chmodSync(folder, 0o000);
  try {
    await stubPicker(app, folder);
    await settings.getByRole("button", { name: "Change…" }).click();
    const problem = settings.getByRole("alert");
    await expect(problem.getByText("That change wasn't saved.", { exact: true })).toBeVisible();
    await expect(problem.getByText("Avanzel can't use that folder. The setting keeps its old value.", { exact: true })).toBeVisible();
    await expect(problem).not.toContainText(/EACCES|scandir|settings\b.*\bwrite|can't write/);
    await snap(settings, "settings-library-folder-refused");
    expect(((await call(app, "snapshot")) as SettingsSnapshot).library).toMatchObject({ path: library, exists: true });
  } finally {
    chmodSync(folder, 0o755);
  }
  await app.close();
});

test("Choose a folder… for a library that has gone says why a folder is refused, beside the Notice that offered it", async () => {
  const { env, home } = firstRun();
  const app = await launch({ ...env, AVANZEL_LIBRARY: path.join(home, "Brain") }); // remembered, and not there any more
  const settings = await windowFor(app, "settings");
  await stubPicker(app, "/Applications");
  await settings.getByRole("alert").getByRole("button", { name: "Choose a folder…", exact: true }).click();
  const problem = settings.getByRole("alert").filter({ hasText: "That change wasn't saved." });
  await expect(
    problem.getByText("/Applications is one of macOS's own folders. Choose or make a folder in your home folder. The setting keeps its old value.", { exact: true }),
  ).toBeVisible();
  // The library that went is still named, with its fix: nothing was chosen.
  await expect(settings.getByText("Avanzel can't find your library at ~/Brain.", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Choose a folder…", exact: true })).toBeVisible();
  await app.close();
});

test("Change… on a folder with files asks first, and promises git history only where this Mac has git", async () => {
  for (const git of [true, false]) {
    const library = await makeLibrary();
    const folder = mkdtempSync(path.join(tmpdir(), "avz-e2e-notes-"));
    writeFileSync(path.join(folder, "notes.md"), "# Notes\n");
    const app = await launch({
      AVANZEL_LIBRARY: library,
      XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")),
      ...(git ? {} : { AVANZEL_GIT_USABLE: "0" }),
    });
    // The question is a native box: this one keeps what it is asked, and answers Cancel.
    await answerDialogs(app, 1);
    await stubPicker(app, folder);
    await call(app, "chooseLibrary");
    const [asked, ...more] = await dialogsAsked(app);
    expect(more).toEqual([]);
    expect(asked?.options.message).toBe(`Turn “${path.basename(folder)}” into your Avanzel library?`);
    expect(asked?.options.detail).toBe(
      git
        ? "It already has files. Avanzel will add its shelves, an AGENTS.md for your agent, and git history that includes the existing files."
        : "It already has files. Avanzel will add its shelves and an AGENTS.md for your agent. This Mac has no git yet, so changes can't be undone.",
    );
    expect(exists(folder, ".avanzel")).toBe(false); // Cancel: nothing was made
    expect(((await call(app, "snapshot")) as SettingsSnapshot).library?.path).toBe(library);
    await app.close();
  }
});

test("a folder chosen in Settings becomes a library without a repository on a Mac with no git, and nothing runs git", async () => {
  const library = await makeLibrary();
  const folder = mkdtempSync(path.join(tmpdir(), "avz-e2e-new-"));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")),
    AVANZEL_GIT_USABLE: "0", // a Mac whose only git is Apple's stub, which opens an install dialog when it runs
  });
  await stubPicker(app, folder);
  await call(app, "chooseLibrary");
  await expect.poll(async () => ((await call(app, "snapshot")) as SettingsSnapshot).library?.path).toBe(folder);
  expect(exists(folder, ".avanzel/config.toml")).toBe(true);
  expect(exists(folder, ".git")).toBe(false);
  expect(((await call(app, "snapshot")) as SettingsSnapshot).library).toMatchObject({ isGit: false });
  await app.close();
});

test("a library that has .git, on a Mac with no usable git, files a thought with no commit and no Undo, and runs no git", async () => {
  // Two launches of one library: a git that notes every call stands first on PATH (and does nothing, exiting 1). Where git is
  // usable, filing calls it, which shows the note works. Where this Mac has none (AVANZEL_GIT_USABLE=0), nothing calls it.
  for (const usable of [true, false]) {
    const library = await makeLibrary({ git: true }); // made here, by the engine, with this Mac's own git
    const history = gitOut(library, "log", "--format=%H");
    const app = await launch({
      AVANZEL_LIBRARY: library,
      PATH: agentPath({ git: "exit 1" }),
      ...(usable ? {} : { AVANZEL_GIT_USABLE: "0" }),
    });
    await call(app, "submitQuick", "Plant tulips in October");
    await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
    expect(filesUnder(library, "ideas")).toHaveLength(1); // filed all the same
    expect(gitOut(library, "log", "--format=%H")).toBe(history); // by the fake git or none, no commit was made
    expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", canUndo: false }); // nothing to undo it from
    const calls = await callsTo(app, "git");
    if (usable) expect(calls.length).toBeGreaterThan(0);
    else expect(calls).toEqual([]);
    await app.close();
  }
});

test("a library that was a git repository already, with automatic commits off, keeps the inbox's recordings out of git once it opens", async () => {
  // Its owner made the repository (an Obsidian vault, say), so Avanzel never made it, and with auto_commit off no commit of Avanzel's
  // ever writes the exclude lines: a sync tool of the owner's could commit a recording that Stop left in the inbox.
  const library = await makeLibrary(); // made with no repository ...
  gitOut(library, "init", "-q"); // ... which its owner then makes
  saveSettings(library, { ...loadSettings(library), autoCommit: false });
  const exclude = path.join(library, ".git", "info", "exclude");
  const lines = () => (existsSync(exclude) ? readFileSync(exclude, "utf8").split("\n") : []);
  expect(lines()).not.toContain("inbox/*.[wW][aA][vV]");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await expect.poll(lines, { timeout: 15_000 }).toContain("inbox/*.[wW][aA][vV]");
  await app.close();
  // The owner's own git now passes over a recording that waits in the inbox, and still sees the note beside it.
  writeFileSync(path.join(library, "inbox", "2026-10-27-101500.wav"), "sound");
  writeFileSync(path.join(library, "inbox", "2026-10-27-101501.md"), "---\nid: 2026-10-27-101501\n---\n\nwords\n");
  const untracked = gitOut(library, "status", "--porcelain", "--untracked-files=all", "--", "inbox");
  expect(untracked).toContain("inbox/2026-10-27-101501.md");
  expect(untracked).not.toContain(".wav");
});

test("Agents shows a library's problem as General does, and lists the agents once a folder is chosen", async () => {
  const library = await makeLibrary();
  const good = await makeLibrary();
  rmSync(path.join(library, "tasks"), { recursive: true });
  chmodSync(library, 0o555); // read-only: the default shadow tasks can't be created
  try {
    // A chosen library is remembered for the next launch: in a folder of the test's own, not in this Mac's ~/.config.
    const app = await launch({ AVANZEL_LIBRARY: library, XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")) });
    const settings = await openSettings(app, "Agents");
    const problem = settings.getByRole("alert");
    await expect(problem).toContainText(/Avanzel couldn't open the library/);
    await expect(settings.getByRole("heading", { name: "Who files your thoughts", exact: true })).toHaveCount(0);
    // The library opens while the pane is open: the Notice gives way to the list, which starts its own checks.
    await stubPicker(app, good);
    await problem.getByRole("button", { name: "Choose a folder…" }).click();
    await expect(settings.getByRole("heading", { name: "Who files your thoughts", exact: true })).toBeVisible();
    await expect(settings.getByRole("alert")).toHaveCount(0);
    await expect(settings.getByRole("group", { name: "fake", exact: true }).getByRole("img", { name: "Chosen" })).toBeVisible();
    await expect(settings.getByRole("group", { name: "Claude Code", exact: true }).getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
    await app.close();
  } finally {
    chmodSync(library, 0o755);
  }
});

test("Settings without a library offers setup, which comes forward as Settings closes", async () => {
  const app = await launch(firstRun().env); // without a library, setup opens by itself
  // Closed first: with setup open from the start, a button that did nothing would still leave it shown.
  await windowFor(app, "setup");
  await expect.poll(() => shown(app, "setup")).toBe(true);
  await closeSetup(app);
  expect(await shown(app, "setup")).toBe(false);
  expect(await call(app, "setupStepForTests")).toBeNull();
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await expect(settings.getByText("Avanzel has no library open.", { exact: true })).toBeVisible();
  // Agents has no library to list agents for either: the same Notice stands where its groups would be.
  await settings.getByRole("radio", { name: "Agents", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(settings.getByText("Avanzel has no library open.", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Set up Avanzel…" })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Who files your thoughts", exact: true })).toHaveCount(0);
  // Nor has Reviews any reviews to show.
  await settings.getByRole("radio", { name: "Reviews", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Reviews", exact: true })).toBeVisible();
  await expect(settings.getByText("Avanzel has no library open.", { exact: true })).toBeVisible();
  await settings.getByRole("radio", { name: "General", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  const closed = settings.waitForEvent("close");
  await settings.getByRole("button", { name: "Set up Avanzel…" }).click().catch(() => undefined); // closes Settings, before the click returns
  await closed;
  // The button opened setup afresh, on Hello.
  await expect.poll(() => shown(app, "setup")).toBe(true);
  expect(await call(app, "setupStepForTests")).toBe("hello");
  await app.close();
});

test("a typed thought that can't be saved keeps its words and the box stays usable", async () => {
  const library = await makeLibrary();
  chmodSync(path.join(library, "inbox"), 0o555); // the capture can't be written
  try {
    const app = await launch({ AVANZEL_LIBRARY: library });
    await call(app, "openQuick");
    const quick = await windowFor(app, "quick");
    const box = quick.getByRole("textbox", { name: "Type a thought" });
    await box.fill("Plant tulips in October");
    await box.press("Enter");
    await expect.poll(() => capsuleKind(app)).toBe("error");
    await expect(box).toBeEnabled();
    await expect(box).toHaveValue("Plant tulips in October");
    await app.close();
  } finally {
    chmodSync(path.join(library, "inbox"), 0o755);
  }
});
