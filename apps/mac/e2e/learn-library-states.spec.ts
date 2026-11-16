// Learn this library's states, end to end: what is refused while a study runs, the offer put away for good, Undo of an Apply, a study
// that goes on after Avanzel quit or after a failed run, another library opened mid-study, the house style's Edit and Remove, and a
// folder left out at Apply that comes back as a shelf.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Librarian, loadSettings, Vault } from "../../../packages/engine/src/index.ts";
import type { StudyState } from "../src/shared/ipc.ts";
import { agentMode, launchOn, notified, obsidianLibrary, panelOn, panelSnapshot, recordFile, studiedFolders, studyIs, studyOf } from "./capsule-helpers.ts";
import { call, filesUnder, gitOut, openSettings, paneOf, settingsRow } from "./helpers.ts";

const OFFER_TITLE = "This library has folders of its own.";
const STILL_RUNNING = "The study is still running, so nothing changed. Stop it first, then try again.";
// Long enough that a step is still in flight however slowly the test gets to it; a Stop, a quit or a switch kills the run, so it costs little.
const SLOW = { FAKE_AGENT_DELAY_MS: "8000", FAKE_AGENT_DELAY_TASK: "study-folder" };

/** What the review screen would send for a proposal: every folder filed into, as proposed. */
function applyAll(state: StudyState) {
  if (state.kind !== "ready") throw new Error(`no proposal: ${state.kind}`);
  return {
    shelves: state.proposal.shelves.map(({ folder, name, definition, map }) => ({ folder, name, definition, map, fileHere: true })),
    style: state.proposal.style,
  };
}

/** Waits until a study runs and has studied `done` steps. */
const runningAt = (app: ElectronApplication, done: number) =>
  expect.poll(async () => {
    const study = await studyOf(app);
    return study.kind === "running" ? study.done : -1;
  }, { timeout: 30_000 }).toBe(done);

/** The library's AGENTS.md, as the agents read it. */
const agentsMd = (library: string) => readFileSync(path.join(library, "AGENTS.md"), "utf8");

/** Whether a study's run is still going in main (after a Stop, until the step in flight has ended). */
const runGoing = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __avanzel: { studyRun: unknown } }).__avanzel.studyRun !== null);

test("Apply and Discard are refused while a study runs and while it stops, and so is a second Start", async () => {
  const library = await obsidianLibrary();
  const { app } = await launchOn(library, SLOW);
  await call(app, "startStudy", true);
  await expect(call(app, "startStudy", true)).rejects.toThrow("A study is already running.");
  await expect(call(app, "startStudy", false)).rejects.toThrow("A study is already running.");
  const payload = { shelves: [{ folder: "Philosophy", name: "Philosophy", definition: "Thinkers.", map: "", fileHere: true }], style: "" };
  await expect(call(app, "applyStudy", payload)).rejects.toThrow(STILL_RUNNING);
  await expect(call(app, "discardStudy")).rejects.toThrow(STILL_RUNNING);
  // Stop, and at once (the step in flight hasn't ended yet) Apply and Discard: both refused all the same.
  const refused = await app.evaluate(async (_electron, apply) => {
    const controller = (globalThis as unknown as { __avanzel: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> }).__avanzel;
    controller.stopStudy!();
    const said: string[] = [];
    for (const attempt of [() => controller.applyStudy!(apply), () => controller.discardStudy!()]) {
      try {
        await attempt();
        said.push("done");
      } catch (error) {
        said.push((error as Error).message);
      }
    }
    return said;
  }, payload);
  expect(refused).toEqual([STILL_RUNNING, STILL_RUNNING]);
  await expect.poll(() => studyOf(app), { timeout: 30_000 }).toEqual({ kind: "idle", resumable: true });
  // Nothing was applied or discarded: no shelf, and the study's files are there to go on from.
  expect(loadSettings(library).shelves).toEqual([]);
  expect(existsSync(path.join(library, ".avanzel", "study", "plan.json"))).toBe(true);
  await app.close();
});

