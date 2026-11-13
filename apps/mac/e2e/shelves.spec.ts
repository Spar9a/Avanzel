// Your own shelves: one added in Settings, and one the librarian suggests after a filing, asked about on the filed card (in the capsule
// and in the panel's Processing) and in Library, where Make shelf, Edit first and No answer it. Each filing here is a real one, by the
// engine's fake agent, which ends its reply with "New shelf: …" (FAKE_AGENT_SUGGEST) as a librarian that asks for a shelf does.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadSettings } from "../../../packages/engine/src/index.ts";
import { barOf, holdTheQueue, launchOn, letTheQueueGo, notified, panelOn, panelSnapshot } from "./capsule-helpers.ts";
import { call, capsuleKind, filesUnder, gitOut, makeLibrary, openSettings, paneOf, pickIn } from "./helpers.ts";

/** What the fake librarian suggests after each filing: a Projects shelf, for the page the filing wrote. */
const SUGGEST = "projects | Projects | Work with a goal. | {page}";
const QUESTION = "This might belong on a new shelf: Projects";
const DEFINITION = "Work with a goal.";
const WORDS = "Plant tulips in October";

/** A library with git (so Make shelf can be undone) and a page on Goals, opened by an app whose librarian suggests a Projects shelf. */
async function suggesting(env: Record<string, string> = {}) {
  const library = await makeLibrary({ git: true });
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n");
  gitOut(library, "add", "-A");
  gitOut(library, "commit", "-qm", "a page on goals");
  const launched = await launchOn(library, { FAKE_AGENT_SUGGEST: SUGGEST, ...env });
  return { ...launched, library };
}

/** Records "Plant tulips in October", files it, and waits for its filed card. */
async function fileAThought(app: ElectronApplication): Promise<void> {
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
}

/** The filed card in `page` (the capsule's, or the panel's Processing). */
const filedCard = (page: Page) => page.getByRole("article").filter({ hasText: WORDS }).filter({ has: page.getByRole("img", { name: /^Filed, / }) });

/** The subject of the library's newest commit, and that of Make shelf's: each shelf operation is one commit, made once it is all done. */
const lastCommit = (library: string) => gitOut(library, "log", "-1", "--format=%s").trim();
const MADE = "avanzel: make shelf projects";

/** The pages the filing wrote under `folder`. */
const pagesIn = (library: string, folder: string) => filesUnder(library, folder).filter((name) => name.startsWith("idea-"));

/** Library's question about a pending shelf: a Notice, by its title. */
const libraryQuestion = (panel: Page, name = "Projects") => panel.getByRole("status").filter({ hasText: `Make a ${name} shelf?` });

/** A row of Library's list, by its page's path. */
const row = (panel: Page, rel: string) => panel.locator(`[id="page-${rel}"]`);

test("(a) a shelf added in Settings is listed in AGENTS.md and in the shelf drawer", async () => {
  const library = await makeLibrary();
  const { app } = await launchOn(library);
  const settings = await openSettings(app);
  const general = paneOf(settings, "General");
  await general.getByRole("button", { name: "Add shelf", exact: true }).click();
  await general.getByRole("textbox", { name: "Name", exact: true }).fill("Projects");
  // The folder follows the name.
  await expect(general.getByRole("textbox", { name: "Folder", exact: true })).toHaveValue("projects");
  await general.getByRole("textbox", { name: "What belongs on it", exact: true }).fill(DEFINITION);
  await general.getByRole("button", { name: "Save shelf", exact: true }).click();
  await expect.poll(() => loadSettings(library).shelves).toEqual([{ folder: "projects", name: "Projects", definition: DEFINITION }]);
  expect(readFileSync(path.join(library, "AGENTS.md"), "utf8")).toContain(`| \`projects/\` | ${DEFINITION} |`);
  // The drawer has a tab for it after the six, in the own-shelf look, with its total.
  const tab = general.locator('[data-shelf="own"][data-variant="tab"]');
  await expect(tab).toHaveCount(1);
  await expect(tab).toContainText("Projects");
  await app.close();
});

