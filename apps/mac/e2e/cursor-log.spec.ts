// The library's log of dictations: with config.toml's [dictation] log on, each dictation into another app is also written to the
// day file raw/dictations/YYYY-MM-DD.md; the skip list keeps an app's dictations out of both stores; and forgetting one (Delete in
// Settings → Dictations, or the menu's "Forget the last dictation") takes it out of the day file too, or says so when it can't.
// Settings → Voice holds the switch and the skip lists. The Mac's side is the fake cursor helper (AVANZEL_FAKE_CURSOR).
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, localDate } from "../../../packages/engine/src/index.ts";
import type { Target } from "../src/main/cursor-helper.ts";
import type { DictationEntry } from "../src/main/dictation-history.ts";
import { expectProblem, holdTheQueue, letTheQueueGo } from "./capsule-helpers.ts";
import { call, capsuleKind, launch, makeLibrary, openSettings, speechWav, windowFor } from "./helpers.ts";

const WORDS = "hello Kowalczyk";

const slack: Target = {
  app: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap", pid: 501 },
  window: { title: "Launch plan" },
  element: { role: "AXTextArea", secure: false, takesText: "yes" },
};

async function launchWith(library: string): Promise<{ app: ElectronApplication; pasteOut: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "avz-e2e-cursor-"));
  const pasteOut = path.join(dir, "pasted.txt");
  const script = path.join(dir, "cursor.json");
  writeFileSync(script, JSON.stringify({ targets: [slack], taps: [], pasteOut }));
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_CURSOR: script, AVANZEL_FAKE_AUDIO: speechWav(WORDS), AVANZEL_FAKE_TRANSCRIPT: WORDS });
  await windowFor(app, "capsule");
  await call(app, "setCursorDictation", { enabled: true });
  return { app, pasteOut };
}

const pasted = (pasteOut: string): string => (existsSync(pasteOut) ? readFileSync(pasteOut, "utf8") : "");
const userDataOf = (app: ElectronApplication) => app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));

/** The app's own history of dictations, oldest first. */
async function history(app: ElectronApplication): Promise<DictationEntry[]> {
  const file = path.join(await userDataOf(app), "dictations.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as DictationEntry) : [];
}

const dictations = (library: string) => path.join(library, "raw", "dictations");
const dayFile = (library: string) => path.join(dictations(library), `${localDate(new Date())}.md`);
const dayText = (library: string): string => (existsSync(dayFile(library)) ? readFileSync(dayFile(library), "utf8") : "");

/**
 * The `times`th dictation, as two taps of the key would make it; resolves once the words are pasted and the history holds `kept`
 * entries. The session takes no new tap until it has kept the words, which comes after the paste.
 */
async function dictate(app: ElectronApplication, pasteOut: string, times: number, kept = times): Promise<void> {
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 60_000 }).toBe(WORDS.repeat(times));
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await expect.poll(async () => (await history(app)).length).toBe(kept);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The fake helper's paste reads the Mac's real clipboard: its text is put back when the tests are done.
let ownersClipboard = "";
test.beforeAll(() => {
  ownersClipboard = execFileSync("pbpaste", { encoding: "utf8" });
});
test.afterAll(() => {
  execFileSync("pbcopy", { input: ownersClipboard });
});

test("with the log off, as a library starts, a dictation is kept in the app's history only", async () => {
  const library = await makeLibrary();
  expect(loadSettings(library).dictation.log).toBe(false);
  const { app, pasteOut } = await launchWith(library);
  await dictate(app, pasteOut, 1);
  await expect.poll(() => history(app)).toEqual([expect.objectContaining({ text: WORDS, app: "Slack" })]);
  await wait(500); // a write to the day file would follow the history's at once
  expect(existsSync(dictations(library))).toBe(false);
  await app.close();
});

