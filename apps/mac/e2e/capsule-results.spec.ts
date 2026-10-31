// The capsule's result cards: a filing that ends well, one that only noted its capture, a thought saved for the evening review, a filing
// that was undone, the two Stopped cards, the pages a card lists and opens, and Undo. Moved out of filing.spec.ts as they were.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  agentStubs,
  answerAs,
  call,
  capsuleKind,
  filesUnder,
  makeLibrary,
  openedWith,
  screenshotFixture,
  snap,
  stubOpening,
  windowFor,
} from "./helpers.ts";
import {
  archived,
  claudeLibrary,
  dictate,
  expectInPanel,
  expectStoppedFiling,
  expectStoppedRecording,
  inbox,
  launchOn,
  type Left,
  namesOf,
  notified,
  reachedUndo,
  stampDay,
  undoCalls,
  undone,
  watchUndos,
} from "./capsule-helpers.ts";
import { zel } from "./setup-helpers.ts";

// ---- The result cards: paper over a bar ----
//
// A filing that ends well is the person's words on a card, stamped, over a bar that says who filed it and how long it took, with
// Hide, Undo and Open. One that only noted its capture in the log says so. A thought saved for the evening review, a thought whose
// filing was undone, and the two Stopped cards (a filing, and a transcription whose recording waits in the inbox) are paper over a
// bar too. Hide is the bar's first button on every one of them. Most of these read what the page draws from a state put on the
// capsule (`setCapsule`, as the filing card's do); the ones that need main to have a filing's pages run a filing.

/** A page's left edge, to say what comes before what in a row. */
const leftOf = async (locator: Locator) => (await locator.boundingBox())!.x;

/** Three pages a filing wrote: one new on a shelf, one updated on a shelf, and one in a folder that is no shelf, whose state doesn't say. */
const PAGES = [
  { title: "Tulips for October", shelf: "ideas", path: "ideas/tulips.md", created: true },
  { title: "Run a marathon", shelf: "goals", path: "goals/run.md", created: false },
  { title: "Garden plan", shelf: "projects", path: "projects/garden.md" },
];

/** A filed state as main sends it. `over` changes some of it. */
const filedCard = (over: Record<string, unknown> = {}) => ({
  kind: "filed",
  text: "Plant tulips in October",
  agent: "Claude Code",
  seconds: 23.4,
  pages: PAGES,
  canUndo: true,
  noted: false,
  ...over,
});

/** A thought saved for the evening review, as main sends it. */
const savedCard = (over: Record<string, unknown> = {}) => ({
  kind: "saved",
  text: "Call the plumber on Monday",
  note: "Saved to the inbox for the evening review at 21:00.",
  ...over,
});

/** A filing Stop ended, as main sends it. */
const cancelledCard = (over: Record<string, unknown> = {}) => ({
  kind: "cancelled",
  text: "Plant tulips in October",
  agent: "Claude Code",
  partial: false,
  leftovers: 0,
  review: "at 21:00",
  ...over,
});

/** A transcription Stop ended, as main sends it. */
const recordedCard = (over: Record<string, unknown> = {}) => ({ kind: "recorded", review: "at 21:00", ...over });

test("a filed card is the words stamped Filed over a bar that says who filed it and how long it took, with Hide, Undo and Open", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await call(app, "setCapsule", filedCard());
  await snap(capsule, "3-filed-card");
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  // The bar: Zel glad, one line that names the agent and the whole seconds, and three small buttons. Hide is first, quiet and
  // icon-only; Undo is secondary; Open is the moment's one primary, last.
  await expect(zel(capsule)).toHaveAttribute("data-mood", "filed");
  const line = bar.getByText("Filed by Claude Code in 23 s", { exact: true });
  await expect(line).toBeVisible();
  expect(await line.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0); // the buttons leave it room: it is not cut off
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide", "Undo", "Open"]);
  await expect(bar.getByRole("button", { name: "Hide", exact: true })).toHaveAttribute("data-variant", "quiet");
  await expect(bar.getByRole("button", { name: "Hide", exact: true })).toHaveAttribute("data-icon-only", "");
  await expect(bar.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("data-variant", "secondary");
  await expect(bar.getByRole("button", { name: "Open", exact: true })).toHaveAttribute("data-variant", "primary");
  for (const button of await bar.getByRole("button").all()) await expect(button).toHaveAttribute("data-size", "small");
  // The card above it: the words of the thought, stamped Filed with today's date.
  await expect(card.getByText("Thought", { exact: true })).toBeVisible();
  await expect(card.getByText("Plant tulips in October", { exact: true })).toBeVisible();
  await expect(card).toHaveAttribute("data-stamped", "");
  await expect(card.getByRole("img", { name: `Filed, ${stampDay()}`, exact: true })).toBeVisible();
  // The Filed stamp is the one that lands with a thunk, as the work finishes: it is told to animate, where Noted and Saved are not.
  await expect(card.getByRole("img", { name: `Filed, ${stampDay()}`, exact: true })).toHaveAttribute("data-animate", "");
  // Only the stamp gives way to the words, and only on the first line: their box is as wide as the card's lines. A box of its own
  // (overflow hidden) would stand beside the stamp as a whole, and narrow every line.
  const gap = await card.getByText("Plant tulips in October", { exact: true }).evaluate((el) => {
    const lines = el.parentElement!;
    const style = getComputedStyle(lines);
    return lines.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - el.clientWidth;
  });
  expect(Math.abs(gap)).toBeLessThanOrEqual(1);
  // Its footer: a row for each page, three here. A page on a shelf has the shelf's chip, then its title as a link, then whether it
  // is new or updated.
  const rows = card.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  const [made, changed, folder] = [rows.nth(0), rows.nth(1), rows.nth(2)];
  await expect(made.locator("[data-shelf]")).toHaveText("Ideas");
  await expect(made.getByRole("button", { name: "Tulips for October", exact: true })).toHaveAttribute("data-variant", "link");
  await expect(made.getByText("new", { exact: true })).toBeVisible();
  expect(await leftOf(made.locator("[data-shelf]"))).toBeLessThan(await leftOf(made.getByRole("button")));
  expect(await leftOf(made.getByRole("button"))).toBeLessThan(await leftOf(made.getByText("new", { exact: true })));
  await expect(changed.locator("[data-shelf]")).toHaveText("Goals");
  await expect(changed.getByRole("button", { name: "Run a marathon", exact: true })).toHaveAttribute("data-variant", "link");
  await expect(changed.getByText("updated", { exact: true })).toBeVisible();
  // A page in a folder that is no shelf has no chip: the folder's name stands in its place. A page whose state doesn't say new reads updated.
  await expect(folder.locator("[data-shelf]")).toHaveCount(0);
  await expect(folder.getByText("projects", { exact: true })).toBeVisible();
  await expect(folder.getByRole("button", { name: "Garden plan", exact: true })).toHaveAttribute("data-variant", "link");
  await expect(folder.getByText("updated", { exact: true })).toBeVisible();
  expect(await leftOf(folder.getByText("projects", { exact: true }))).toBeLessThan(await leftOf(folder.getByRole("button")));
  // The columns line up from row to row: each title starts where the others do, and each caption ends where the others do.
  const titleAt = [made, changed, folder].map((row) => leftOf(row.getByRole("button")));
  expect(new Set(await Promise.all(titleAt)).size).toBe(1);
  const right = async (locator: Locator) => { const box = (await locator.boundingBox())!; return box.x + box.width; };
  expect(new Set(await Promise.all([made.getByText("new", { exact: true }), changed.getByText("updated", { exact: true }), folder.getByText("updated", { exact: true })].map(right))).size).toBe(1);
  // Three pages are all of them: nothing is left to count.
  await expect(card.getByText(/^and \d+ more$/)).toHaveCount(0);
  await expectInPanel(capsule);
  await app.close();
});

