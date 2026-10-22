// The library around the captures: shadow tasks, their run state, and libraries that misbehave or aren't there.
import { expect, test } from "@playwright/test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import { call, capsuleKind, exists, filesUnder, firstRun, launch, makeLibrary, openSettings, snap, stubPicker, windowFor } from "./helpers.ts";

test("a malformed task file shows up under Reviews, and the evening review still runs", async () => {
  const library = await makeLibrary();
  writeFileSync(path.join(library, "tasks", "broken.md"), "---\nschedule: sometimes\n---\nDo things.\n");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "setApp", { fileMode: "evening" });
  await call(app, "submitQuick", "a thought for tonight");
  const settings = await openSettings(app, "Reviews");
  await expect(settings.getByText("tasks/broken.md")).toBeVisible();
  await expect(settings.getByText(/Unknown schedule "sometimes"/)).toBeVisible();
  await expect(settings.getByText("Evening review", { exact: true })).toBeVisible();
  await snap(settings, "settings-task-problem");
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  expect(filesUnder(library, "inbox")).toEqual([]);
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

test("Settings without a library offers setup, which comes forward as Settings closes", async () => {
  const app = await launch(firstRun().env); // without a library, setup opens by itself
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await expect(settings.getByText("Avanzel has no library open.", { exact: true })).toBeVisible();
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