test("Not now on the offer is kept when Avanzel opens again", async () => {
  const library = await obsidianLibrary();
  const { app, userData } = await launchOn(library);
  const panel = await panelOn(app, "library");
  const card = panel.getByRole("status").filter({ hasText: OFFER_TITLE });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Not now", exact: true }).click();
  await expect.poll(async () => (await panelSnapshot(app)).studyOffer).toBe(false);
  await expect(card).toHaveCount(0);
  await app.close();

  const again = await launchOn(library, { AVANZEL_USER_DATA: userData });
  expect((await panelSnapshot(again.app)).studyOffer).toBe(false);
  const settings = await openSettings(again.app);
  const general = paneOf(settings, "General");
  // Settings doesn't offer it either, but its Learn this library… is still beside Add shelf.
  await expect(general.getByRole("button", { name: "Learn this library…", exact: true })).toBeVisible();
  await expect(general.getByRole("status").filter({ hasText: OFFER_TITLE })).toHaveCount(0);
  await again.app.close();
});

test("Undo of an Apply says what went, and the offer is back", async () => {
  const library = await obsidianLibrary();
  const { app } = await launchOn(library);
  await call(app, "startStudy", true);
  await studyIs(app, "ready");
  await call(app, "applyStudy", applyAll(await studyOf(app)));
  expect(loadSettings(library).shelves.map((shelf) => shelf.folder).sort()).toEqual(["Philosophy", "Рецепты"]);
  expect((await panelSnapshot(app)).studyOffer).toBe(false);
  const capture = await panelOn(app, "capture");
  await capture.getByRole("button", { name: /^Undo the last filing/ }).click();
  await expect.poll(() => notified(app, "Undone"), { timeout: 30_000 }).toEqual([
    { title: "Undone", body: "What Learn this library set up is gone. Your notes are where they were." },
  ]);
  expect(gitOut(library, "log", "-1", "--format=%s").trim()).toBe("avanzel: undo learn this library");
  expect(loadSettings(library).shelves).toEqual([]);
  expect(loadSettings(library).houseStyle).toBe("");
  expect(existsSync(path.join(library, "Philosophy", "Stoicism", "Seneca.md"))).toBe(true);
  await expect.poll(async () => (await panelSnapshot(app)).studyOffer).toBe(true);
  const settings = await openSettings(app);
  await expect(paneOf(settings, "General").getByRole("status").filter({ hasText: OFFER_TITLE })).toBeVisible();
  await app.close();
});

test("a folder left out at Apply comes back as a shelf from Settings' Add definition, and a thought is filed into it", async () => {
  const library = await obsidianLibrary();
  const { app } = await launchOn(library, { AVANZEL_FAKE_TRANSCRIPT: "Суп из свёклы" });
  await call(app, "startStudy", true);
  await studyIs(app, "ready");
  const chosen = applyAll(await studyOf(app));
  chosen.shelves = chosen.shelves.map((shelf) => ({ ...shelf, fileHere: shelf.folder === "Philosophy" }));
  await call(app, "applyStudy", chosen);
  expect(loadSettings(library).excludedFolders).toEqual(["Рецепты"]);

  // Settings still lists the folder as one of the owner's own, with Add definition, which makes it a shelf and brings it back.
  const settings = await openSettings(app);
  const row = settingsRow(settings, "Рецепты");
  await row.getByRole("button", { name: "Add definition", exact: true }).click();
  const general = paneOf(settings, "General");
  await general.getByRole("textbox", { name: "What belongs on it", exact: true }).fill("Dishes to cook.");
  await general.getByRole("button", { name: "Save shelf", exact: true }).click();
  await expect.poll(() => loadSettings(library).excludedFolders).toEqual([]);
  expect(loadSettings(library).shelves.map((shelf) => shelf.folder).sort()).toEqual(["Philosophy", "Рецепты"]);

  // A thought filed into it now stays there: no longer a folder left out, nothing is put back.
  await app.evaluate(() => {
    process.env.FAKE_AGENT_MODE = "new-subfolder";
    process.env.FAKE_AGENT_FOLDER = "Рецепты";
  });
  const before = JSON.stringify(await call(app, "capsuleStateForTests"));
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(async () => {
    const state = (await call(app, "capsuleStateForTests")) as { kind: string };
    return JSON.stringify(state) !== before && (state.kind === "filed" || state.kind === "error") ? state.kind : "";
  }, { timeout: 60_000 }).toBe("filed");
  expect(filesUnder(library, "Рецепты").filter((name) => name.startsWith("idea-"))).toHaveLength(1);
  expect(readFileSync(path.join(library, "Рецепты", "борщ.md"), "utf8")).toBe("# Борщ\n\nСвёкла, капуста, картофель.\n");
  await app.close();
});