test("a filed card counts whole seconds, and never says 0 s", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const bar = capsule.getByRole("status");
  for (const [seconds, said] of [[0, "1 s"], [0.2, "1 s"], [1.4, "1 s"], [8.6, "9 s"], [23.4, "23 s"], [75, "75 s"]] as const) {
    await call(app, "setCapsule", filedCard({ seconds }));
    await expect(bar.getByText(`Filed by Claude Code in ${said}`, { exact: true })).toBeVisible();
  }
  await app.close();
});

test("a filed card lists three pages and counts the rest: four pages are three rows and 'and 1 more'", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const card = capsule.getByRole("article");
  const pages = [...PAGES, { title: "Ana", shelf: "people", path: "people/ana.md", created: true }, { title: "Reading list", shelf: "topics", path: "topics/reading.md", created: true }];
  await call(app, "setCapsule", filedCard({ pages: pages.slice(0, 4) }));
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByText("and 1 more", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Ana", exact: true })).toHaveCount(0); // the fourth is the count's
  await expectInPanel(capsule);
  await call(app, "setCapsule", filedCard({ pages }));
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByText("and 2 more", { exact: true })).toBeVisible();
  await expect(card.getByText("and 1 more", { exact: true })).toHaveCount(0);
  // The pages Open and the titles open are the card's own: Open is still there, whatever the count.
  expect(await namesOf(capsule.getByRole("status").getByRole("button"))).toEqual(["Hide", "Undo", "Open"]);
  await app.close();
});

