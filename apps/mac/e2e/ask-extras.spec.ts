// What the Ask window adds before the first question: up to three questions about the pages filed last, each in words beside
// Ask this, which asks it. The fake agent answers an ask with "Q: " and the question, as app.spec.ts's Ask tests read it.
import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Vault } from "../../../packages/engine/src/index.ts";
import { filedFromTheCapsule, filedInto, launchOn, onDay } from "./capsule-helpers.ts";
import { call, launch, makeLibrary, recentlyFiled, snap, windowFor } from "./helpers.ts";

/** The line under the field before the first question, and the one a library with no pages gets instead. */
const USUAL = "Answers come from your library only, with links to the pages they use.";
const EMPTY = "Your shelves are empty. Say something first, then ask about it.";

/** The names of the groups `ask` shows, in order: each group is named by the words its aria-labelledby points at. */
const groupNames = (ask: Page) =>
  ask.getByRole("group").evaluateAll((groups) => groups.map((group) => document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""));

test("Ask suggests a question about each page filed last, newest first, and Ask this asks it", async () => {
  const library = await makeLibrary();
  // Three filings a day apart, in this order. An answer saved as a page has an Ask line in the log, which is no filing:
  // it comes last in the log and is never suggested.
  filedInto(library, "goals", "run-a-marathon", "Run a marathon", onDay(-2));
  filedInto(library, "people", "maya", "Maya", onDay(-1));
  filedInto(library, "ideas", "tulips", "Plant tulips in October", onDay(0));
  writeFileSync(path.join(library, "topics", "answer.md"), "# Answer\n");
  new Vault(library).appendLog("ask", "Summarize my ideas → [[answer]]");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  // The usual line shows, and over three groups, one about each page, the newest first: a person's page asks what they are doing with them.
  const usual = ask.getByText(USUAL, { exact: true });
  const groups = ask.getByRole("group");
  await expect(groups).toHaveCount(3);
  await expect(usual).toBeVisible();
  const [lineBox, firstBox] = [await usual.boundingBox(), await groups.first().boundingBox()];
  expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(firstBox!.y);
  expect(await groupNames(ask)).toEqual([
    "What did I say about “Plant tulips in October”?",
    "What am I doing with Maya?",
    "What did I say about “Run a marathon”?",
  ]);
  // Each group has the one button that asks its question: Ask this, secondary and small.
  for (const group of await groups.all()) {
    const buttons = group.getByRole("button");
    await expect(buttons).toHaveCount(1);
    await expect(buttons).toHaveText("Ask this");
    await expect(buttons).toHaveAttribute("data-variant", "secondary");
    await expect(buttons).toHaveAttribute("data-size", "small");
  }
  // Ask this asks its question as a new turn. The suggestions go with the first question, and what is typed stays in the field, which has the focus.
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill("draft");
  await snap(ask, "9-ask-suggested");
  await ask.getByRole("group", { name: "What am I doing with Maya?", exact: true }).getByRole("button", { name: "Ask this", exact: true }).click();
  await expect(ask.getByRole("heading", { name: "What am I doing with Maya?", exact: true })).toBeVisible();
  await expect(ask.getByText("Q: What am I doing with Maya?")).toBeVisible({ timeout: 60_000 });
  await expect(ask.getByRole("group")).toHaveCount(0);
  await expect(field).toHaveValue("draft");
  await expect(field).toBeFocused();
  await app.close();
});

test("with nothing filed, Ask suggests nothing, and its line is as it was", async () => {
  // A page on a shelf and no filing in the log: the usual line, and no question under it.
  const shelved = await makeLibrary();
  writeFileSync(path.join(shelved, "goals", "run.md"), "# Run a marathon\n");
  const first = await launch({ AVANZEL_LIBRARY: shelved });
  expect(await call(first, "askSuggestions")).toEqual([]);
  await call(first, "openAsk");
  const withPage = await windowFor(first, "ask");
  await expect(withPage.getByText(USUAL, { exact: true })).toBeVisible();
  await expect(withPage.getByRole("group")).toHaveCount(0);
  await first.close();
  // No page at all: the line that invites a first thought, which the window draws with the same read that finds no question.
  const bare = await makeLibrary();
  const second = await launch({ AVANZEL_LIBRARY: bare });
  expect(await call(second, "askSuggestions")).toEqual([]);
  await call(second, "openAsk");
  const withNone = await windowFor(second, "ask");
  await expect(withNone.getByText(EMPTY, { exact: true })).toBeVisible();
  await expect(withNone.getByRole("group")).toHaveCount(0);
  await second.close();
});

test("a filing outside the six shelves suggests nothing while they are empty", async () => {
  const library = await makeLibrary();
  filedInto(library, "projects", "launch-plan", "Launch plan", onDay(0));
  const app = await launch({ AVANZEL_LIBRARY: library });
  // The menu lists the page, so the app does hold it as filed last; the six shelves hold no page, so Ask invites a first thought,
  // and a question under that line would contradict it.
  expect(await recentlyFiled(app)).toEqual(["Launch plan"]);
  expect(await call(app, "askSuggestions")).toEqual([]);
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await expect(ask.getByText(EMPTY, { exact: true })).toBeVisible();
  await expect(ask.getByRole("group")).toHaveCount(0);
  await app.close();
});

test("a thought filed while Ask is open is suggested once Ask has the focus again", async () => {
  const { app } = await launchOn(await makeLibrary());
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await expect(ask.getByText(EMPTY, { exact: true })).toBeVisible();
  await expect(ask.getByRole("group")).toHaveCount(0);
  await filedFromTheCapsule(app);
  // The window reads the library again whenever it has the focus (as app.spec.ts's empty-shelves test does).
  await ask.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(ask.getByRole("group", { name: "What did I say about “Plant tulips in October”?", exact: true })).toBeVisible();
  await app.close();
});

test("a long title wraps in the question, never in its button", async () => {
  const library = await makeLibrary();
  // 120 characters: more than a line of the window, so the question wraps, and its button, which never wraps its words, stays whole.
  const title = "A very long title for a page of notes that goes on and on about the garden, the bulbs, the soil, the sun and the frosts.";
  expect(title).toHaveLength(120);
  filedInto(library, "ideas", "long-title", title, onDay(0));
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const group = ask.getByRole("group", { name: `What did I say about “${title}”?`, exact: true });
  const button = group.getByRole("button", { name: "Ask this", exact: true });
  await expect(button).toBeVisible();
  // The button lies inside the window, the turns don't scroll sideways, and the words are taller than the button: they run over lines.
  const inside = await ask.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const buttonBox = (await button.boundingBox())!;
  expect(buttonBox.x).toBeGreaterThanOrEqual(0);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(inside.width);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(inside.height);
  expect(await ask.locator(".ask-turns").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const questionBox = (await group.getByText(`What did I say about “${title}”?`, { exact: true }).boundingBox())!;
  expect(questionBox.height).toBeGreaterThan(buttonBox.height);
  await app.close();
});