test("a study cut short by quitting goes on when Avanzel opens again", async () => {
  const library = await obsidianLibrary();
  const record = recordFile();
  const { app } = await launchOn(library, { ...SLOW, FAKE_AGENT_RECORD: record });
  await call(app, "startStudy", true);
  await runningAt(app, 1);
  const first = studiedFolders(record)[0];
  await app.close();

  const again = await launchOn(library, { FAKE_AGENT_RECORD: record });
  expect(await studyOf(again.app)).toEqual({ kind: "idle", resumable: true });
  const settings = await openSettings(again.app);
  const general = paneOf(settings, "General");
  await general.getByRole("status").filter({ hasText: OFFER_TITLE }).getByRole("button", { name: "Learn this library…", exact: true }).click();
  await general.getByRole("button", { name: "Go on with the study", exact: true }).click();
  await studyIs(again.app, "ready");
  // The folder studied before the quit isn't studied again.
  expect(studiedFolders(record).filter((folder) => folder === first)).toHaveLength(1);
  await again.app.close();
});

test("another library opened mid-study shows its own study, and the old run doesn't overwrite it", async () => {
  const first = await obsidianLibrary();
  // The other library has a study of its own, finished and waiting for review.
  const other = await obsidianLibrary();
  const theirs = await new Librarian(new Vault(other), loadSettings(other)).study({ fresh: true });
  const { app } = await launchOn(first, SLOW);
  await call(app, "startStudy", true);
  await runningAt(app, 0);
  await call(app, "useLibrary", other);
  expect(await studyOf(app)).toEqual({ kind: "ready", proposal: theirs });
  // The first library's run ends (it was stopped as its library closed): the other library's state stays its own.
  await expect.poll(() => runGoing(app), { timeout: 30_000 }).toBe(false);
  expect(await studyOf(app)).toEqual({ kind: "ready", proposal: theirs });
  // Back on the first library: its study stopped part way, and goes on from there.
  await call(app, "useLibrary", first);
  expect(await studyOf(app)).toEqual({ kind: "idle", resumable: true });
  await app.close();
});

test("a study that fails on a usage limit says so, and goes on once the agent can run again", async () => {
  const library = await obsidianLibrary();
  const { app } = await launchOn(library);
  await agentMode(app, "limit");
  await call(app, "startStudy", true);
  await studyIs(app, "failed");
  const failed = (await studyOf(app)) as Extract<StudyState, { kind: "failed" }>;
  expect(failed.message).toMatch(/^The study paused because the agent has reached its usage limit/);
  const settings = await openSettings(app);
  const general = paneOf(settings, "General");
  const notice = general.getByRole("alert").filter({ hasText: failed.message });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Nothing in your library changed. What was studied so far is kept.");
  expect(loadSettings(library).shelves).toEqual([]);
  await agentMode(app, "ok");
  await notice.getByRole("button", { name: "Go on with the study", exact: true }).click();
  await studyIs(app, "ready");
  await app.close();
});

test("the house style is edited and removed in Settings", async () => {
  const library = await obsidianLibrary();
  const { app } = await launchOn(library);
  await call(app, "setHouseStyle", "Dates as dd.mm.yyyy.");
  const settings = await openSettings(app);
  const general = paneOf(settings, "General");
  const row = settingsRow(settings, "How this library is written");
  await expect(row).toContainText("Dates as dd.mm.yyyy.");
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = general.getByRole("textbox", { name: "How this library is written", exact: true });
  await expect(editor).toHaveValue("Dates as dd.mm.yyyy.");
  await editor.fill("Dates as yyyy-mm-dd. Headings in sentence case.");
  await general.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => loadSettings(library).houseStyle, { timeout: 30_000 }).toBe("Dates as yyyy-mm-dd. Headings in sentence case.");
  await expect(editor).toHaveCount(0);
  await expect(row).toContainText("Dates as yyyy-mm-dd. Headings in sentence case.");
  // AGENTS.md, which holds Avanzel's own sections, carries the style for every agent.
  expect(agentsMd(library)).toContain("## How this library is written\n\nDates as yyyy-mm-dd. Headings in sentence case.\n");
  expect(agentsMd(library)).not.toContain("Dates as dd.mm.yyyy.");
  expect(gitOut(library, "log", "-1", "--format=%s").trim()).toBe("avanzel: set the house style");
  // Remove asks first.
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  const ask = general.getByRole("alertdialog", { name: "Remove the house style?", exact: true });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(() => loadSettings(library).houseStyle, { timeout: 30_000 }).toBe("");
  await expect(general.getByText("How this library is written", { exact: true })).toHaveCount(0);
  expect(agentsMd(library)).not.toContain("How this library is written");
  await app.close();
});