test("a filed card clips long words to three lines while its pages show, and the most it can hold fits the panel", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const long = "I want to launch my podcast about indie game development before the end of the year, and ask Mark to co-host. ".repeat(12).trim();
  const title = "An idea page whose title goes on and on about indie game development and the podcast that Mark may co-host this year";
  // The widest chip and caption, a folder with a long name, and a title longer than a row: each row still stays on one line, inside
  // the card, and the shelf's column is no wider than the longest name it gives room to.
  // A Japanese title too: 25 characters, each about as wide as two of the Latin ones, so counted by characters it would run out of its column.
  const japanese = "日本語のとても長いページのタイトルがここに入ります";
  const pages = [
    { title, shelf: "memories", path: "memories/a.md", created: false },
    { title, shelf: "a-folder-whose-name-goes-on-and-on-and-on", path: "a-folder-whose-name-goes-on-and-on-and-on/b.md", created: false },
    { title: japanese, shelf: "memories", path: "memories/c.md", created: false },
    { title, shelf: "memories", path: "memories/d.md", created: false },
  ];
  await call(app, "setCapsule", filedCard({ text: long, pages }));
  const card = capsule.getByRole("article");
  const words = card.getByText(long, { exact: true });
  await expect(words).toBeVisible();
  const cut = await words.evaluate((el) => ({ shown: el.clientHeight, whole: el.scrollHeight, pitch: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(cut.shown).toBe(3 * cut.pitch);
  expect(cut.whole).toBeGreaterThan(cut.shown);
  const cardBox = (await card.boundingBox())!;
  for (const row of await card.getByRole("listitem").all()) {
    const box = (await row.boundingBox())!;
    expect(box.height).toBeLessThan(30); // one line
    expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    const link = row.getByRole("button");
    expect(await link.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0); // the title is whole, or shortened with "…"
    expect((await link.boundingBox())!.x + (await link.boundingBox())!.width).toBeLessThanOrEqual((await row.getByText("updated", { exact: true }).boundingBox())!.x);
  }
  // The Japanese title is cut where its column ends, and shows its start, and its "…".
  await expect(card.getByRole("button", { name: /^日本語/ })).toHaveText(/^日本語.*…$/);
  const folders = card.getByText("a-folder-whose-name-goes-on-and-on-and-on", { exact: true });
  expect((await folders.boundingBox())!.width).toBeLessThanOrEqual(96); // the folder's name is cut off, with "…", at the column's width
  expect(await folders.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(card.getByText("and 1 more", { exact: true })).toBeVisible();
  await expectInPanel(capsule);
  // With no receipt under them (nothing new to file) the words have the room: four lines.
  await call(app, "setCapsule", filedCard({ text: long, noted: true, pages: [] }));
  const roomy = await card.getByText(long, { exact: true }).evaluate((el) => ({ shown: el.clientHeight, pitch: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(roomy.shown).toBe(4 * roomy.pitch);
  await expectInPanel(capsule);
  await app.close();
});

test("a thought the filing card showed whole is shown whole on the card that is stamped: the stamp shortens the first line, so a third line is kept", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  // Two lines on the filing card, which has nothing in its corner. The filed card's stamp stands where the first line would run on, and the
  // first line wraps around it: the same words need three lines, and a limit of two ended them at "...and ask Mark to co-" as the stamp landed.
  const thought = "I want to launch my podcast about indie game development before the end of the year, and ask Mark to co-host.";
  const card = capsule.getByRole("article");
  const room = () => card.getByText(thought, { exact: true }).evaluate((el) => ({ shown: el.clientHeight, whole: el.scrollHeight, pitch: parseFloat(getComputedStyle(el).lineHeight) }));
  await call(app, "setCapsule", {
    kind: "filing", text: thought, agent: "Claude Code", transcribedIn: 1.4, onThisMac: true, canEdit: true, rows: [], startedAt: Date.now(), estimate: 15, stepAt: Date.now(),
  });
  await expect(card.getByText(thought, { exact: true })).toBeVisible();
  const filing = await room();
  expect(filing.whole).toBe(2 * filing.pitch);
  expect(filing.shown).toBe(filing.whole);
  // Filed, with its pages listed under it: three lines, all of them shown.
  await call(app, "setCapsule", filedCard({ text: thought }));
  await expect(card.getByRole("img", { name: `Filed, ${stampDay()}`, exact: true })).toBeVisible();
  const filed = await room();
  expect(filed.whole).toBe(3 * filed.pitch);
  expect(filed.shown).toBe(filed.whole); // its end, "co-host.", is not cut off
  await expectInPanel(capsule);
  // A screen comment of two lines is saved the same way: its stamp takes the first line's end, and the picture is under the words.
  const thumbnail = `data:image/png;base64,${readFileSync(screenshotFixture()).toString("base64")}`;
  await call(app, "setCapsule", savedCard({ text: thought, thumbnail, context: { app: "Safari", title: "Growing basil", url: "https://example.com/basil" } }));
  await expect(card.getByRole("img", { name: `Saved, ${stampDay()}`, exact: true })).toBeVisible();
  const saved = await room();
  expect(saved.whole).toBe(3 * saved.pitch);
  expect(saved.shown).toBe(saved.whole);
  await expectInPanel(capsule);
  await app.close();
});

test("a filing that only noted its capture says so: the card is stamped Noted, and the bar offers Hide, and Undo while there is a commit", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  await call(app, "setCapsule", filedCard({ noted: true, pages: [] }));
  await expect(zel(capsule)).toHaveAttribute("data-mood", "filed");
  await expect(bar.getByText("Nothing new to file", { exact: true })).toBeVisible();
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide", "Undo"]); // no pages: nothing to Open
  await expect(bar.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("data-variant", "secondary");
  await expect(card.getByText("Plant tulips in October", { exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: `Noted, ${stampDay()}`, exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: `Noted, ${stampDay()}`, exact: true })).not.toHaveAttribute("data-animate"); // it doesn't land: nothing was filed
  await expect(card.getByText("Claude Code noted it in the log.", { exact: true })).toBeVisible();
  await expect(card.getByRole("listitem")).toHaveCount(0);
  await expectInPanel(capsule);
  // Without a commit there is nothing to take back.
  await call(app, "setCapsule", filedCard({ noted: true, pages: [], canUndo: false }));
  await expect(bar.getByText("Nothing new to file", { exact: true })).toBeVisible();
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide"]);
  // And a filing that wrote pages but left no commit offers Open and no Undo.
  await call(app, "setCapsule", filedCard({ canUndo: false }));
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide", "Open"]);
  await app.close();
});

test("a filed card whose words the engine put back says so in its head: “Your exact words are kept.”", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const card = capsule.getByRole("article");
  const head = card.locator("header");
  const label = head.getByText("Thought", { exact: true });
  const line = head.getByText("Your exact words are kept.", { exact: true });
  await call(app, "setCapsule", filedCard({ restored: true }));
  await snap(capsule, "3-filed-card-kept");
  // It stands in the card's head, to the right of the label it shares the head with, and the head ends before the stamp, so it fits on one
  // line. That is asked of its words, not of its box: a flex item is one box however its words wrap, and a Range has a rect for each line.
  await expect(label).toBeVisible();
  await expect(line).toBeVisible();
  expect(await leftOf(label)).toBeLessThan(await leftOf(line));
  expect(
    await line.evaluate((el) => {
      const words = document.createRange();
      words.selectNodeContents(el);
      return words.getClientRects().length;
    }),
  ).toBe(1);
  // The rest of the card is as it was: the words, the three page rows and the Filed stamp.
  await expect(card.getByText("Plant tulips in October", { exact: true })).toBeVisible();
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByRole("img", { name: `Filed, ${stampDay()}`, exact: true })).toBeVisible();
  // A filing that only noted its capture says it too, in the head and over the footer's sentence, which stays.
  await call(app, "setCapsule", filedCard({ noted: true, pages: [], restored: true }));
  const noted = card.getByText("Claude Code noted it in the log.", { exact: true });
  await expect(noted).toBeVisible(); // the new card has been drawn: the line below is its own, not the previous card's
  await expect(line).toBeVisible();
  expect((await line.boundingBox())!.y).toBeLessThan((await noted.boundingBox())!.y);
  // And a filing that kept nothing back has none: the head holds its label alone.
  await call(app, "setCapsule", filedCard());
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(label).toBeVisible();
  await expect(line).toHaveCount(0);
  await app.close();
});

// "Show the last receipt" puts the last filing's card up again (`Controller.showLastReceipt`): the same card, as a reprint. Its state has a
// `reprint` with the time the thought was filed, and its stamp prints that day, still, where a filing's own lands and prints today.
test("a reprinted filed card is the same card, its stamp still and dated the day it was filed", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const day = new Date();
  day.setDate(day.getDate() - 3);
  day.setHours(12, 0, 0, 0);
  expect(stampDay(day)).not.toBe(stampDay());
  const card = capsule.getByRole("article");
  const bar = capsule.getByRole("status");
  await call(app, "setCapsule", filedCard({ reprint: { filedAt: day.getTime() }, restored: true }));
  await snap(capsule, "3-filed-card-reprint");
  // The stamp is Filed, with the day the thought was filed and not today's, and it does not land: it is printed, not coming down.
  const stamp = card.getByRole("img", { name: `Filed, ${stampDay(day)}`, exact: true });
  await expect(stamp).toBeVisible();
  await expect(stamp).not.toHaveAttribute("data-animate");
  await expect(card.getByRole("img", { name: `Filed, ${stampDay()}`, exact: true })).toHaveCount(0);
  // The rest is the card a filing puts up: the bar and its three buttons, the three rows, the words and the line that they are kept.
  await expect(bar.getByText("Filed by Claude Code in 23 s", { exact: true })).toBeVisible();
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide", "Undo", "Open"]);
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByText("Plant tulips in October", { exact: true })).toBeVisible();
  await expect(card.locator("header").getByText("Your exact words are kept.", { exact: true })).toBeVisible();
  // A reprint of a filing that only noted its capture is stamped Noted, with its day.
  await call(app, "setCapsule", filedCard({ noted: true, pages: [], reprint: { filedAt: day.getTime() } }));
  await expect(card.getByRole("img", { name: `Noted, ${stampDay(day)}`, exact: true })).toBeVisible();
  await expect(bar.getByText("Nothing new to file", { exact: true })).toBeVisible();
  // The card a filing puts up has no reprint: stamped today, and it lands.
  await call(app, "setCapsule", filedCard());
  await expect(card.getByRole("img", { name: `Filed, ${stampDay()}`, exact: true })).toHaveAttribute("data-animate", "");
  await app.close();
});

test("a filing whose agent rewrote the capture keeps the person's words, and its card says so", async () => {
  const { library, app, capsule } = await launchOn(await makeLibrary(), { FAKE_AGENT_MODE: "tamper" }); // files, then rewrites the capture
  const line = capsule.getByRole("article").locator("header").getByText("Your exact words are kept.", { exact: true });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "filed", restored: true });
  await expect(line).toBeVisible();
  // The engine put the words back: the archived capture holds them, and nothing of what the agent wrote over them.
  const [capture, ...others] = archived(library);
  expect(others).toEqual([]);
  const words = readFileSync(capture!, "utf8");
  expect(words).toContain("Plant tulips in October");
  expect(words).not.toContain("rewritten by a careless agent");
  // The next filing is by an agent that behaves (the mode is read at each run). Its state has no `restored` at all, and its card no line.
  // The first card's state has it, so a filed state without it can only be the next filing's.
  await app.evaluate((_electron, mode) => void (process.env.FAKE_AGENT_MODE = mode), "ok");
  await dictate(app);
  await expect
    .poll(
      async () => {
        const state = (await call(app, "capsuleStateForTests")) as { kind: string; restored?: boolean };
        return state.kind === "filed" && state.restored !== true;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  expect(await call(app, "capsuleStateForTests")).not.toHaveProperty("restored");
  await expect(capsule.getByRole("status").getByText(/^Filed by fake in \d+ s$/)).toBeVisible();
  await expect(line).toHaveCount(0);
  expect(archived(library)).toHaveLength(2);
  await app.close();
});

test("a thought saved for the evening review is stamped Saved, and the card says where it is", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  await call(app, "setCapsule", savedCard());
  await snap(capsule, "7-saved-card");
  await expect(zel(capsule)).toHaveAttribute("data-mood", "filed");
  await expect(bar.getByText("Saved", { exact: true })).toBeVisible();
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide"]);
  await expect(card.getByText("Thought", { exact: true })).toBeVisible();
  await expect(card.getByText("Call the plumber on Monday", { exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: `Saved, ${stampDay()}`, exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: `Saved, ${stampDay()}`, exact: true })).not.toHaveAttribute("data-animate"); // only a filing's stamp lands
  // The note under the words: when the review files it, or only that it is in the inbox while the review is off.
  await expect(card.getByText("Saved to the inbox for the evening review at 21:00.", { exact: true })).toBeVisible();
  await call(app, "setCapsule", savedCard({ note: "Saved to the inbox." }));
  await expect(card.getByText("Saved to the inbox.", { exact: true })).toBeVisible();
  // A line about the recording comes after the note.
  const detail = "Only your words were kept: the recording couldn't be saved.";
  await call(app, "setCapsule", savedCard({ detail }));
  const note = card.getByText("Saved to the inbox for the evening review at 21:00.", { exact: true });
  await expect(card.getByText(detail, { exact: true })).toBeVisible();
  expect((await note.boundingBox())!.y).toBeLessThan((await card.getByText(detail, { exact: true }).boundingBox())!.y);
  await expectInPanel(capsule);
  await app.close();
});

