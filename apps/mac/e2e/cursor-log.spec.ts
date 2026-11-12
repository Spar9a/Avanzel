// The library's log of dictations: with config.toml's [dictation] log on, each dictation into another app is also written to the
// day file raw/dictations/YYYY-MM-DD.md; the skip list keeps an app's dictations out of both stores; and forgetting one (Delete in
// Settings → Dictation, or the menu's "Forget the last dictation") takes it out of the day file too, or says so when it can't.
// Settings → Voice holds the switch and the skip lists. The Mac's side is the fake cursor helper (AVANZEL_FAKE_CURSOR).
import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, localDate } from "../../../packages/engine/src/index.ts";
import type { Target } from "../src/main/cursor-helper.ts";
import type { DictationEntry } from "../src/main/dictation-history.ts";
import { tildePath } from "../src/main/setup-model.ts";
import { expectProblem, holdTheQueue, letTheQueueGo } from "./capsule-helpers.ts";
import { call, capsuleKind, launch, makeLibrary, openSettings, speechWav, windowFor, toolbarItem, addTo, closeList, listButton, listed, removeFrom } from "./helpers.ts";

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
 * The `times`th dictation, as two taps of the key would make it; resolves once the words are pasted and the session is idle again,
 * which it is only after it has kept the words (or decided to keep none). A write to the day file starts within that same turn of
 * main's event loop, and is done before main answers the next call from here.
 */
async function dictate(app: ElectronApplication, pasteOut: string, times: number): Promise<void> {
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 60_000 }).toBe(WORDS.repeat(times));
  await expect.poll(() => call(app, "cursorIdleForTests")).toBe(true);
}

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
  expect(await history(app)).toEqual([expect.objectContaining({ text: WORDS, app: "Slack" })]);
  expect((await history(app))[0]).not.toHaveProperty("library");
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
  await dictate(app, pasteOut, 1);
  expect(await history(app)).toEqual([]);
  expect(existsSync(dictations(library))).toBe(false);
  // The same app, off the list: kept in both, so the session above had its chance to keep and chose not to.
  await call(app, "setLibrarySettings", { dictationSkipApps: [] });
  await dictate(app, pasteOut, 2);
  expect(await history(app)).toHaveLength(1);
  await expect.poll(() => dayText(library)).toContain((await history(app))[0]!.id);
  await app.close();
});

