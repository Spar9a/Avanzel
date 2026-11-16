// Learn this library, end to end: a library of the owner's own folders (as an Obsidian vault has them) is studied one folder at a time by
// the engine's fake agent, which answers each study step with JSON built from its prompt; the owner reviews what it learned in Settings and
// applies it, and filing then adds to the old notes without rewriting them. Each filing here is a real one, by the fake agent.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import type { StudyState } from "../src/shared/ipc.ts";
import { agentMode, launchOn, obsidianLibrary, panelOn, recordFile, SENECA, SENECA_TEXT, studiedFolders, studyIs, studyOf } from "./capsule-helpers.ts";
import { call, capsuleKind, filesUnder, gitOut, makeLibrary, openSettings, paneOf } from "./helpers.ts";

const OFFER_TITLE = "This library has folders of its own.";
const REVIEW_TITLE = "The study is ready.";
const THOUGHT = "Сенека о письмах";

/** Records a thought (the transcript the app was launched with) and waits for its filed card. */
async function fileAThought(app: ElectronApplication): Promise<void> {
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toMatch(/^(filed|error)$/);
  // A problem instead of Filed is told whole, so a failure says what the capsule said.
  expect(JSON.stringify(await call(app, "capsuleStateForTests")).slice(0, 2000)).toMatch(/^\{"kind":"filed"/);
}

/** Today as an entry of Seneca.md is dated: dd.mm.yyyy. */
const today = () => {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
};

/** One proposed folder's group on the review screen, by its heading. */
const proposed = (general: ReturnType<typeof paneOf>, name: string) =>
  general.locator("section.av-group", { has: general.page().getByRole("heading", { name, exact: true }) });

test("an Obsidian-like library is studied folder by folder, reviewed and applied, and a thought is then added to an old note", async () => {
  const library = await obsidianLibrary();
  const { app } = await launchOn(library, { FAKE_AGENT_MODE: "add-to-found", AVANZEL_FAKE_TRANSCRIPT: THOUGHT });
  const settings = await openSettings(app);
  const general = paneOf(settings, "General");
  // The offer, with its Learn this library…, which shows what a study costs: two folders (not the attachments, not .obsidian), three runs.
  const offer = general.getByRole("status").filter({ hasText: OFFER_TITLE });
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Learn this library…", exact: true }).click();
  await expect(general.getByText(/reads up to 2 notes in 2 folders, in 3 runs, one folder at a time/)).toBeVisible();
  await general.getByRole("button", { name: "Start study", exact: true }).click();
  await studyIs(app, "ready");

  // The review screen: each folder with what belongs on it, and the house style the study wrote.
  await expect(general.getByText(REVIEW_TITLE, { exact: true })).toBeVisible();
  await expect(general.getByRole("textbox", { name: "What belongs on Philosophy", exact: true })).toHaveValue("Notes about Philosophy.");
  await expect(general.getByRole("textbox", { name: "What belongs on Рецепты", exact: true })).toHaveValue("Notes about Рецепты.");
  await expect(proposed(general, "Philosophy")).toHaveCount(1);
  await expect(general.getByRole("textbox", { name: "How this library is written", exact: true })).toHaveValue("Dates as dd.mm.yyyy.");
  // Рецепты is left alone; Philosophy becomes a shelf.
  const recipes = general.getByRole("switch", { name: "File here: Рецепты", exact: true });
  await expect(recipes).toBeChecked();
  await recipes.click();
  await expect(recipes).not.toBeChecked();
  await general.getByRole("button", { name: "Apply", exact: true }).click();
  await studyIs(app, "idle");
  await expect.poll(() => loadSettings(library).shelves.map((shelf) => shelf.folder)).toEqual(["Philosophy"]);
  const [shelf] = loadSettings(library).shelves;
  expect(shelf).toMatchObject({ folder: "Philosophy", name: "Philosophy", definition: "Notes about Philosophy." });
  expect(shelf?.learnedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(loadSettings(library).excludedFolders).toEqual(["Рецепты"]);
  expect(loadSettings(library).houseStyle).toBe("Dates as dd.mm.yyyy.");
  expect(gitOut(library, "log", "-1", "--format=%s").trim()).toBe("avanzel: learn this library");
  // Nothing of the owner's moved or changed.
  expect(readFileSync(path.join(library, SENECA), "utf8")).toBe(SENECA_TEXT);
  expect(existsSync(path.join(library, ".avanzel", "study"))).toBe(false);
  // The review screen is gone: the shelves are back, with Philosophy among them.
  await expect(general.getByText(REVIEW_TITLE, { exact: true })).toHaveCount(0);
  await expect(general.getByText("Philosophy", { exact: true }).first()).toBeVisible();

  // A thought about Seneca is added to the old note, as its entries are written: every old line stays.
  await fileAThought(app);
  const seneca = readFileSync(path.join(library, SENECA), "utf8");
  expect(seneca.startsWith(SENECA_TEXT)).toBe(true);
  expect(seneca.slice(SENECA_TEXT.length)).toBe(`\n## ${today()}\n${THOUGHT}\n`);
  expect(filesUnder(library, "ideas").filter((name) => name.startsWith("idea-"))).toEqual([]);
  await app.close();
});

test("a study stopped from the panel goes on from where it stopped", async () => {
  const library = await obsidianLibrary();
  const record = recordFile();
  const { app } = await launchOn(library, { FAKE_AGENT_DELAY_MS: "2500", FAKE_AGENT_DELAY_TASK: "study-folder", FAKE_AGENT_RECORD: record });
  await call(app, "startStudy", true);
  // The first folder is studied; Stop lands while the second one is.
  await expect.poll(async () => {
    const study = await studyOf(app);
    return study.kind === "running" ? study.done : -1;
  }, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => studiedFolders(record).length).toBe(2); // the second folder's run has begun
  const panel = await panelOn(app, "library");
  const card = panel.getByRole("status").filter({ hasText: /^Studying / });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => studyOf(app), { timeout: 30_000 }).toEqual({ kind: "idle", resumable: true });
  const before = studiedFolders(record);
  expect(before).toHaveLength(2);
  // Go on with the study, as Settings offers it: the folder studied before the Stop isn't studied again.
  await call(app, "hidePanel");
  const settings = await openSettings(app);
  const general = paneOf(settings, "General");
  await general.getByRole("status").filter({ hasText: OFFER_TITLE }).getByRole("button", { name: "Learn this library…", exact: true }).click();
  await general.getByRole("button", { name: "Go on with the study", exact: true }).click();
  await studyIs(app, "ready");
  const all = studiedFolders(record);
  // The Stop cut the second folder's run short, before it answered, so that one folder is asked again; the first is not.
  expect(all).toEqual([...before, before[1]]);
  expect(new Set(all)).toEqual(new Set(["Philosophy", "Рецепты"]));
  const proposal = (await studyOf(app)) as Extract<StudyState, { kind: "ready" }>;
  expect(proposal.proposal.shelves.map((shelf) => shelf.folder).sort()).toEqual(["Philosophy", "Рецепты"]);
  await app.close();
});

test("a thought recorded while a study runs is filed before the study ends", async () => {
  const library = await obsidianLibrary();
  const { app } = await launchOn(library, { FAKE_AGENT_DELAY_MS: "5000", FAKE_AGENT_DELAY_TASK: "study-folder" });
  await call(app, "startStudy", true);
  await expect.poll(async () => {
    const study = await studyOf(app);
    return study.kind === "running" && study.steps > 0;
  }).toBe(true);
  await fileAThought(app);
  // Filed between two of the study's steps: the study still runs.
  expect((await studyOf(app)).kind).toBe("running");
  expect(filesUnder(library, "ideas").filter((name) => name.startsWith("idea-"))).toHaveLength(1);
  await studyIs(app, "ready");
  await app.close();
});

/** A Philosophy shelf that a study learned, applied the way the review screen applies it, before any filing. */
async function learnedPhilosophy(app: ElectronApplication): Promise<void> {
  await call(app, "applyStudy", {
    shelves: [
      { folder: "Philosophy", name: "Philosophy", definition: "Notes on thinkers.", map: "", fileHere: true },
      { folder: "Рецепты", name: "Рецепты", definition: "", map: "", fileHere: false },
    ],
    style: "",
  });
}

test("a rewritten old note is put back and the filed card says so; a new subfolder is named on the card and Undo removes it", async () => {
  const library = await obsidianLibrary();
  const { app, capsule } = await launchOn(library, { AVANZEL_FAKE_TRANSCRIPT: THOUGHT });
  await learnedPhilosophy(app);
  // The agent only rewrites Seneca.md: it is put back as it was, and as nothing else was done, the thought isn't filed and says why.
  await agentMode(app, "rewrite-found");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  expect(readFileSync(path.join(library, SENECA), "utf8")).toBe(SENECA_TEXT);
  await expect(capsule.getByText(/only changed notes it may not rewrite, so they were put back as they were/)).toBeVisible();
  // The agent rewrites Seneca.md and writes a page of its own: the note is put back, the page is filed, and the card says so.
  await agentMode(app, "rewrite-found-page");
  await fileAThought(app);
  expect(readFileSync(path.join(library, SENECA), "utf8")).toBe(SENECA_TEXT);
  expect(filesUnder(library, "ideas").filter((name) => name.startsWith("idea-"))).toHaveLength(1);
  await expect(capsule.getByText("Seneca was kept as it was: old notes are only added to.", { exact: true })).toBeVisible();
  // The agent files into a folder of its own inside the shelf: the card names it, and Undo takes it away.
  await app.evaluate(() => {
    process.env.FAKE_AGENT_MODE = "new-subfolder";
    process.env.FAKE_AGENT_FOLDER = "Philosophy/Stoicism/Letters";
  });
  await fileAThought(app);
  const letters = path.join(library, "Philosophy", "Stoicism", "Letters");
  expect(filesUnder(library, "Philosophy/Stoicism/Letters")).toHaveLength(1);
  await expect(capsule.getByText("New folder: Letters", { exact: true })).toBeVisible();
  await capsule.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => existsSync(letters), { timeout: 30_000 }).toBe(false);
  expect(existsSync(path.join(library, SENECA))).toBe(true);
  expect(readFileSync(path.join(library, SENECA), "utf8")).toBe(SENECA_TEXT);
  await app.close();
});