test("a screen comment's saved card is labelled with the app, shows its screenshot, title and address over the note, and says when there is no comment", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const thumbnail = `data:image/png;base64,${readFileSync(screenshotFixture()).toString("base64")}`;
  const context = { app: "Safari", title: "Shure MV7+ Podcast Microphone", url: "https://www.shure.com/mv7" };
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  const detail = "Only your words were kept: raw/audio/2026/10 isn't a plain folder. Remove the link or file on its path to keep recordings.";
  // The worst card: a comment of many words, the screenshot, and a note of two lines.
  const long = "This mic looks right for the podcast, and the price is fair too. ".repeat(8).trim();
  await call(app, "setCapsule", savedCard({ text: long, thumbnail, context, detail }));
  await snap(capsule, "7-saved-comment-card");
  await expect(bar.getByText("Saved", { exact: true })).toBeVisible();
  await expect(card.getByText("Safari", { exact: true })).toBeVisible(); // the card's label
  await expect(card.getByRole("img", { name: `Saved, ${stampDay()}`, exact: true })).toBeVisible();
  const picture = card.getByRole("img", { name: "Screenshot of Safari", exact: true });
  await expect(picture).toBeVisible();
  const title = card.getByText("Shure MV7+ Podcast Microphone", { exact: true });
  const address = card.getByText("www.shure.com/mv7", { exact: true });
  const note = card.getByText("Saved to the inbox for the evening review at 21:00.", { exact: true });
  await expect(title).toBeVisible();
  await expect(address).toBeVisible();
  await expect(note).toBeVisible();
  // The picture is in the footer, on the paper, with the page's title and address at its side, over the note and its line.
  await expect(card.locator("footer").getByRole("img", { name: "Screenshot of Safari", exact: true })).toBeVisible();
  const [pictureBox, titleBox, addressBox, noteBox, detailBox] = await Promise.all(
    [picture, title, address, note, card.getByText(detail, { exact: true })].map(async (locator) => (await locator.boundingBox())!),
  );
  expect(titleBox!.y).toBeLessThan(addressBox!.y);
  expect(pictureBox!.y + pictureBox!.height).toBeLessThanOrEqual(noteBox!.y);
  expect(addressBox!.y + addressBox!.height).toBeLessThanOrEqual(noteBox!.y);
  expect(noteBox!.y).toBeLessThan(detailBox!.y);
  expect(titleBox!.x).toBeGreaterThanOrEqual(pictureBox!.x + pictureBox!.width); // beside the picture, not under it
  const words = await card.getByText(long, { exact: true }).evaluate((el) => ({ shown: el.clientHeight, pitch: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(words.shown).toBe(2 * words.pitch); // the picture and the line about the recording, which takes two, leave the words two lines
  await expectInPanel(capsule);
  // Without that line about the recording the words have a third line: the stamp takes the first line's end, and a third line keeps theirs.
  await call(app, "setCapsule", savedCard({ text: long, thumbnail, context }));
  const roomier = await card.getByText(long, { exact: true }).evaluate((el) => ({ shown: el.clientHeight, pitch: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(roomier.shown).toBe(3 * roomier.pitch);
  await expectInPanel(capsule);
  // A comment with no words says so; with no app to name, the card is a screen's.
  await call(app, "setCapsule", savedCard({ text: "", thumbnail, context: { title: context.title } }));
  await expect(card.getByText("No comment", { exact: true })).toBeVisible();
  await expect(card.getByText("Screen", { exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: "Screenshot", exact: true })).toBeVisible();
  await expectInPanel(capsule);
  await app.close();
});

test("a filing that was undone says so: the card has the words, unstamped, and the note is back in the inbox", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  await call(app, "setCapsule", savedCard({ text: "Plant tulips in October", note: "Your words are back in the inbox for the evening review at 21:00.", undone: true }));
  await expect(zel(capsule)).toHaveAttribute("data-mood", "filed");
  await expect(bar.getByText("Undone", { exact: true })).toBeVisible();
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide"]);
  await expect(card.getByText("Plant tulips in October", { exact: true })).toBeVisible();
  await expect(card.getByText("Your words are back in the inbox for the evening review at 21:00.", { exact: true })).toBeVisible();
  await expect(card).not.toHaveAttribute("data-stamped"); // the filing it would stamp is gone
  await expectInPanel(capsule);
  await app.close();
});

test("a Stopped filing says what is safe, and when the evening review files the note, only while a review will", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const untouched = "Your words are back in the inbox, untouched, and nothing else changed.";
  const partial = "Your words are back in the inbox, untouched. Claude Code's partial edits are kept as their own commit in the library's history.";
  const leftovers = "Your words are back in the inbox. Claude Code's partial edits stay as they are, because nothing recorded them.";
  await call(app, "setCapsule", cancelledCard());
  await snap(capsule, "6-stopped-card");
  await expectStoppedFiling(capsule, "Plant tulips in October", `${untouched} The evening review files your words at 21:00.`);
  // The run's edits that stayed: as a commit of their own, or as they are because nothing recorded them.
  await call(app, "setCapsule", cancelledCard({ partial: true }));
  await expectStoppedFiling(capsule, "Plant tulips in October", `${partial} The evening review files your words at 21:00.`);
  await call(app, "setCapsule", cancelledCard({ leftovers: 2 }));
  await expectStoppedFiling(capsule, "Plant tulips in October", `${leftovers} The evening review files your words at 21:00.`);
  // The review is the library's own: a weekly one is not tonight's, and one whose schedule can't be read names no time.
  await call(app, "setCapsule", cancelledCard({ review: "on Sundays at 18:00" }));
  await expectStoppedFiling(capsule, "Plant tulips in October", `${untouched} The evening review files your words on Sundays at 18:00.`);
  await call(app, "setCapsule", cancelledCard({ review: "" }));
  await expectStoppedFiling(capsule, "Plant tulips in October", `${untouched} The evening review files your words.`);
  // While the review is off nothing files the note, so the card promises no review.
  await call(app, "setCapsule", cancelledCard({ review: null }));
  await expectStoppedFiling(capsule, "Plant tulips in October", untouched);
  await expect(capsule.getByText(/evening review/)).toHaveCount(0);
  // Long words keep the footer in view: four lines of them, then all of what is safe.
  const long = "I want to launch my podcast about indie game development before the end of the year, and ask Mark to co-host. ".repeat(12).trim();
  await call(app, "setCapsule", cancelledCard({ text: long, partial: true }));
  await expectStoppedFiling(capsule, long, `${partial} The evening review files your words at 21:00.`);
  await app.close();
});

test("a Stopped transcription says the recording is in the inbox, and when the evening review turns it into words, only while a review will", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await call(app, "setCapsule", recordedCard());
  await snap(capsule, "2-stopped-recording-card");
  await expectStoppedRecording(capsule, "It's in the inbox. The evening review turns it into words and files it at 21:00.");
  await call(app, "setCapsule", recordedCard({ review: "on Sundays at 18:00" }));
  await expectStoppedRecording(capsule, "It's in the inbox. The evening review turns it into words and files it on Sundays at 18:00.");
  await call(app, "setCapsule", recordedCard({ review: "" }));
  await expectStoppedRecording(capsule, "It's in the inbox. The evening review turns it into words and files it.");
  await call(app, "setCapsule", recordedCard({ review: null }));
  await expectStoppedRecording(capsule, "It's in the inbox.");
  await expect(capsule.getByText(/evening review/)).toHaveCount(0);
  await app.close();
});

test("Hide puts away every result card", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const undone = savedCard({ note: "Your words are back in the inbox for the evening review at 21:00.", undone: true });
  for (const state of [filedCard(), filedCard({ noted: true, pages: [] }), savedCard(), undone, cancelledCard(), recordedCard()]) {
    await call(app, "setCapsule", state);
    await capsule.getByRole("status").getByRole("button", { name: "Hide", exact: true }).click();
    await expect.poll(() => capsuleKind(app)).toBe("hidden");
  }
  await app.close();
});

/**
 * A title on the filed card, pressed through `page`'s bridge with `path` as given: what the card sends when a title is pressed. A page's
 * messages reach main in the order they were sent, so the answer to the round trip after the press comes once main has heard it.
 */
const pressTitle = (page: Page, path: unknown) =>
  page.evaluate(async (which) => {
    window.avanzel.capsule.openPage(which as string);
    await window.avanzel.settings.get();
  }, path);

/**
 * A stand-in Claude Code that files as the real one does, into four pages: two new (one of them in a folder of the library's own,
 * off the six shelves) and two it changes, which the library has: goals/run.md and people/ana.md.
 */
function pagesFiler(): string {
  const filer = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-filer-")), "filer.mjs");
  writeFileSync(
    filer,
    String.raw`import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
const prompt = process.argv[2] ?? "";
const id = /capture id: ([^)]+)\)/.exec(prompt)[1];
const stamp = /- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) \| file \|/.exec(prompt)[1];
mkdirSync("projects", { recursive: true });
writeFileSync("ideas/tulips.md", "# Tulips for October\n");
writeFileSync("projects/garden.md", "# Garden plan\n");
appendFileSync("goals/run.md", "\n- Ran again today.\n");
appendFileSync("people/ana.md", "\n- Ana likes tulips.\n");
appendFileSync("log.md", "- " + stamp + " | file | [[" + id + "]] → [[tulips]], [[garden]], [[run]], [[ana]]\n");
console.log("Filed into four pages.");
`,
  );
  return filer;
}

test("a filing's card lists the pages it wrote, new or updated, and a title opens its page while Open opens the first", async () => {
  const bin = agentStubs();
  answerAs(bin, "claude", `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else exec '${process.execPath}' '${pagesFiler()}' "$2"; fi`);
  const { library, app, capsule } = await claudeLibrary(bin);
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n\nStatus: active.\n");
  writeFileSync(path.join(library, "people", "ana.md"), "# Ana\n");
  await stubOpening(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const card = capsule.getByRole("article");
  const bar = capsule.getByRole("status");
  await expect(bar.getByText(/^Filed by Claude Code in \d+ s$/)).toBeVisible();
  // Four pages: the two new ones come first (the folder that is no shelf has its name, and no chip), then the first of the updated
  // ones; the fourth is counted.
  const rows = card.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator("[data-shelf]")).toHaveText("Ideas");
  await expect(rows.nth(0).getByRole("button", { name: "Tulips for October", exact: true })).toBeVisible();
  await expect(rows.nth(0).getByText("new", { exact: true })).toBeVisible();
  await expect(rows.nth(1).locator("[data-shelf]")).toHaveCount(0);
  await expect(rows.nth(1).getByText("projects", { exact: true })).toBeVisible();
  await expect(rows.nth(1).getByRole("button", { name: "Garden plan", exact: true })).toBeVisible();
  await expect(rows.nth(1).getByText("new", { exact: true })).toBeVisible();
  await expect(rows.nth(2).locator("[data-shelf]")).toHaveText("Goals");
  await expect(rows.nth(2).getByRole("button", { name: "Run a marathon", exact: true })).toBeVisible();
  await expect(rows.nth(2).getByText("updated", { exact: true })).toBeVisible();
  await expect(card.getByText("and 1 more", { exact: true })).toBeVisible();
  // A title opens its page, and leaves the card where it is.
  await card.getByRole("button", { name: "Garden plan", exact: true }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "projects", "garden.md")));
  expect(await capsuleKind(app)).toBe("filed");
  await card.getByRole("button", { name: "Run a marathon", exact: true }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(2);
  expect(realpathSync((await openedWith(app))[1] ?? "")).toBe(realpathSync(path.join(library, "goals", "run.md")));
  expect(await capsuleKind(app)).toBe("filed");
  // Open opens the first page, and puts the card away.
  await bar.getByRole("button", { name: "Open", exact: true }).click();
  await expect.poll(() => openedWith(app)).toHaveLength(3);
  expect(realpathSync((await openedWith(app))[2] ?? "")).toBe(realpathSync(path.join(library, "ideas", "tulips.md")));
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("the capsule's page opens only the pages its filing wrote, and no other window's page opens them through it", async () => {
  const bin = agentStubs();
  answerAs(bin, "claude", `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else exec '${process.execPath}' '${pagesFiler()}' "$2"; fi`);
  const { library, app, capsule } = await claudeLibrary(bin);
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n\nStatus: active.\n");
  writeFileSync(path.join(library, "goals", "other.md"), "# Another goal\n"); // a page of the library that the filing did not write
  writeFileSync(path.join(library, "people", "ana.md"), "# Ana\n");
  await stubOpening(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  await pressTitle(capsule, "goals/other.md"); // a page of the library, but not of this filing
  await pressTitle(capsule, "../outside.md");
  await pressTitle(capsule, "/etc/hosts");
  await pressTitle(capsule, "index.md");
  await pressTitle(capsule, 42);
  await pressTitle(capsule, null);
  await pressTitle(settings, "ideas/tulips.md"); // this filing's page, but from another window's page
  expect(await openedWith(app)).toEqual([]);
  // The same press from the capsule's own page, for a page this filing wrote, opens it: so the silence above is the channel's.
  await pressTitle(capsule, "people/ana.md"); // the fourth page, which the card only counts
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "people", "ana.md")));
  await app.close();
});

