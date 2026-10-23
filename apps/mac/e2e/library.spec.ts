// The library around the captures: shadow tasks, their run state, and libraries that misbehave or aren't there.
import { expect, test } from "@playwright/test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import {
  answerMenus,
  call,
  capsuleKind,
  exists,
  filesUnder,
  firstRun,
  launch,
  makeLibrary,
  openSettings,
  read,
  shownMenus,
  snap,
  stubPicker,
  windowFor,
} from "./helpers.ts";

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

  // The switch saves at once.
  await weekly.getByRole("switch", { name: "On" }).click();
  await expect.poll(() => read(library, "tasks/weekly-review.md")).toContain("enabled: false");

  // A time that isn't one is refused, and the file keeps its schedule.
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  const time = weekly.getByRole("textbox", { name: "Time", exact: true });
  await time.fill("25:00");
  await weekly.getByRole("button", { name: "Save", exact: true }).click();
  await expect(weekly.getByText("Use a time like 21:00.", { exact: true })).toBeVisible();
  expect(read(library, "tasks/weekly-review.md")).toContain("schedule: weekly sun 18:00");

  // The day comes from a menu of the seven days, with the one saved checked.
  await answerMenus(app, "Monday");
  await weekly.getByRole("group", { name: "Day", exact: true }).getByRole("button", { name: "Choose…" }).click();
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
  // Every day has no day to choose, and Every week brings back the one chosen.
  await weekly.getByRole("radio", { name: "Every day", exact: true }).click();
  await expect(weekly.getByRole("group", { name: "Day", exact: true })).toHaveCount(0);
  await weekly.getByRole("radio", { name: "Every week", exact: true }).click();
  await expect(weekly.getByText("Monday", { exact: true })).toBeVisible();

  // A time without its leading zero is one, and the agent comes from a menu that starts with the library's own.
  await time.fill("7:30");
  await answerMenus(app, "Codex");
  await weekly.getByRole("group", { name: "Agent", exact: true }).getByRole("button", { name: "Choose…" }).click();
  await expect.poll(() => shownMenus(app)).toHaveLength(1);
  expect((await shownMenus(app))[0]![0]).toEqual({ label: "The library's agent", checked: true });
  await expect(weekly.getByText("Codex", { exact: true })).toBeVisible();

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

  // One editor is open at a time, and Close drops what it held: the next Edit starts from the file.
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(time).toHaveValue("07:30");
  await time.fill("9:00");
  const evening = settings.getByRole("group", { name: "Evening review", exact: true });
  await evening.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(evening.getByRole("textbox", { name: "Time", exact: true })).toHaveValue("21:00");
  await expect(weekly.getByRole("textbox")).toHaveCount(0);
  await evening.getByRole("button", { name: "Close", exact: true }).click();
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(time).toHaveValue("07:30");
  expect(read(library, "tasks/weekly-review.md")).toContain("schedule: weekly mon 07:30");
  await app.close();
});

test("Run now runs a review at once, and the review says when it last ran", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
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
  // In Settings, the review's Save says so under it, in main's words alone, and the editor keeps what was typed.
  const settings = await openSettings(app, "Reviews");
  const weekly = settings.getByRole("group", { name: "Weekly review", exact: true });
  await weekly.getByRole("button", { name: "Edit", exact: true }).click();
  await weekly.getByRole("textbox", { name: "Instructions" }).fill("Look for stale goals.");
  rmSync(path.join(library, "tasks", "weekly-review.md"));
  await weekly.getByRole("button", { name: "Save", exact: true }).click();
  const problem = weekly.getByRole("alert");
  await expect(problem.getByText("This review couldn't be saved.", { exact: true })).toBeVisible();
  await expect(problem.getByText("No scheduled review called weekly-review.", { exact: true })).toBeVisible();
  await expect(weekly.getByRole("textbox", { name: "Instructions" })).toHaveValue("Look for stale goals.");
  // Close drops the draft, and the failed save with it.
  await weekly.getByRole("button", { name: "Close", exact: true }).click();
  await expect(weekly.getByRole("alert")).toHaveCount(0);
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
    await expect(settings.getByRole("group", { name: "Claude Code", exact: true }).getByRole("status")).toHaveText("Signed in", { timeout: 20_000 });
    await app.close();
  } finally {
    chmodSync(library, 0o755);
  }
});

test("Settings without a library offers setup, which comes forward as Settings closes", async () => {
  const app = await launch(firstRun().env); // without a library, setup opens by itself
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
