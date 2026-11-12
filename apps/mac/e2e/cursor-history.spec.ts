// Settings → Dictation: the history of what was dictated into other apps, newest first, with Copy and Delete on each, and the menu bar
// menu's "Forget the last dictation". The history is the app's own file (<userData>/dictations.jsonl), so most tests write it before
// Avanzel opens; one makes real dictations with the fake cursor helper (AVANZEL_FAKE_CURSOR), whose pastes go to a file.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DictationEntry } from "../src/main/dictation-history.ts";
import type { Target } from "../src/main/cursor-helper.ts";
import { notified } from "./capsule-helpers.ts";
import { call, firstRun, launch, makeLibrary, openSettings, snap, speechWav, windowFor, paneOf, paneShown } from "./helpers.ts";

const WORDS = "hello Kowalczyk";

const entry = (id: string, over: Partial<DictationEntry> = {}): DictationEntry => ({
  id,
  at: new Date().toISOString(),
  text: `words of ${id}`,
  app: "Notes",
  bundleId: "com.apple.Notes",
  title: null,
  site: null,
  seconds: 3,
  inserted: true,
  ...over,
});

const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

/** A user-data folder whose history holds `entries`, oldest first as the file keeps them; the file is absent for none. */
function userDataWith(entries: DictationEntry[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  if (entries.length) writeFileSync(path.join(dir, "dictations.jsonl"), entries.map((each) => `${JSON.stringify(each)}\n`).join(""));
  return dir;
}

const historyIds = (userData: string): string[] => {
  const file = path.join(userData, "dictations.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => (JSON.parse(line) as DictationEntry).id) : [];
};

async function launchOn(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  return launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_USER_DATA: userData, ...env });
}

const cards = (settings: Page) => settings.getByRole("article");
const clipboardText = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());
/** Whether the panel offers Forget the last dictation, on Capture, in what main would give it now. */
const forgetOffered = async (app: ElectronApplication) => ((await call(app, "panelSnapshot")) as { forgettableDictation: boolean }).forgettableDictation;

// Copy uses the Mac's real clipboard: its text is put back when the tests are done.
let ownersClipboard = "";
test.beforeAll(() => {
  ownersClipboard = execFileSync("pbpaste", { encoding: "utf8" });
});
test.afterAll(() => {
  execFileSync("pbcopy", { input: ownersClipboard });
});