test("a page the agent made a link to another file opens nothing, by its title or by Open, and a notification says why", async () => {
  // An agent with a shell could file a page that is a link to a file of its own, a .command say: a link opens as what it points at,
  // so one click would run it. A page is opened, and read for its title, only as a plain file in the library, through no link.
  const outside = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-outside-")), "run-me.command");
  writeFileSync(outside, "# Run me\n");
  const library = await makeLibrary();
  const { app, capsule } = await launchOn(library, { FAKE_AGENT_MODE: "link-page", FAKE_AGENT_OUTSIDE: outside });
  await stubOpening(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const [page] = filesUnder(library, "ideas");
  const rel = `ideas/${page}`;
  expect(lstatSync(path.join(library, rel)).isSymbolicLink()).toBe(true);
  const said = { title: "Avanzel didn't open that page.", body: `${rel} goes through a link, which could lead anywhere, so nothing was opened.` };
  /** How many presses have been answered: by opening something, or by the notification. */
  const answered = async () => (await openedWith(app)).length + (await notified(app, said.title)).length;
  // Its title opens nothing, and the card stays ...
  await capsule.getByRole("article").getByRole("listitem").first().getByRole("button").click();
  await expect.poll(answered).toBe(1);
  expect(await openedWith(app)).toEqual([]);
  expect(await capsuleKind(app)).toBe("filed");
  // ... and Open opens nothing either, and puts the card away, as it always does. Each press is told once.
  await capsule.getByRole("status").getByRole("button", { name: "Open", exact: true }).click();
  await expect.poll(answered).toBe(2);
  expect(await openedWith(app)).toEqual([]);
  expect(await notified(app, said.title)).toEqual([said, said]);
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  // Nor was the page read through its link for the card: it is titled by its file name, not by the file the link points at.
  expect(await call(app, "pageTitleForTests", rel)).toBe(path.basename(rel, ".md"));
  await app.close();
});

/** A stand-in Claude Code that files a second thought as the real one does: one new page, and goals/run.md, which the first filing changed too. */
function secondFiler(): string {
  const filer = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-filer-")), "filer.mjs");
  writeFileSync(
    filer,
    String.raw`import { appendFileSync, writeFileSync } from "node:fs";
const prompt = process.argv[2] ?? "";
const id = /capture id: ([^)]+)\)/.exec(prompt)[1];
const stamp = /- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) \| file \|/.exec(prompt)[1];
writeFileSync("ideas/second.md", "# A second idea\n");
appendFileSync("goals/run.md", "\n- Ran a second time.\n");
appendFileSync("log.md", "- " + stamp + " | file | [[" + id + "]] → [[second]], [[run]]\n");
console.log("Filed into two pages.");
`,
  );
  return filer;
}

test("a card whose filing was replaced by a newer one opens only what the newer one wrote", async () => {
  const bin = agentStubs();
  answerAs(bin, "claude", `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else exec '${process.execPath}' '${pagesFiler()}' "$2"; fi`);
  const { library, app, capsule } = await claudeLibrary(bin);
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n\nStatus: active.\n");
  writeFileSync(path.join(library, "people", "ana.md"), "# Ana\n");
  await stubOpening(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  // A second thought is filed by a filer that wrote an idea of its own, and goals/run.md again. The page's old card may still be
  // there to press: the controller can't tell which card a title was on, so what opens is what the filing it shows wrote.
  answerAs(bin, "claude", `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; else exec '${process.execPath}' '${secondFiler()}' "$2"; fi`);
  await dictate(app);
  const pagesShown = async () => (((await call(app, "capsuleStateForTests")) as { pages?: { path: string }[] }).pages ?? []).map((page) => page.path);
  await expect.poll(pagesShown, { timeout: 60_000 }).toContain("ideas/second.md");
  expect(await pagesShown()).toEqual(["ideas/second.md", "goals/run.md"]);
  // Pages only the first filing wrote are refused now, though its card listed them.
  for (const page of ["ideas/tulips.md", "projects/garden.md", "people/ana.md"]) await pressTitle(capsule, page);
  expect(await openedWith(app)).toEqual([]);
  // A page the newer filing wrote too opens, and so does one only it wrote.
  await pressTitle(capsule, "goals/run.md");
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "goals", "run.md")));
  await pressTitle(capsule, "ideas/second.md");
  await expect.poll(() => openedWith(app)).toHaveLength(2);
  expect(realpathSync((await openedWith(app))[1] ?? "")).toBe(realpathSync(path.join(library, "ideas", "second.md")));
  await app.close();
});