test("fifty own shelves: Settings lists them all and Library's shelf tabs wrap", async () => {
  const library = await makeLibrary();
  const names = Array.from({ length: 50 }, (_, i) => `Shelf ${String(i + 1).padStart(2, "0")}`);
  for (const name of names) {
    mkdirSync(path.join(library, name));
    writeFileSync(path.join(library, name, "note.md"), `# ${name}\n`);
  }
  saveSettings(library, { ...loadSettings(library), shelves: names.map((name) => ({ folder: name, name, definition: `What goes on ${name}.` })) });
  const { app } = await launchOn(library);
  const settings: Page = await openSettings(app);
  const general = paneOf(settings, "General");
  // Every shelf has its row in Your shelves.
  for (const name of names) await expect(general.locator(".av-group-row", { has: settings.getByText(name, { exact: true }) })).toHaveCount(1);
  // Library's tabs: one for each, in lines that wrap inside the window, so none runs off its side.
  const tabs = general.locator('[data-shelf="own"][data-variant="tab"]');
  await expect(tabs).toHaveCount(50);
  const boxes = await tabs.evaluateAll((all) => all.map((tab) => tab.getBoundingClientRect()).map(({ top, right }) => ({ top, right })));
  const width = await settings.evaluate(() => document.documentElement.clientWidth);
  expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBeGreaterThan(1);
  for (const box of boxes) expect(box.right).toBeLessThanOrEqual(width);
  expect(await settings.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  // No offer: every folder is a shelf already.
  await expect(general.getByRole("status").filter({ hasText: OFFER_TITLE })).toHaveCount(0);
  await app.close();
});