test("the pane lists the dictations newest first, each with its time, app, window and words", async () => {
  const userData = userDataWith([
    entry("old", { at: ago(30), text: "an older dictation", app: "Safari", bundleId: "com.apple.Safari", site: "example.com" }),
    entry("new", { at: ago(0.01), text: "the newest dictation", app: "Slack", bundleId: "com.tinyspeck.slackmacgap", title: "#general" }),
    entry("mid", { at: ago(0.5), text: "words that did not go in", app: "Notes", inserted: false }),
  ]);
  const app = await launchOn(userData);
  const settings = await openSettings(app, "Dictation");
  await expect(cards(settings)).toHaveCount(3);
  await expect(cards(settings).nth(0)).toContainText("the newest dictation");
  await expect(cards(settings).nth(1)).toContainText("words that did not go in");
  await expect(cards(settings).nth(2)).toContainText("an older dictation");
  await expect(cards(settings).nth(0)).toContainText("Slack");
  await expect(cards(settings).nth(0)).toContainText("#general");
  await expect(cards(settings).nth(2)).toContainText("Safari");
  await expect(cards(settings).nth(2)).toContainText("example.com");
  // Today's dictations show the time alone; an older one says which day.
  await expect(cards(settings).nth(0)).toContainText(/\d\d:\d\d/);
  await expect(cards(settings).nth(0)).not.toContainText("Yesterday");
  await expect(cards(settings).nth(2)).toContainText(/Yesterday|\d{1,2} [A-Z][a-z]{2}/);
  // Only the words that didn't go in say so.
  await expect(settings.getByText("These words didn't go in. Copy them to paste yourself.", { exact: true })).toHaveCount(1);
  await expect(cards(settings).nth(1)).toContainText("These words didn't go in.");
  for (let i = 0; i < 3; i++) {
    await expect(cards(settings).nth(i).getByRole("button", { name: "Copy", exact: true })).toBeVisible();
    await expect(cards(settings).nth(i).getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  }
  await snap(settings, "settings-dictations-list");
  await app.close();
});

test("a long dictation shows its first 400 characters, and Copy puts all of it on the clipboard", async () => {
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
  expect(long.length).toBeGreaterThan(600);
  const app = await launchOn(userDataWith([entry("long", { text: long }), entry("short", { text: "a short one", at: ago(1) })]));
  await app.evaluate(({ clipboard }) => clipboard.writeText("what was there before"));
  const settings = await openSettings(app, "Dictation");
  const card = cards(settings).first();
  const shown = (await card.innerText()).replace(/\s+/g, " ");
  expect(shown).toContain("word0 word1 word2");
  expect(shown).toContain("…");
  expect(shown).not.toContain("word119");
  const copy = card.getByRole("button", { name: "Copy", exact: true });
  await copy.click();
  await expect.poll(() => clipboardText(app)).toBe(long);
  await expect(card.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  // Copying another one copies that one.
  await cards(settings).nth(1).getByRole("button", { name: "Copy", exact: true }).click();
  await expect.poll(() => clipboardText(app)).toBe("a short one");
  await app.close();
});

test("a long history lists the newest hundred, says how many older ones are kept, and Show 100 more lists them", async () => {
  const start = Date.now() - 3 * 3_600_000;
  // Written straight into the file, oldest first: entry-104 is the newest.
  const entries = Array.from({ length: 105 }, (_, i) => entry(`entry-${i}`, { at: new Date(start + i * 1000).toISOString() }));
  const userData = userDataWith(entries);
  const app = await launchOn(userData);
  const settings = await openSettings(app, "Dictation");
  await expect(cards(settings)).toHaveCount(100);
  await expect(cards(settings).first()).toContainText("words of entry-104");
  await expect(cards(settings).last()).toContainText("words of entry-5");
  await expect(settings.getByText("words of entry-4", { exact: true })).toHaveCount(0);
  await expect(settings.getByText("5 older dictations are kept on this Mac.", { exact: true })).toBeVisible();
  const more = settings.getByRole("button", { name: "Show 100 more", exact: true });
  await expect(more).toBeVisible();
  // A delete keeps the longer list a person asked for, and the count follows.
  await cards(settings).first().getByRole("button", { name: "Delete", exact: true }).click();
  await expect(settings.getByText("4 older dictations are kept on this Mac.", { exact: true })).toBeVisible();
  await expect(cards(settings)).toHaveCount(100);
  await expect(cards(settings).last()).toContainText("words of entry-4");
  await settings.getByRole("button", { name: "Show 100 more", exact: true }).click();
  await expect(cards(settings)).toHaveCount(104);
  await expect(cards(settings).last()).toContainText("words of entry-0");
  await expect(settings.getByText(/older dictations? (is|are) kept/)).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Show 100 more", exact: true })).toHaveCount(0);
  // The longer list stays as it is when the history changes again.
  await cards(settings).first().getByRole("button", { name: "Delete", exact: true }).click();
  await expect(cards(settings)).toHaveCount(103);
  await app.close();
});

test("a history of exactly one page has no older line and no button", async () => {
  const start = Date.now() - 3 * 3_600_000;
  const app = await launchOn(userDataWith(Array.from({ length: 100 }, (_, i) => entry(`entry-${i}`, { at: new Date(start + i * 1000).toISOString() }))));
  const settings = await openSettings(app, "Dictation");
  await expect(cards(settings)).toHaveCount(100);
  await expect(settings.getByText(/kept on this Mac/)).toHaveCount(0);
  await expect(settings.getByRole("button", { name: /Show \d+ more/ })).toHaveCount(0);
  await app.close();
});

test("Delete removes the dictation from the pane and from the file, and a new launch still lists the other", async () => {
  const userData = userDataWith([entry("one", { text: "first words", at: ago(2) }), entry("two", { text: "second words", at: ago(1) })]);
  const app = await launchOn(userData);
  const settings = await openSettings(app, "Dictation");
  await expect(cards(settings)).toHaveCount(2);
  await cards(settings).filter({ hasText: "second words" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(cards(settings)).toHaveCount(1);
  await expect(cards(settings).first()).toContainText("first words");
  expect(historyIds(userData)).toEqual(["one"]);
  await app.close();

  const again = await launchOn(userData);
  const settingsAgain = await openSettings(again, "Dictation");
  await expect(cards(settingsAgain)).toHaveCount(1);
  await expect(cards(settingsAgain).first()).toContainText("first words");
  // The last one goes, and the pane says there is nothing, and how to start.
  await cards(settingsAgain).first().getByRole("button", { name: "Delete", exact: true }).click();
  await expect(settingsAgain.getByText("Nothing dictated yet.", { exact: true })).toBeVisible();
  await expect(cards(settingsAgain)).toHaveCount(0);
  await again.close();
});

test("a Delete the history can't write is told in a Notice, the dictation stays, and the next try works", async () => {
  const userData = userDataWith([entry("stays", { text: "words that stay" })]);
  // The history is rewritten through "dictations.jsonl.tmp": a folder in its place makes the rewrite fail, and nothing else.
  const blocker = path.join(userData, "dictations.jsonl.tmp");
  mkdirSync(blocker);
  const app = await launchOn(userData);
  const settings = await openSettings(app, "Dictation");
  const card = cards(settings).first();
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  const notice = settings.getByRole("alert");
  await expect(notice).toContainText("That dictation couldn't be deleted.");
  await expect(notice).toContainText("It is still in the history. Try deleting it again.");
  await expect(cards(settings)).toHaveCount(1);
  await expect(card).toContainText("words that stay");
  expect(historyIds(userData)).toEqual(["stays"]);
  // Nothing the system said, and none of the words, is in the Notice.
  await expect(notice).not.toContainText(/EISDIR|EACCES|illegal operation|words that stay/);
  // The person fixes the cause (here the test does) and tries again.
  execFileSync("rmdir", [blocker]);
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(cards(settings)).toHaveCount(0);
  await expect(settings.getByRole("alert")).toHaveCount(0);
  expect(historyIds(userData)).toEqual([]);
  await app.close();
});

test("Forget the last dictation is in the panel while the history has one, forgets the newest, and goes with the last", async () => {
  const userData = userDataWith([entry("older", { text: "older words", at: ago(2) }), entry("newer", { text: "newer words", at: ago(1) })]);
  const app = await launchOn(userData);
  const settings = await openSettings(app, "Dictation");
  await expect(cards(settings)).toHaveCount(2);
  expect(await forgetOffered(app)).toBe(true);

  // The panel's Forget takes the newest out of the history, and the open pane follows without being reloaded.
  await call(app, "panelAction", "forget-dictation");
  await expect(cards(settings)).toHaveCount(1);
  await expect(cards(settings).first()).toContainText("older words");
  expect(historyIds(userData)).toEqual(["older"]);
  expect(await forgetOffered(app)).toBe(true);

  await call(app, "panelAction", "forget-dictation");
  await expect(settings.getByText("Nothing dictated yet.", { exact: true })).toBeVisible();
  expect(historyIds(userData)).toEqual([]);
  await expect.poll(() => forgetOffered(app)).toBe(false);
  // With nothing to forget, a press does nothing and fails nowhere.
  await call(app, "panelAction", "forget-dictation");
  await app.close();
});

test("an empty history says so in one line and how to start, offers nothing to copy, and the panel offers no Forget", async () => {
  const app = await launchOn(userDataWith([]));
  const settings = await openSettings(app, "Dictation");
  await expect(settings.getByText("Nothing dictated yet.", { exact: true })).toBeVisible();
  await expect(settings.getByText(/tap the key and speak\. What you say shows here\.$/)).toBeVisible();
  await expect(cards(settings)).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  expect(await forgetOffered(app)).toBe(false);
  await app.close();
});

test("the pane works with no library open", async () => {
  const userData = userDataWith([entry("kept", { text: "words kept without a library" })]);
  const app = await launch({ ...firstRun().env, AVANZEL_USER_DATA: userData });
  const settings = await openSettings(app, "Dictation");
  await expect(cards(settings)).toHaveCount(1);
  await expect(cards(settings).first()).toContainText("words kept without a library");
  await expect(paneOf(settings, "Dictation").getByText("Avanzel has no library open.", { exact: true })).toHaveCount(0);
  await cards(settings).first().getByRole("button", { name: "Delete", exact: true }).click();
  await expect(settings.getByText("Nothing dictated yet.", { exact: true })).toBeVisible();
  expect(historyIds(userData)).toEqual([]);
  await app.close();
});

test("a dictation made while the pane is open appears at the top without a reload, and nothing is written to the console", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "avz-e2e-cursor-"));
  const script = path.join(dir, "cursor.json");
  const slack: Target = {
    app: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap", pid: 501 },
    window: { title: "#general" },
    element: { role: "AXTextArea", secure: false, takesText: "yes" },
  };
  writeFileSync(script, JSON.stringify({ targets: [slack], taps: [], pasteOut: path.join(dir, "pasted.txt") }));
  const userData = userDataWith([entry("old", { text: "an older dictation", at: ago(30) })]);
  const app = await launchOn(userData, { AVANZEL_FAKE_CURSOR: script, AVANZEL_FAKE_AUDIO: speechWav(WORDS), AVANZEL_FAKE_TRANSCRIPT: WORDS });
  await windowFor(app, "capsule");
  const settings = await openSettings(app, "Dictation");
  const logged: string[] = [];
  settings.on("console", (message) => logged.push(message.text()));
  await expect(cards(settings)).toHaveCount(1);
  // Two presses of the key, as the helper would send them.
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => call(app, "capsuleStateForTests").then((state) => (state as { kind: string }).kind)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect(cards(settings)).toHaveCount(2, { timeout: 60_000 });
  await expect(cards(settings).first()).toContainText(WORDS);
  await expect(cards(settings).first()).toContainText("Slack");
  await expect(cards(settings).first()).toContainText("#general");
  await expect(cards(settings).nth(1)).toContainText("an older dictation");
  expect(logged.filter((line) => line.includes(WORDS))).toEqual([]);
  await app.close();
});