test("a page's title shows the whole of its focus ring: nothing above it clips it, and the row is no bigger for it", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  await call(app, "setCapsule", filedCard());
  const link = capsule.getByRole("listitem").first().getByRole("button");
  await link.focus();
  await expect(link).toBeFocused();
  // The ring is the design system's, 2 px wide and 2 px off the button, so 4 px beyond it. The title's column clips what overflows it
  // sideways, which is how a title too long for it is cut: the ring must lie inside every clip it has above it, on the axes it clips.
  const ring = await link.evaluate((el) => {
    const style = getComputedStyle(el);
    const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    const box = el.getBoundingClientRect();
    const around = { left: box.left - reach, right: box.right + reach, top: box.top - reach, bottom: box.bottom + reach };
    const cut: string[] = [];
    for (let up = el.parentElement; up; up = up.parentElement) {
      const clip = getComputedStyle(up);
      const room = up.getBoundingClientRect();
      const name = up.className || up.tagName;
      if (clip.overflowX !== "visible" && (around.left < room.left - 0.01 || around.right > room.right + 0.01)) cut.push(`${name}, across`);
      if (clip.overflowY !== "visible" && (around.top < room.top - 0.01 || around.bottom > room.bottom + 0.01)) cut.push(`${name}, up or down`);
    }
    return { ringShows: el.matches(":focus-visible"), reach, cut };
  });
  expect(ring.ringShows).toBe(true);
  expect(ring.reach).toBe(4);
  expect(ring.cut).toEqual([]);
  // The room is borrowed from the gaps: the rows are as tall as they were, and a row is six pixels from the next.
  const rows = capsule.getByRole("article").getByRole("listitem");
  const height = (await rows.first().boundingBox())!.height;
  expect(height).toBeLessThan(30);
  expect((await rows.nth(1).boundingBox())!.y - (await rows.first().boundingBox())!.y).toBeCloseTo(height + 6, 0);
  await app.close();
});