test("with the log on, the day file holds the dictation under its time, app and window title, marked with the history's id", async () => {
  const library = await makeLibrary();
  const { app, pasteOut } = await launchWith(library);
  await call(app, "setLibrarySettings", { dictationLog: true });
  await dictate(app, pasteOut, 1);
  await expect.poll(async () => (await history(app)).length).toBe(1);
  const [entry] = await history(app);
  expect(entry!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  await expect.poll(() => dayText(library)).toContain(`<!-- dictation ${entry!.id} -->\n${WORDS}\n<!-- /dictation ${entry!.id} -->`);
  expect(dayText(library)).toMatch(/^## \d\d:\d\d · Slack — Launch plan$/m);
  // Private to the person, and not a capture: nothing waits in the inbox.
  expect(readdirSync(path.join(library, "inbox")).filter((name) => !name.startsWith("."))).toEqual([]);
  await app.close();
});

test("a skipped app gets the words pasted, and they are kept in neither the history nor the day file", async () => {
  const library = await makeLibrary();
  const { app, pasteOut } = await launchWith(library);
  await call(app, "setLibrarySettings", { dictationLog: true, dictationSkipApps: ["com.tinyspeck.slackmacgap"] });
  await dictate(app, pasteOut, 1, 0);
  await wait(500);
  expect(await history(app)).toEqual([]);
  expect(existsSync(dictations(library))).toBe(false);
  await app.close();
});

test("Delete in Settings → Dictations takes the dictation out of the day file too, and leaves the others", async () => {
  const library = await makeLibrary();
  const { app, pasteOut } = await launchWith(library);
  await call(app, "setLibrarySettings", { dictationLog: true });
  await dictate(app, pasteOut, 1);
  await dictate(app, pasteOut, 2);
  await expect.poll(async () => (await history(app)).length).toBe(2);
  const [first, second] = await history(app);
  await expect.poll(() => dayText(library)).toContain(`<!-- /dictation ${second!.id} -->`);
  const settings = await openSettings(app, "Dictations");
  const cards = settings.getByRole("article");
  await expect(cards).toHaveCount(2);
  await cards.last().getByRole("button", { name: "Delete", exact: true }).click(); // the older one
  await expect(cards).toHaveCount(1);
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => dayText(library)).not.toContain(first!.id);
  expect(dayText(library)).toContain(`<!-- dictation ${second!.id} -->`);
  expect((await history(app)).map((each) => each.id)).toEqual([second!.id]);
  await app.close();
});

test("the menu's Forget the last dictation takes it out of the day file too", async () => {
  const library = await makeLibrary();
  const { app, pasteOut } = await launchWith(library);
  await call(app, "setLibrarySettings", { dictationLog: true });
  await dictate(app, pasteOut, 1);
  await expect.poll(async () => (await history(app)).length).toBe(1);
  const [entry] = await history(app);
  await expect.poll(() => dayText(library)).toContain(entry!.id);
  await call(app, "menuAction", "forget-dictation");
  await expect.poll(() => dayText(library)).not.toContain(entry!.id);
  expect(dayText(library)).not.toContain(WORDS);
  expect(await history(app)).toEqual([]);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("a day file that can't be rewritten is told, by Delete and by the menu, and the dictation leaves the history all the same", async () => {
  const library = await makeLibrary();
  const { app, pasteOut } = await launchWith(library);
  await call(app, "setLibrarySettings", { dictationLog: true });
  await dictate(app, pasteOut, 1);
  await dictate(app, pasteOut, 2);
  await expect.poll(async () => (await history(app)).length).toBe(2);
  const [first, second] = await history(app);
  await expect.poll(() => dayText(library)).toContain(`<!-- /dictation ${second!.id} -->`);
  // The day file is rewritten through a new file beside it: a folder that can't be written to makes that fail.
  chmodSync(dictations(library), 0o555);
  try {
    const settings = await openSettings(app, "Dictations");
    const cards = settings.getByRole("article");
    await cards.last().getByRole("button", { name: "Delete", exact: true }).click();
    const notice = settings.getByRole("alert");
    await expect(notice).toContainText("That dictation may still be in the library.");
    await expect(notice).toContainText(
      "The words are deleted from the history, but the day file in the library couldn't be updated. They may still be in raw/dictations. Open that day's file in the library and remove them.",
    );
    await expect(notice).not.toContainText(/EACCES|permission denied/);
    await expect(cards).toHaveCount(1);
    expect((await history(app)).map((each) => each.id)).toEqual([second!.id]);
    expect(dayText(library)).toContain(first!.id);

    // The menu's way: the capsule tells it, as the person must act on it.
    await call(app, "menuAction", "forget-dictation");
    await expect.poll(() => capsuleKind(app)).toBe("error");
    await expectProblem(await windowFor(app, "capsule"), {
      title: "That dictation may still be in the library.",
      lines: [
        "The words are deleted from the history, but the day file in the library couldn't be updated. They may still be in raw/dictations. Open that day's file in the library and remove them.",
      ],
    });
    expect(await history(app)).toEqual([]);
    expect(dayText(library)).toContain(second!.id);
  } finally {
    chmodSync(dictations(library), 0o755);
  }
  await app.close();
});

/** The "Dictate into any app" group of Settings → Voice. */
const cursorGroup = (settings: Page) => settings.locator("section", { has: settings.getByRole("heading", { name: "Dictate into any app", level: 3 }) });

/**
 * Every reply main has sent the Settings window by now has been drawn: a round trip to main from the page comes back after any reply
 * main sent before it (one channel, in order), and a frame later React has drawn what those replies set.
 */
async function repliesDrawn(settings: Page): Promise<void> {
  await settings.evaluate(async () => {
    await (window as unknown as { avanzel: { settings: { get(): Promise<unknown> } } }).avanzel.settings.get();
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  });
}

test("Settings → Voice turns the log on at once and saves the skip lists cleaned when a field is left; all of it is there after a reload", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Voice");
  const group = cursorGroup(settings);
  const log = group.getByRole("switch", { name: "Keep what I dictate in the library" });
  await expect(log).not.toBeChecked();
  await expect(
    group.getByText(
      "Each dictation is also written to raw/dictations/ in the library, one file a day, kept out of git, where your agent can read it. Copies made by sync tools such as Obsidian Sync or iCloud are outside this: a dictation you forget may stay in them.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(group.getByText("One bundle id per line, such as com.apple.Passwords. What you dictate there still goes in, but is never kept.", { exact: true })).toBeVisible();
  await expect(group.getByText("One website per line, such as example.com. What you dictate there still goes in, but is never kept.", { exact: true })).toBeVisible();
  await log.click();
  await expect.poll(() => loadSettings(library).dictation.log).toBe(true);
  await expect(log).toBeChecked();

  const apps = group.getByRole("textbox", { name: "Apps to skip" });
  await expect(apps).toHaveValue(loadSettings(library).dictation.skipApps.join("\n")); // the password managers, to begin with
  await apps.fill("com.apple.Passwords\n\n  com.tinyspeck.slackmacgap \ncom.apple.passwords");
  await apps.press("Tab");
  await expect.poll(() => loadSettings(library).dictation.skipApps).toEqual(["com.apple.Passwords", "com.tinyspeck.slackmacgap"]);
  await expect(apps).toHaveValue("com.apple.Passwords\ncom.tinyspeck.slackmacgap");

  const sites = group.getByRole("textbox", { name: "Sites to skip" });
  await expect(sites).toHaveValue("");
  await sites.fill("https://Bank.example.com/login\nwww.mail.test:8080");
  await sites.press("Tab");
  await expect.poll(() => loadSettings(library).dictation.skipSites).toEqual(["bank.example.com", "mail.test"]);
  await expect(sites).toHaveValue("bank.example.com\nmail.test");

  // A line that is no website is not saved, and the window says why; the field keeps what was typed.
  await sites.fill("bank.example.com\nnot a site");
  await sites.press("Tab");
  await expect(settings.getByText("That change wasn't saved.", { exact: true })).toBeVisible();
  await expect(
    settings.getByText('Line 2 of the sites to skip, "not a site", isn\'t a website. Write it as its address, such as example.com. The setting keeps its old value.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(sites).toHaveValue("bank.example.com\nnot a site");
  expect(loadSettings(library).dictation.skipSites).toEqual(["bank.example.com", "mail.test"]);

  await settings.reload();
  await settings.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: "Voice", exact: true }).click();
  const again = cursorGroup(settings);
  await expect(again.getByRole("switch", { name: "Keep what I dictate in the library" })).toBeChecked();
  await expect(again.getByRole("textbox", { name: "Apps to skip" })).toHaveValue("com.apple.Passwords\ncom.tinyspeck.slackmacgap");
  await expect(again.getByRole("textbox", { name: "Sites to skip" })).toHaveValue("bank.example.com\nmail.test");
  await app.close();
});

test("a skip list's save that waits while the person goes to another pane and back lands in the field, and leaving it undoes nothing", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Voice");
  const section = settings.getByRole("radiogroup", { name: "Section" });
  await holdTheQueue(app); // as a filing run would: the save waits its turn
  const sites = cursorGroup(settings).getByRole("textbox", { name: "Sites to skip" });
  await sites.fill("https://Bank.example.com/login");
  await sites.press("Tab"); // the save is sent, and waits
  // The other list is saved too while the first waits: neither reply may put the other field back.
  const apps = cursorGroup(settings).getByRole("textbox", { name: "Apps to skip" });
  await apps.fill("com.example.notes");
  await apps.press("Tab");
  await section.getByRole("radio", { name: "General", exact: true }).click();
  await section.getByRole("radio", { name: "Voice", exact: true }).click();
  const sitesAgain = cursorGroup(settings).getByRole("textbox", { name: "Sites to skip" });
  const appsAgain = cursorGroup(settings).getByRole("textbox", { name: "Apps to skip" });
  await letTheQueueGo(app);
  await call(app, "idleForTests");
  await expect.poll(() => loadSettings(library).dictation.skipSites).toEqual(["bank.example.com"]);
  await expect.poll(() => loadSettings(library).dictation.skipApps).toEqual(["com.example.notes"]);
  await repliesDrawn(settings);
  await expect(sitesAgain).toHaveValue("bank.example.com"); // what main kept
  await expect(appsAgain).toHaveValue("com.example.notes");
  await sitesAgain.focus();
  await sitesAgain.press("Tab"); // leaving the fields again saves nothing older over them
  await appsAgain.focus();
  await appsAgain.press("Tab");
  await call(app, "idleForTests");
  await repliesDrawn(settings);
  expect(loadSettings(library).dictation.skipSites).toEqual(["bank.example.com"]);
  expect(loadSettings(library).dictation.skipApps).toEqual(["com.example.notes"]);
  await app.close();
});