test("(b) the filed card asks, Make shelf moves the page onto the new shelf, and Library tags it and filters by it", async () => {
  const { app, capsule, library } = await suggesting();
  await fileAThought(app);
  const card = filedCard(capsule);
  await expect(card.getByText(QUESTION, { exact: true })).toBeVisible();
  await expect(card.getByText(DEFINITION, { exact: true })).toBeVisible();
  // Open is the moment's primary, so Make shelf is a regular button beside Not now.
  const make = card.getByRole("button", { name: "Make shelf", exact: true });
  await expect(make).toHaveAttribute("data-variant", "secondary");
  await expect(card.getByRole("button", { name: "Not now", exact: true })).toBeVisible();
  const [page] = pagesIn(library, "ideas");
  expect(page).toBeDefined();
  await make.click();
  await expect.poll(() => lastCommit(library), { timeout: 30_000 }).toBe(MADE);
  expect(pagesIn(library, "projects")).toEqual([page]);
  expect(pagesIn(library, "ideas")).toEqual([]);
  expect(loadSettings(library).shelves.map((shelf) => shelf.folder)).toEqual(["projects"]);
  await expect.poll(() => capsuleKind(app)).toBe("shelf-made");
  await expect(barOf(capsule)).toContainText("Made the Projects shelf and moved 1 page.");
  // Library lists the page on its shelf, tagged Projects in the own look, asks nothing, and filters by the shelf.
  const panel = await panelOn(app, "library");
  const moved = row(panel, `projects/${page}`);
  await expect(moved).toBeVisible();
  await expect(moved.locator('[data-shelf="own"]')).toHaveText("Projects");
  await expect(libraryQuestion(panel)).toHaveCount(0);
  await expect(row(panel, "goals/run.md")).toBeVisible();
  await pickIn(panel, "Filter", "Projects");
  await expect(moved).toBeVisible();
  await expect(row(panel, "goals/run.md")).toHaveCount(0);
  await app.close();
});

test("(c) No in Library turns the shelf down, and the next filing that suggests it asks nothing", async () => {
  const { app, capsule, library } = await suggesting();
  await fileAThought(app);
  // Not now puts the card away; the question waits in Library.
  await filedCard(capsule).getByRole("button", { name: "Not now", exact: true }).click();
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  const panel = await panelOn(app, "library");
  const question = libraryQuestion(panel);
  await expect(question).toBeVisible();
  await expect(question.getByText(DEFINITION, { exact: true })).toBeVisible();
  await expect(question.getByRole("button")).toHaveText(["No", "Edit first", "Make shelf"]);
  await question.getByRole("button", { name: "No", exact: true }).click();
  await expect.poll(() => loadSettings(library).declinedShelves, { timeout: 30_000 }).toEqual(["projects"]);
  await expect(question).toHaveCount(0);
  expect(loadSettings(library).shelves).toEqual([]);
  expect(pagesIn(library, "ideas")).toHaveLength(1); // the page stays where the librarian put it
  await call(app, "hidePanel");
  // A second filing suggests the same shelf: it is turned down, so the card asks nothing, and nor does Library.
  await fileAThought(app);
  await expect(filedCard(capsule)).toBeVisible();
  await expect(filedCard(capsule).getByText(QUESTION, { exact: true })).toHaveCount(0);
  await expect(filedCard(capsule).getByRole("button", { name: "Make shelf", exact: true })).toHaveCount(0);
  expect((await panelSnapshot(app)).shelfSuggestions).toEqual([]);
  await app.close();
});