test("a second Undo while the first runs does nothing, and the card says Undone, not that it can't be undone", async () => {
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await launchOn(library);
  await watchUndos(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  // Two presses one straight after the other, as a double click or a stray message sends them (a page's messages reach main in the order
  // they were sent).
  await capsule.evaluate(() => {
    window.avanzel.capsule.undo();
    window.avanzel.capsule.undo();
  });
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  await call(app, "idleForTests");
  // The filing was taken back once, and cleanly: a second take-back would find its commit undone already, and git would refuse it,
  // which would turn the Undone card into the refusal.
  expect(await undoCalls(app)).toBe(1);
  expect(undone(library)).toHaveLength(1);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "saved",
    undone: true,
    text: "Plant tulips in October",
    note: "Your words are back in the inbox for the evening review at 21:00.",
  });
  await expect(capsule.getByRole("status").getByText("Undone", { exact: true })).toBeVisible();
  await expect(capsule.getByRole("alert")).toHaveCount(0);
  expect(inbox(library)).toHaveLength(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  await app.close();
});

test("Undo on the filed card is busy once pressed, and another press does nothing until the take-back is done", async () => {
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await launchOn(library);
  await watchUndos(app, { hold: true });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const undoButton = capsule.getByRole("status").getByRole("button", { name: "Undo", exact: true });
  await expect(undoButton).not.toHaveAttribute("aria-busy", "true");
  await undoButton.click();
  // It is busy at once, and keeps its name, while the take-back waits at the library's door.
  await expect(undoButton).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => reachedUndo(app), { timeout: 10_000 }).toBe(true);
  // A press on a busy button does nothing: one take-back is asked for, and none waits behind it.
  await undoButton.click();
  expect(await undoCalls(app)).toBe(1);
  expect(await capsuleKind(app)).toBe("filed");
  await app.evaluate(() => (globalThis as Left).letUndoIn?.());
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  await call(app, "idleForTests");
  expect(await undoCalls(app)).toBe(1);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", undone: true });
  expect(undone(library)).toHaveLength(1);
  await app.close();
});