test("Delete in Settings → Dictation takes the dictation out of the day file too, and leaves the others", async () => {
  const library = await makeLibrary();
  const { app, pasteOut } = await launchWith(library);
  await call(app, "setLibrarySettings", { dictationLog: true });
  await dictate(app, pasteOut, 1);
  await dictate(app, pasteOut, 2);
  await expect.poll(async () => (await history(app)).length).toBe(2);
  const [first, second] = await history(app);
  await expect.poll(() => dayText(library)).toContain(`<!-- /dictation ${second!.id} -->`);
  const settings = await openSettings(app, "Dictation");
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

test("the panel's Forget the last dictation takes it out of the day file too", async () => {
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

test("a day file that can't be rewritten is told, by Delete and by the panel's Forget, and the dictation leaves the history all the same", async () => {
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
    const settings = await openSettings(app, "Dictation");
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

test("a dictation forgotten after another library opened leaves the day file of the library it was kept in, and one that has gone is named", async () => {
  const first = await makeLibrary();
  const { app, pasteOut } = await launchWith(first);
  await call(app, "setLibrarySettings", { dictationLog: true });
  await dictate(app, pasteOut, 1);
  await dictate(app, pasteOut, 2);
  const [older, newer] = await history(app);
  expect([older!.library, newer!.library]).toEqual([first, first]);
  await expect.poll(() => dayText(first)).toContain(`<!-- /dictation ${newer!.id} -->`);

  const second = await makeLibrary();
  await call(app, "useLibrary", second);
  const settings = await openSettings(app, "Dictation");
  const cards = settings.getByRole("article");
  await cards.last().getByRole("button", { name: "Delete", exact: true }).click(); // the older one
  await expect(cards).toHaveCount(1);
  await expect(settings.getByRole("alert")).toHaveCount(0);
  expect(dayText(first)).not.toContain(older!.id);
  expect(dayText(first)).toContain(newer!.id);
  expect(existsSync(dictations(second))).toBe(false);

  // The first library is moved away: the history still lets the dictation go, and says which library may still hold it.
  const moved = `${first}-moved`;
  renameSync(first, moved);
  await cards.first().getByRole("button", { name: "Delete", exact: true }).click();
  const notice = settings.getByRole("alert");
  await expect(notice).toContainText("That dictation may still be in the library.");
  await expect(notice).toContainText(
    `The words are deleted from the history, but the day file in the library at ${tildePath(first, homedir())} couldn't be updated. They may still be in raw/dictations there. Open that day's file in that library and remove them.`,
  );
  await expect(cards).toHaveCount(0);
  expect(await history(app)).toEqual([]);
  expect(readFileSync(path.join(moved, "raw", "dictations", path.basename(dayFile(first))), "utf8")).toContain(newer!.id);
  await app.close();
});

/** The Never kept group of Settings → Privacy. */
const neverKept = (settings: Page) => settings.locator("section", { has: settings.getByRole("heading", { name: "Never kept", exact: true }) });

/** Opens a skip list's editor with its row's Edit…, unless it is open: the list's own button is under the row then. */
async function editSkip(settings: Page, list: "Apps to skip" | "Sites to skip"): Promise<Locator> {
  const group = neverKept(settings);
  const edit = group.getByRole("group", { name: list, exact: true }).getByRole("button", { name: "Edit…", exact: true });
  if (await edit.isVisible()) await edit.click();
  await expect(listButton(group, list)).toBeVisible();
  return group;
}

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

test("Settings → Dictation turns the log on at once, and only then says what a sync tool's copies are outside of; it is still on after a reload", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Dictation");
  const log = settings.getByRole("switch", { name: "Keep what I dictate in the library" });
  const written = "Each dictation is also written to raw/dictations/ in the library, one file a day, kept out of git, where your agent can read it.";
  await expect(log).not.toBeChecked();
  await expect(settings.getByText(written, { exact: true })).toBeVisible();
  await log.click();
  await expect.poll(() => loadSettings(library).dictation.log).toBe(true);
  await expect(log).toBeChecked();
  await expect(
    settings.getByText(`${written} Copies made by sync tools such as Obsidian Sync or iCloud are outside this: a dictation you forget may stay in them.`, { exact: true }),
  ).toBeVisible();
  await settings.reload();
  await toolbarItem(settings, "Dictation").click();
  await expect(settings.getByRole("switch", { name: "Keep what I dictate in the library" })).toBeChecked();
  await app.close();
});

test("Settings → Privacy says what its skip lists hold, and saves each change to them at once, cleaned; all of it is there after a reload", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Privacy");
  const group = neverKept(settings);
  await expect(group.getByText("What you dictate there still goes in, but is never kept.", { exact: true })).toBeVisible();
  // What each row says of its list: the password managers it comes with by name, and no bundle ids until they are asked for.
  await expect(group.getByText("1Password, 1Password 7, Bitwarden and 6 more", { exact: true })).toBeVisible();
  await expect(group.getByText("None", { exact: true })).toBeVisible();
  await expect(listButton(group, "Apps to skip")).toHaveCount(0);

  await editSkip(settings, "Apps to skip");
  await expect(group.getByText("Add an app by its bundle id, such as com.apple.Passwords.", { exact: true })).toBeVisible();
  const managers = loadSettings(library).dictation.skipApps;
  expect(await listed(group, "Apps to skip")).toEqual(managers); // the password managers, to begin with
  // Each change is saved as it is made: all but Passwords taken out, then Slack put in, its spaces tidied; Passwords again isn't added twice.
  for (const id of managers.filter((id) => id !== "com.apple.Passwords")) await removeFrom(group, "Apps to skip", id);
  await expect.poll(() => loadSettings(library).dictation.skipApps).toEqual(["com.apple.Passwords"]);
  await addTo(group, "Apps to skip", "  com.tinyspeck.slackmacgap ");
  await addTo(group, "Apps to skip", "com.apple.passwords");
  await expect.poll(() => loadSettings(library).dictation.skipApps).toEqual(["com.apple.Passwords", "com.tinyspeck.slackmacgap"]);
  expect(await listed(group, "Apps to skip")).toEqual(["com.apple.Passwords", "com.tinyspeck.slackmacgap"]);
  await closeList(group, "Apps to skip");
  await expect(group.getByText("Passwords and slackmacgap", { exact: true })).toBeVisible();

  await editSkip(settings, "Sites to skip");
  await expect(
    group.getByText("Add a website by its address, such as example.com. Safari and Chrome-based browsers say which site is open. Other browsers can't, so there a dictation is kept.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(listButton(group, "Sites to skip")).toHaveAccessibleName("Sites to skip: Empty");
  // A site is kept as its address alone: no scheme, path, www or port, in lower case; the list shows what main kept.
  await addTo(group, "Sites to skip", "https://Bank.example.com/login");
  await addTo(group, "Sites to skip", "www.mail.test:8080");
  await expect.poll(() => loadSettings(library).dictation.skipSites).toEqual(["bank.example.com", "mail.test"]);
  await expect.poll(() => listed(group, "Sites to skip")).toEqual(["bank.example.com", "mail.test"]);
  await closeList(group, "Sites to skip");
  await expect(group.getByText("bank.example.com and mail.test, in Safari and Chrome-based browsers", { exact: true })).toBeVisible();

  // A line that is no website is not saved, and Settings says why; the list keeps what was added, and the row what is really kept.
  await addTo(group, "Sites to skip", "not a site");
  await expect(settings.getByText("That change wasn't saved.", { exact: true })).toBeVisible();
  await expect(
    settings.getByText('Line 3 of the sites to skip, "not a site", isn\'t a website. Write it as its address, such as example.com. The setting keeps its old value.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await listed(group, "Sites to skip")).toEqual(["bank.example.com", "mail.test", "not a site"]);
  await closeList(group, "Sites to skip");
  await expect(group.getByText("bank.example.com and mail.test, in Safari and Chrome-based browsers", { exact: true })).toBeVisible();
  expect(loadSettings(library).dictation.skipSites).toEqual(["bank.example.com", "mail.test"]);

  // Taking the lines out that main won't keep saves what is left; Done closes the editor.
  await removeFrom(group, "Sites to skip", "not a site");
  await removeFrom(group, "Sites to skip", "mail.test");
  await expect.poll(() => loadSettings(library).dictation.skipSites).toEqual(["bank.example.com"]);
  await closeList(group, "Sites to skip");
  await group.getByRole("group", { name: "Sites to skip", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
  await expect(listButton(group, "Sites to skip")).toHaveCount(0);
  await expect(group.getByText("bank.example.com, in Safari and Chrome-based browsers", { exact: true })).toBeVisible();

  await settings.reload();
  await call(app, "showSettings", "privacy");
  await toolbarItem(settings, "Privacy").click();
  await expect(neverKept(settings).getByText("Passwords and slackmacgap", { exact: true })).toBeVisible();
  expect(await listed(await editSkip(settings, "Apps to skip"), "Apps to skip")).toEqual(["com.apple.Passwords", "com.tinyspeck.slackmacgap"]);
  await closeList(neverKept(settings), "Apps to skip");
  expect(await listed(await editSkip(settings, "Sites to skip"), "Sites to skip")).toEqual(["bank.example.com"]);
  await app.close();
});

test("a skip list's save that waits while the person goes to another pane and back lands in the list, and neither list puts the other back", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const settings = await openSettings(app, "Privacy");
  const managers = loadSettings(library).dictation.skipApps;
  await holdTheQueue(app); // as a filing run would: the save waits its turn
  const group = await editSkip(settings, "Sites to skip");
  await addTo(group, "Sites to skip", "https://Bank.example.com/login"); // the save is sent, and waits
  await closeList(group, "Sites to skip");
  // The other list is saved too while the first waits: neither reply may put the other list back.
  await editSkip(settings, "Apps to skip");
  await addTo(group, "Apps to skip", "com.example.notes");
  await closeList(group, "Apps to skip");
  await toolbarItem(settings, "General").click();
  await toolbarItem(settings, "Privacy").click();
  await letTheQueueGo(app);
  await call(app, "idleForTests");
  await expect.poll(() => loadSettings(library).dictation.skipSites).toEqual(["bank.example.com"]);
  await expect.poll(() => loadSettings(library).dictation.skipApps).toEqual([...managers, "com.example.notes"]);
  await repliesDrawn(settings);
  expect(await listed(await editSkip(settings, "Sites to skip"), "Sites to skip")).toEqual(["bank.example.com"]); // what main kept
  await closeList(neverKept(settings), "Sites to skip");
  expect(await listed(await editSkip(settings, "Apps to skip"), "Apps to skip")).toEqual([...managers, "com.example.notes"]);
  await app.close();
});