test("(d) Make shelf from the panel's Processing, then Undo: the page is back on Ideas, and Library asks again", async () => {
  const { app, library } = await suggesting();
  await fileAThought(app);
  const [page] = pagesIn(library, "ideas");
  // The panel's Processing shows the same filed card, with the same question, and its Make shelf works there too.
  const panel = await panelOn(app, "capture");
  await call(app, "showPanel", "processing");
  await expect(panel.getByRole("tablist", { name: "Sections" }).getByRole("tab", { name: /^Processing/ })).toHaveAttribute("aria-selected", "true");
  const card = filedCard(panel);
  await expect(card.getByText(QUESTION, { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Make shelf", exact: true }).click();
  await expect.poll(() => lastCommit(library), { timeout: 30_000 }).toBe(MADE);
  expect(pagesIn(library, "projects")).toEqual([page]);
  // Undo the last filing, on Capture, takes the shelf back: the page is on Ideas again, and Library asks about the shelf again.
  const capture = await panelOn(app, "capture");
  await capture.getByRole("button", { name: /^Undo the last filing/ }).click();
  await expect.poll(() => lastCommit(library), { timeout: 30_000 }).toBe(`avanzel: undo ${MADE.replace("avanzel: ", "")}`);
  expect(pagesIn(library, "ideas")).toEqual([page]);
  expect(pagesIn(library, "projects")).toEqual([]);
  expect(loadSettings(library).shelves).toEqual([]);
  await expect.poll(() => notified(app, "Undone")).toEqual([
    { title: "Undone", body: "The Projects shelf is gone, and its pages are back where they were. Library asks about it again." },
  ]);
  const again = await panelOn(app, "library");
  await expect(libraryQuestion(again)).toBeVisible();
  await expect(row(again, `ideas/${page}`)).toBeVisible();
  await app.close();
});

test("(e) Make shelf waits while another run has the library: the button is busy, and the shelf is made once it ends", async () => {
  const { app, capsule, library } = await suggesting();
  await fileAThought(app);
  // On the card: the queue is held, so Make shelf waits its turn, busy, and nothing is made until the queue lets go.
  await holdTheQueue(app);
  const make = filedCard(capsule).getByRole("button", { name: "Make shelf", exact: true });
  await make.click();
  await expect(make).toHaveAttribute("aria-busy", "true");
  await capsule.waitForTimeout(500);
  expect(pagesIn(library, "projects")).toEqual([]);
  expect(await capsuleKind(app)).toBe("filed");
  await letTheQueueGo(app);
  await expect.poll(() => pagesIn(library, "projects"), { timeout: 30_000 }).toHaveLength(1);
  await expect.poll(() => capsuleKind(app)).toBe("shelf-made");
  await app.close();
});

test("(e) Library's Make shelf, pressed while a slow filing runs, is busy until that filing ends, and then makes the shelf", async () => {
  const { app, capsule, library } = await suggesting();
  await fileAThought(app);
  await filedCard(capsule).getByRole("button", { name: "Not now", exact: true }).click();
  const [first] = pagesIn(library, "ideas");
  // The next filing takes a while and suggests nothing: it holds the library while Make shelf is pressed.
  await app.evaluate(() => {
    process.env.FAKE_AGENT_DELAY_MS = "5000";
    delete process.env.FAKE_AGENT_SUGGEST;
  });
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  const panel = await panelOn(app, "library");
  const make = libraryQuestion(panel).getByRole("button", { name: "Make shelf", exact: true });
  await make.click();
  await expect(make).toHaveAttribute("aria-busy", "true");
  await expect(libraryQuestion(panel).getByRole("button", { name: "No", exact: true })).toBeDisabled();
  expect(pagesIn(library, "projects")).toEqual([]);
  // The filing ends first, then the shelf is made, with the first filing's page on it: two commits, in that order.
  await expect.poll(() => lastCommit(library), { timeout: 60_000 }).toBe(MADE);
  expect(gitOut(library, "log", "-2", "--format=%s").trim().split("\n")[1]).toMatch(/^avanzel: file /);
  expect(pagesIn(library, "projects")).toEqual([first]);
  await expect(libraryQuestion(panel)).toHaveCount(0);
  await app.close();
});

test("(f) Edit first in Library opens Settings' shelf form filled in, and Save makes the shelf and moves the page", async () => {
  const { app, capsule, library } = await suggesting();
  await fileAThought(app);
  await filedCard(capsule).getByRole("button", { name: "Not now", exact: true }).click();
  const [page] = pagesIn(library, "ideas");
  const panel = await panelOn(app, "library");
  await libraryQuestion(panel).getByRole("button", { name: "Edit first", exact: true }).click();
  // Settings → General, with the form filled in from the suggestion, saying what Save does.
  await expect(panel.getByRole("tablist", { name: "Sections" }).getByRole("tab", { name: "Settings", exact: true })).toHaveAttribute("aria-selected", "true");
  const general = paneOf(panel, "General");
  await expect(general.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Projects");
  await expect(general.getByRole("textbox", { name: "Folder", exact: true })).toHaveValue("projects");
  await expect(general.getByRole("textbox", { name: "What belongs on it", exact: true })).toHaveValue(DEFINITION);
  await expect(general.getByText("Saving makes the shelf and moves the page it was suggested for onto it.", { exact: true })).toBeVisible();
  await general.getByRole("textbox", { name: "Name", exact: true }).fill("Work projects");
  await general.getByRole("button", { name: "Save shelf", exact: true }).click();
  await expect.poll(() => lastCommit(library), { timeout: 30_000 }).toBe(MADE);
  expect(pagesIn(library, "projects")).toEqual([page]);
  expect(loadSettings(library).shelves).toEqual([{ folder: "projects", name: "Work projects", definition: DEFINITION }]);
  // The question is answered: Library no longer asks.
  await expect.poll(async () => (await panelSnapshot(app)).shelfSuggestions).toEqual([]);
  const after = await panelOn(app, "library");
  await expect(libraryQuestion(after)).toHaveCount(0);
  await expect(libraryQuestion(after, "Work projects")).toHaveCount(0);
  await expect(row(after, `projects/${page}`).locator('[data-shelf="own"]')).toHaveText("Work projects");
  await app.close();
});