test("an Undo whose take-back throws says it can't be undone, and the card doesn't wait on its Undo for ever", async () => {
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await launchOn(library);
  await watchUndos(app, { fail: true });
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await capsule.getByRole("status").getByRole("button", { name: "Undo", exact: true }).click();
  // A revert that throws is a refusal to the card, as git's own refusal is: the card says so, with nothing to fix.
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  expect(await call(app, "capsuleStateForTests")).toEqual({
    kind: "error",
    message: "This one can't be undone automatically.",
    detail: "Usually a later change touched the same lines. The library's history keeps both versions.",
  });
  await expect(capsule.getByRole("alert")).toContainText("This one can't be undone automatically.");
  expect(await undoCalls(app)).toBe(1);
  // The filing stands: its page is where the agent wrote it, and the note is archived, not back in the inbox.
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(archived(library)).toHaveLength(1);
  expect(inbox(library)).toEqual([]);
  await app.close();
});

// The take-back waits its turn in the queue, and a newer card may be up by the time it lands: a recording's, which goes on recording
// (its recorder is the page's, not the card's), or a newer filing's editor. Its word then comes as a notification, and the card stays. The
// Undone one is silent: the recording is on, and macOS's sound would be heard in the words.
for (const { refused, said } of [
  { refused: false, said: { title: "Undone", body: "Your words are back in the inbox for the evening review at 21:00.", silent: true } },
  {
    refused: true,
    said: { title: "This one can't be undone automatically.", body: "Usually a later change touched the same lines. The library's history keeps both versions." },
  },
]) {
  test(`an Undo ${refused ? "refused" : "done"} while a new recording listens leaves the listening card up, and says so in one notification`, async () => {
    const library = await makeLibrary({ git: true });
    const { app, capsule } = await launchOn(library);
    await watchUndos(app, { hold: true, fail: refused });
    await dictate(app);
    await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
    await capsule.getByRole("status").getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => reachedUndo(app), { timeout: 10_000 }).toBe(true);
    await call(app, "toggleDictate"); // a new thought, begun while the take-back waits at the library's door
    await expect.poll(() => capsuleKind(app), { timeout: 10_000 }).toBe("listening");
    await app.evaluate(() => (globalThis as Left).letUndoIn?.());
    // The take-back lands: as a notification, or as a card over the listening one.
    await expect
      .poll(async () => (await capsuleKind(app)) !== "listening" || (await notified(app, said.title)).length > 0, { timeout: 30_000 })
      .toBe(true);
    await call(app, "idleForTests");
    expect(await capsuleKind(app)).toBe("listening");
    expect(await call(app, "notificationsForTests")).toEqual([said]);
    expect(undone(library)).toHaveLength(refused ? 0 : 1);
    await call(app, "cancelRecording");
    await app.close();
  });
}

test("Undo takes nothing back unless the filed card is up: a press once the card is hidden does nothing", async () => {
  const library = await makeLibrary({ git: true });
  const { app, capsule } = await launchOn(library);
  await watchUndos(app);
  await dictate(app);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await call(app, "dismiss");
  expect(await capsuleKind(app)).toBe("hidden");
  // A stray message from the capsule's page: no card offers Undo now.
  await capsule.evaluate(async () => {
    window.avanzel.capsule.undo();
    await window.avanzel.settings.get(); // the press has been heard by now
  });
  await call(app, "idleForTests");
  expect(await undoCalls(app)).toBe(0);
  expect(undone(library)).toEqual([]);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(inbox(library)).toEqual([]);
  await app.close();
});
