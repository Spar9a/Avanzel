import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { git, loadSettings, saveSettings, writeWav } from "../../../packages/engine/src/index.ts";
import type { SettingsSnapshot } from "../src/shared/ipc.ts";
import {
  agentStubs,
  alive,
  answerAs,
  call,
  capsuleKind,
  capturesKept,
  exists,
  filesUnder,
  filingClaude,
  launch,
  limitedClaude,
  makeLibrary,
  onceMarker,
  onlyAgentsIn,
  openedWith,
  read,
  libraryListed,
  screenshotFixture,
  shown,
  SIGNED_IN,
  snap,
  speechWav,
  stubOpening,
  windowFor,
  toolbarItem,
} from "./helpers.ts";
import { barOf, capsuleAtRest, cardButtons, expectProblem, launchOn, panelOn } from "./capsule-helpers.ts";

const inbox = (root: string) => readdirSync(path.join(root, "inbox")).filter((n) => !n.startsWith("."));
const archived = (root: string) => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.endsWith(".md")) files.push(path.join(dir, entry.name));
    }
  };
  walk(path.join(root, "raw"));
  return files;
};

test("dictation is transcribed on the Mac, filed by the agent, and shows the pages", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("I want to launch my podcast about indie game development before the end of the year."),
    FAKE_AGENT_DELAY_MS: "3000", // filing starts at once: give the filing card time to be seen
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await snap(capsule, "1-listening");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000, intervals: [50] }).toBe("filing");
  await snap(capsule, "2-filing");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect(capsule.getByText("Filed by fake")).toBeVisible();
  await snap(capsule, "3-filed");
  expect(inbox(library)).toEqual([]);
  const [capture] = archived(library);
  expect(readFileSync(capture!, "utf8")).toContain("podcast about indie game development");
  await app.close();
});

test("Russian dictation keeps its words and gets a timestamp id", async () => {
  const library = await makeLibrary();
  const speech = speechWav("Идея: сделать маленький сад на балконе с помидорами и базиликом.", "Milena");
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speech, FAKE_AGENT_DELAY_MS: "3000" });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000, intervals: [50] }).toBe("filing");
  await expect(capsule.getByText(/балконе/)).toBeVisible();
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const [capture] = archived(library);
  expect(path.basename(capture!)).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}/);
  expect(readFileSync(capture!, "utf8")).toMatch(/сад на балконе/);
  await app.close();
});

test("an agent failure is shown and the note stays in the inbox", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "will not be filed", FAKE_AGENT_MODE: "fail" });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("error");
  // The fake agent's "fail" mode says "not logged in": the card reads it as a sign-in, which Terminal fixes. fake isn't
  // Claude Code or Codex, so the card gives no command to run, and the evening review is what files the note.
  await expectProblem(capsule, {
    title: "fake isn't signed in on this Mac.",
    lines: ["Sign in to fake in Terminal. Your note is safe in the inbox; the evening review will try again."],
    fix: "Open Terminal",
  });
  await snap(capsule, "5-error");
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a screen capture with a spoken comment waits in the inbox with its screenshot", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "This mic looks right for the podcast",
    AVANZEL_FAKE_SCREEN: screenshotFixture(),
    AVANZEL_FAKE_FRONT_APP: "Safari|Shure MV7+ Podcast Microphone|https://www.shure.com/mv7",
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  await snap(capsule, "6-capture-listening");
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  // The evening review files it, at the time the library's review runs.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ note: "Saved to the inbox for the evening review at 21:00." });
  await snap(capsule, "7-capture-saved");
  // The card is the app's name over the comment, stamped Saved, with the screenshot, the page's title and its address (without
  // "https://") in its footer, over the note. The bar says Saved, with Hide alone.
  const card = capsule.getByRole("article");
  await expect(capsule.getByRole("status").getByText("Saved", { exact: true })).toBeVisible();
  await expect(capsule.getByRole("status").getByRole("button")).toHaveCount(1);
  await expect(card.getByText("Safari", { exact: true })).toBeVisible();
  await expect(card.getByText("This mic looks right for the podcast", { exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: /^Saved, / })).toBeVisible();
  await expect(card.getByRole("img", { name: "Screenshot of Safari", exact: true })).toBeVisible();
  await expect(card.getByText("Shure MV7+ Podcast Microphone", { exact: true })).toBeVisible();
  await expect(card.getByText("www.shure.com/mv7", { exact: true })).toBeVisible();
  await expect(card.getByText("Saved to the inbox for the evening review at 21:00.", { exact: true })).toBeVisible();
  const [name] = inbox(library);
  const capture = read(library, `inbox/${name}`);
  expect(capture).toContain("source: screen");
  expect(capture).toContain("url: https://www.shure.com/mv7");
  expect(capture).toMatch(/attachments: \[?raw\/attachments\//);
  expect(capture).toContain("This mic looks right for the podcast");
  await app.close();
});

test("words whose recording the library won't keep are saved without it, and the capsule says why", async () => {
  const library = await makeLibrary();
  const outside = mkdtempSync(path.join(tmpdir(), "avz-e2e-outside-"));
  mkdirSync(path.join(library, "raw", "audio"));
  symlinkSync(outside, path.join(library, "raw", "audio", String(new Date().getFullYear())));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Water the basil every morning",
    AVANZEL_FAKE_SCREEN: screenshotFixture(),
    AVANZEL_FAKE_FRONT_APP: "Safari|Growing basil|https://example.com/basil",
    FAKE_AGENT_DELAY_MS: "3000", // the filing card stays up long enough to read
  });
  const capsule = await windowFor(app, "capsule");
  // One short line: why (the link on the way), and what to do about it.
  const why = /^Only your words were kept: raw\/audio\/\d{4}\/\d{2} isn't a plain folder\. Remove the link or file on its path to keep recordings\.$/;
  const note = capsule.getByText(why);
  // A dictation: filed without its recording.
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect(note).toBeVisible({ timeout: 30_000 });
  // The filing is a card of paper: the note is a footnote in its footer, under one line of the seconds and how the words were made,
  // which ticks outside the card's live region (its status chip).
  const card = capsule.getByRole("article");
  await expect(card.getByText(why)).toBeVisible();
  const meta = card.getByText(/^(\d+ s of about \d+|\d+ s) · Transcribed on this Mac in \d+\.\d s$/);
  await expect(meta).toBeVisible();
  expect((await meta.boundingBox())!.y).toBeLessThan((await card.getByText(why).boundingBox())!.y);
  await expect(card.getByRole("status")).toHaveText(/^(Filing with fake|Waiting to file)$/);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  const [filed, ...others] = archived(library);
  expect(others).toEqual([]);
  expect(readFileSync(filed!, "utf8")).toContain("Water the basil every morning");
  expect(readFileSync(filed!, "utf8")).not.toContain("audio:");
  // A screen capture's spoken comment: saved with its screenshot, without its recording.
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  await expect(note).toBeVisible();
  const [name] = inbox(library);
  const comment = read(library, `inbox/${name}`);
  expect(comment).toContain("source: screen");
  expect(comment).toContain("Water the basil every morning");
  expect(comment).toMatch(/attachments: \[?raw\/attachments\//);
  expect(comment).not.toContain("audio:");
  // No recording anywhere, in the library or where the link leads.
  expect(filesUnder(library, "raw").filter((rel) => !rel.endsWith(".md") && !rel.endsWith(".png"))).toEqual([]);
  expect(readdirSync(outside)).toEqual([]);
  await app.close();
});

test("words whose recording can't be saved for another reason are kept, and the capsule says so plainly", async () => {
  const library = await makeLibrary();
  const audio = path.join(library, "raw", "audio");
  mkdirSync(audio);
  chmodSync(audio, 0o555); // the folder for this year's recordings can't be made
  try {
    const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "Call the vet on Monday" });
    const capsule = await windowFor(app, "capsule");
    await call(app, "setApp", { fileMode: "evening" });
    await call(app, "toggleDictate");
    await call(app, "toggleDictate");
    await expect(capsule.getByText("Only your words were kept: the recording couldn't be saved.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const [name] = inbox(library);
    expect(read(library, `inbox/${name}`)).toContain("Call the vet on Monday");
    expect(read(library, `inbox/${name}`)).not.toContain("audio:");
    await app.close();
  } finally {
    chmodSync(audio, 0o755);
  }
});

test("typing a thought files it", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  await quick.getByRole("textbox", { name: "Type a thought" }).fill("Plant tulips in October");
  await snap(quick, "8-quick");
  await quick.getByRole("textbox", { name: "Type a thought" }).press("Enter");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a typed thought that can't be saved says so and where its words are, and its one fix opens them again", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  const capsule = await windowFor(app, "capsule");
  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  const box = quick.getByRole("textbox", { name: "Type a thought" });
  const inboxDir = path.join(library, "inbox");
  chmodSync(inboxDir, 0o555); // nothing can be written there
  try {
    await box.fill("Plant tulips in October");
    await box.press("Enter");
    await expect.poll(() => capsuleKind(app)).toBe("error");
    // What happened, and where the words are now, by the action's name: no key (a key is a Kbd), and no "box". The one fix opens it.
    const title = "That thought couldn't be saved.";
    const why = /^EACCES: permission denied.*[.…] Your words are still in “Type a thought”\.$/;
    expect(await call(app, "capsuleStateForTests")).toEqual({
      kind: "error",
      message: title,
      detail: expect.stringMatching(why),
      action: "type-a-thought",
      actionLabel: "Type a thought",
    });
    await expectProblem(capsule, { title, lines: [why], fix: "Type a thought" });
    // Quick has put itself away, and the words wait in its field.
    await expect.poll(() => shown(app, "quick")).toBe(false);
    await expect(box).toHaveValue("Plant tulips in October");
    expect(inbox(library)).toEqual([]);
    // The fix opens Type a thought again, with the words in it, and the card goes.
    await capsule.getByRole("button", { name: "Type a thought", exact: true }).click();
    await expect.poll(() => shown(app, "quick")).toBe(true);
    await expect.poll(() => capsuleKind(app)).toBe("hidden");
    await expect(box).toHaveValue("Plant tulips in October");
  } finally {
    chmodSync(inboxDir, 0o755);
  }
  // Return saves the thought, now that the inbox can take it: it is filed, and the field is empty.
  await box.press("Enter");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect(box).toHaveValue("");
  await app.close();
});

test("the fix of a thought that couldn't be saved leaves a card that has replaced it alone", async () => {
  // The press is a stale one if the capsule shows something else by the time it arrives, say a recording: it opens nothing and hides nothing.
  const { app } = await launchHearing(await makeLibrary(), newUserData());
  await startListening(app);
  await call(app, "openSettingsFor", "type-a-thought");
  expect(await capsuleKind(app)).toBe("listening");
  expect(await shown(app, "quick")).toBe(false);
  await call(app, "cancelRecording");
  await app.close();
});

test("Quick is a clear page on a native panel: its field has the focus, and Esc puts it away", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  await expect(quick.getByRole("textbox", { name: "Type a thought" })).toBeFocused();
  // macOS draws the panel's surface (its material, corners and shadow), so the page itself is clear. Save is the panel's one primary
  // button, and waits for words: it is disabled while the field is empty (Return saves too).
  await expect(quick.locator("html")).toHaveAttribute("data-backdrop", "clear");
  const save = quick.getByRole("button", { name: "Save", exact: true });
  await expect(save).toHaveAttribute("data-variant", "primary");
  await expect(save).toBeDisabled();
  await quick.getByRole("textbox", { name: "Type a thought" }).fill("Plant tulips in October");
  await expect(save).toBeEnabled();
  await quick.getByRole("textbox", { name: "Type a thought" }).fill("");
  await expect(save).toBeDisabled();
  await expect.poll(() => shown(app, "quick")).toBe(true);
  await quick.keyboard.press("Escape");
  await expect.poll(() => shown(app, "quick")).toBe(false);
  await app.close();
});

test("Quick's field has the focus again when the panel opens after a thought was saved", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  const field = quick.getByRole("textbox", { name: "Type a thought" });
  await field.fill("Plant tulips in October");
  await field.press("Enter");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  // The field is disabled while the thought is saved, which takes the focus from it: it must have it for the next one.
  await call(app, "openQuick");
  await expect(field).toBeEnabled();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await app.close();
});

/**
 * "Plant tulips in October", typed in Quick and filed by the fake agent into a library with git, so the filing is its
 * own commit: the capsule shows the filed card, with Undo. The pointer then rests on the card, which keeps it open
 * past its 8 s, as a person's would.
 */
async function typedAndFiled(): Promise<{ library: string; app: ElectronApplication; capsule: Page }> {
  const library = await makeLibrary({ git: true });
  const app = await launch({ AVANZEL_LIBRARY: library });
  const capsule = await windowFor(app, "capsule");
  await call(app, "openQuick");
  const quick = await windowFor(app, "quick");
  await quick.getByRole("textbox", { name: "Type a thought" }).fill("Plant tulips in October");
  await quick.getByRole("textbox", { name: "Type a thought" }).press("Enter");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await capsule.getByRole("button", { name: "Undo" }).hover();
  return { library, app, capsule };
}

test("Undo on the filed card takes the filing back, and the note waits in the inbox again", async () => {
  const { library, app, capsule } = await typedAndFiled();
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(await libraryListed(app)).toEqual(["Plant tulips in October"]);
  // The filed card first, with no bar: its foot says who filed it and how long it took, and it offers Undo and Open, and Hide in its
  // corner; it is stamped Filed and lists the page the filing made, new.
  const bar = barOf(capsule);
  const card = capsule.getByRole("article");
  await expect(card.getByRole("status").getByText(/^Filed by fake in \d+ s$/)).toBeVisible();
  await expect(bar).toHaveCount(0);
  expect(await cardButtons(capsule)).toEqual(["Undo", "Open", "Hide"]);
  await expect(card.getByRole("img", { name: /^Filed, \d{1,2} [A-Z][a-z]{2} \d{4}$/ })).toBeVisible();
  await expect(card.getByRole("listitem")).toHaveCount(1);
  await expect(card.getByRole("listitem").getByText("new", { exact: true })).toBeVisible();
  await capsule.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  await expect(capsule.getByText("Your words are back in the inbox for the evening review at 21:00.")).toBeVisible();
  // It is an Undone card: the state says so, the bar says Undone with Hide alone, and the card holds the words, with no stamp, as
  // the filing it would stamp is gone.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    kind: "saved",
    undone: true,
    text: "Plant tulips in October",
    note: "Your words are back in the inbox for the evening review at 21:00.",
  });
  await expect(bar.getByText("Undone", { exact: true })).toBeVisible();
  await expect(bar.getByRole("button")).toHaveCount(1);
  await expect(bar.getByRole("button", { name: "Hide", exact: true })).toBeVisible();
  await expect(card.getByText("Plant tulips in October", { exact: true })).toBeVisible();
  await expect(card).not.toHaveAttribute("data-stamped");
  expect(inbox(library)).toHaveLength(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await libraryListed(app)).toEqual([]);
  await app.close();
});

test("an Undo git refuses says so on the card, and the edit made since stays", async () => {
  const { library, app, capsule } = await typedAndFiled();
  // Meanwhile the new note is edited by hand, and the edit committed: undoing the filing would take the edit with it.
  const [page = ""] = filesUnder(library, "ideas");
  const file = path.join(library, "ideas", page);
  writeFileSync(file, "# Tulips, by hand\n");
  expect(await git.commitAll(library, "An edit by hand")).not.toBeNull();
  await capsule.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  // The card says what happened and why, and that the history keeps both versions; there is nothing to fix, so Hide alone.
  const title = "This one can't be undone automatically.";
  const why = "Usually a later change touched the same lines. The library's history keeps both versions.";
  await expectProblem(capsule, { title, lines: [why] });
  expect(await call(app, "capsuleStateForTests")).toEqual({ kind: "error", message: title, detail: why });
  expect(readFileSync(file, "utf8")).toBe("# Tulips, by hand\n");
  expect(inbox(library)).toEqual([]);
  // The panel's Library lists the page all the same, under the title the edit gave it.
  expect(await libraryListed(app)).toEqual(["Tulips, by hand"]);
  await app.close();
});

test("the panel's Library invites a first thought while nothing is filed, and lists the note once one is", async () => {
  const app = await launch({
    AVANZEL_LIBRARY: await makeLibrary(),
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Say hello to the garden",
  });
  expect(await libraryListed(app)).toEqual([]);
  const panel = await panelOn(app, "library");
  const invite = panel.getByText("Nothing filed yet. Press ⌥Space and say hello.", { exact: true });
  await expect(invite).toBeVisible();
  await call(app, "hidePanel");
  // A thought, recorded and filed: the note takes the invitation's place.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect.poll(() => libraryListed(app)).toHaveLength(1);
  await panelOn(app, "library");
  await expect(invite).toHaveCount(0);
  await app.close();
});

test("the Library's invitation says to record a thought when the dictate shortcut is another app's", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary(), AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space" });
  const panel = await panelOn(app, "library");
  await expect(panel.getByText("Nothing filed yet. Record a thought and say hello.", { exact: true })).toBeVisible();
  await app.close();
});

test("asking shows the agent's answer", async () => {
  const library = await makeLibrary();
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await ask.getByRole("textbox", { name: "Ask your library" }).fill("What are my goals?");
  await ask.getByRole("textbox", { name: "Ask your library" }).press("Enter");
  await expect(ask.getByText("Q: What are my goals?")).toBeVisible({ timeout: 60_000 });
  // The question heads its answer, which ends with who answered and in how long. No link in it names a page, so none is listed.
  await expect(ask.getByRole("heading", { name: "What are my goals?", exact: true })).toBeVisible();
  await expect(ask.getByText(/^fake answered in \d+ s$/)).toBeVisible();
  await expect(ask.getByText("Notes used:")).toHaveCount(0);
  await snap(ask, "9-ask");
  await app.close();
});

test("Ask on a library with no pages says to say something first, and gives the usual line back once a page is there", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  // The six shelves count, as Settings' library line counts them: a page in a folder of the owner's own doesn't.
  expect(await call(app, "libraryPages")).toBe(0);
  mkdirSync(path.join(library, "notes"));
  writeFileSync(path.join(library, "notes", "loose.md"), "# Loose\n");
  expect(await call(app, "libraryPages")).toBe(0);
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const empty = ask.getByText("Your shelves are empty. Say something first, then ask about it.", { exact: true });
  const usual = ask.getByText("Answers come from your library only, with links to the notes they use.", { exact: true });
  await expect(empty).toBeVisible();
  await expect(usual).toHaveCount(0);
  await snap(ask, "9-ask-empty-shelves");
  // A page lands on a shelf while the window is open, say a note was filed: the window counts the shelves again when it
  // has the focus again, so the line doesn't go on inviting a first thought.
  writeFileSync(path.join(library, "ideas", "tulips.md"), "# Tulips\n");
  expect(await call(app, "libraryPages")).toBe(1);
  await ask.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(usual).toBeVisible();
  await expect(empty).toHaveCount(0);
  await app.close();
});

test("an answer's links become buttons that open the pages they name", async () => {
  const library = await makeLibrary();
  writeFileSync(path.join(library, "goals", "run-a-marathon.md"), "# Run a marathon\n");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await ask.getByRole("textbox", { name: "Ask your library" }).fill("What about [[run-a-marathon]]?");
  await ask.getByRole("textbox", { name: "Ask your library" }).press("Enter");
  // The fake agent repeats the question, so its answer links the page: the link reads as the words it gives, and the page
  // is a button beside its shelf.
  await expect(ask.getByText("Q: What about run-a-marathon?")).toBeVisible({ timeout: 60_000 });
  await expect(ask.getByText("Notes used:", { exact: true })).toBeVisible();
  const page = ask.getByRole("button", { name: "Run a marathon", exact: true });
  await expect(page).toBeVisible();
  await expect(ask.getByText("Goals", { exact: true })).toBeVisible();
  await snap(ask, "9-ask-sources");
  // The button opens its page.
  await stubOpening(app);
  await page.click();
  await expect.poll(() => openedWith(app)).toHaveLength(1);
  expect(realpathSync((await openedWith(app))[0] ?? "")).toBe(realpathSync(path.join(library, "goals", "run-a-marathon.md")));
  await app.close();
});

test("a page's long title is shortened, so its button stays inside the window", async () => {
  const library = await makeLibrary();
  // 215 characters: a button never wraps its words, so it would run out of the window, and its start out of sight.
  const title = "A very long page title that goes on and on ".repeat(5).trim();
  writeFileSync(path.join(library, "ideas", "long-title.md"), `# ${title}\n`);
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await ask.getByRole("textbox", { name: "Ask your library" }).fill("What is in [[long-title]]?");
  await ask.getByRole("textbox", { name: "Ask your library" }).press("Enter");
  // The button shows the title's first 39 characters and "…", as setup's Ask step does, and the turns don't scroll sideways.
  await expect(ask.getByRole("button", { name: "A very long page title that goes on and…", exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await ask.locator(".ask-turns").evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  await app.close();
});

test("the newest question comes first", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill("First question?");
  await field.press("Enter");
  await expect(ask.getByText("Q: First question?")).toBeVisible({ timeout: 60_000 });
  await field.fill("Second question?");
  await field.press("Enter");
  // The second sits above the first at once, while the agent still looks, and stays there once it has answered.
  await expect(ask.getByRole("heading")).toHaveText(["Second question?", "First question?"]);
  await expect(ask.getByText("Q: Second question?")).toBeVisible({ timeout: 60_000 });
  await expect(ask.getByRole("heading")).toHaveText(["Second question?", "First question?"]);
  await app.close();
});

test("a failed answer names the agent that couldn't answer, and a question that can't be asked says only why", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_MODE: "fail" });
  // The agent ran and failed: its last lines, under the name of the agent whose run it was, and why, as the engine classifies
  // it ("not logged in" is a sign-in). There are no lines or pages to show, and the run changed nothing in the library.
  expect(await call(app, "ask", "What are my goals?")).toMatchObject({
    ok: false,
    answer: "fake couldn't answer.\nagent crashed: not logged in",
    agent: "fake",
    paragraphs: [],
    sources: [],
    changedFiles: 0,
    failure: { kind: "signin", agent: "fake", command: null, resetsAt: null, line: "agent crashed: not logged in" },
  });
  // Nothing ran: the engine refused the question, and its message comes back as it is. Nothing changed either, and no agent failed.
  expect(await call(app, "ask", "   ")).toMatchObject({
    ok: false,
    answer: 'Ask a question, e.g. "what are my goals this year?"',
    agent: "fake",
    paragraphs: [],
    sources: [],
    changedFiles: 0,
    failure: null,
  });
  // A run that wrote in the library says how many files, as an agent that doesn't keep to read-only might: this one starts a
  // page, then runs out of time.
  saveSettings(library, { ...loadSettings(library), timeoutSeconds: 2 });
  await app.evaluate(() => {
    process.env.FAKE_AGENT_MODE = "slow-messy";
  });
  expect(await call(app, "ask", "What changed?")).toMatchObject({
    ok: false,
    answer: expect.stringMatching(/^fake couldn't answer\./),
    changedFiles: 1,
    failure: { kind: "timeout", seconds: 2 },
  });
  expect(exists(library, "goals/half.md")).toBe(true);
  await app.close();
});

/** A library that the agent `harness` ("claude") answers, opened on a Mac whose only agents are the stand-ins in `bin`. */
async function libraryOn(harness: string, bin: string, env: Record<string, string> = {}): Promise<{ library: string; app: ElectronApplication }> {
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness });
  return { library, app: await launch({ AVANZEL_LIBRARY: library, ...onlyAgentsIn(bin), ...env }) };
}

/** Opens the Ask window of `app` and asks `words` in it: the window, and its field. */
async function askIn(app: ElectronApplication, words: string): Promise<{ ask: Page; field: Locator }> {
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill(words);
  await field.press("Enter");
  return { ask, field };
}

test("a failed answer says so in the window, says the library hasn't changed, and Ask again asks it again", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_MODE: "fail" });
  const { ask, field } = await askIn(app, "What are my goals?");
  // The fake agent's "fail" mode says "not logged in": the Notice reads it as a sign-in. It names the agent whose run failed,
  // says what is safe, then what to do. fake isn't Claude Code or Codex, so there is no command to run, only to sign in.
  const notice = ask.getByRole("alert");
  await expect(notice).toContainText("fake isn't signed in on this Mac.", { timeout: 60_000 });
  await expect(notice).toContainText("Your library hasn't changed. Sign in to fake in Terminal, then ask again.");
  await expect(ask.getByRole("heading", { name: "What are my goals?", exact: true })).toBeVisible();
  // The moment's one primary is the fix, Open Terminal; Ask again is secondary. The primary comes last in the row.
  const terminal = notice.getByRole("button", { name: "Open Terminal", exact: true });
  const again = notice.getByRole("button", { name: "Ask again", exact: true });
  await expect(terminal).toHaveAttribute("data-variant", "primary");
  await expect(again).toHaveAttribute("data-variant", "secondary");
  await expect(notice.getByRole("button")).toHaveText(["Ask again", "Open Terminal"]);
  await expect(notice.locator('button[data-variant="primary"]')).toHaveCount(1);
  await snap(ask, "9-ask-failed-signin");
  // Open Terminal opens Terminal (under test it only notes that it would), and leaves the Notice and the question be.
  expect(await call(app, "openedForTests")).toEqual([]);
  await terminal.click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["Terminal"]);
  await expect(notice).toContainText("fake isn't signed in on this Mac.");
  // The person has signed the agent in. Ask again asks the same question, as a new turn above the failed one, and the field has the focus.
  await app.evaluate(() => {
    process.env.FAKE_AGENT_MODE = "ok";
  });
  await again.click();
  await expect(ask.getByText("Q: What are my goals?")).toBeVisible({ timeout: 60_000 });
  await expect(ask.getByRole("heading")).toHaveText(["What are my goals?", "What are my goals?"]);
  await expect(field).toBeFocused();
  // The failed turn stays, without its fixes: only the newest turn offers any.
  await expect(notice).toContainText("fake isn't signed in on this Mac.");
  await expect(ask.getByRole("button", { name: "Ask again" })).toHaveCount(0);
  await expect(ask.getByRole("button", { name: "Open Terminal" })).toHaveCount(0);
  await app.close();
});

test("a failed answer's one fix is Ask again, the moment's primary, and the field has the focus after it", async () => {
  const library = await makeLibrary();
  // "fail-noisy" echoes the prompt, as Codex does, then fails with a line that is none of a limit, a sign-in or a timeout.
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_MODE: "fail-noisy" });
  const { ask, field } = await askIn(app, "What are my goals?");
  const notice = ask.getByRole("alert");
  await expect(notice).toContainText("fake couldn't answer.", { timeout: 60_000 });
  await expect(notice).toContainText("Your library hasn't changed. The model is not supported with this account.");
  // Its one fix, the moment's primary, and nothing else to press.
  const again = notice.getByRole("button", { name: "Ask again", exact: true });
  await expect(again).toHaveAttribute("data-variant", "primary");
  await expect(notice.getByRole("button")).toHaveCount(1);
  await snap(ask, "9-ask-failed");
  // The agent works now. Ask again asks the same question, as a new turn above the failed one, and the field has the focus.
  await app.evaluate(() => {
    process.env.FAKE_AGENT_MODE = "ok";
  });
  await again.click();
  await expect(ask.getByText("Q: What are my goals?")).toBeVisible({ timeout: 60_000 });
  await expect(ask.getByRole("heading")).toHaveText(["What are my goals?", "What are my goals?"]);
  await expect(field).toBeFocused();
  // The failed turn stays, without its fix: only the newest turn offers one.
  await expect(notice).toContainText("fake couldn't answer.");
  await expect(ask.getByRole("button", { name: "Ask again" })).toHaveCount(0);
  await app.close();
});

test("a failed answer from Claude Code names what to run, set as code", async () => {
  const bin = agentStubs({ claude: filingClaude({ FAKE_AGENT_MODE: "fail" }) }); // "not logged in"
  const { app } = await libraryOn("claude", bin);
  const { ask } = await askIn(app, "What are my goals?");
  const notice = ask.getByRole("alert");
  await expect(notice).toContainText("Claude Code isn't signed in on this Mac.", { timeout: 60_000 });
  await expect(notice).toContainText("Your library hasn't changed. Run claude once in Terminal and sign in, then ask again.");
  await expect(notice.locator("code")).toHaveText("claude"); // the command, and only the command, in code font
  await expect(notice.getByRole("button", { name: "Open Terminal", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(notice.getByRole("button", { name: "Ask again", exact: true })).toHaveAttribute("data-variant", "secondary");
  await snap(ask, "9-ask-failed-claude");
  await app.close();
});

test("a usage limit in the Ask window says when it resets, and that the library hasn't changed", async () => {
  const bin = agentStubs({ claude: limitedClaude() }); // resets tomorrow at 09:00
  const { app } = await libraryOn("claude", bin);
  const { ask } = await askIn(app, "What are my goals?");
  const notice = ask.getByRole("alert");
  await expect(notice).toContainText("Claude Code has hit its usage limit.", { timeout: 60_000 });
  await expect(notice.getByText("Your library hasn't changed. It resets tomorrow at 09:00.", { exact: true })).toBeVisible();
  // Asking again is the one fix, and no command is shown: there is none to run.
  await expect(notice.getByRole("button")).toHaveText(["Ask again"]);
  await expect(notice.getByRole("button", { name: "Ask again" })).toHaveAttribute("data-variant", "primary");
  await expect(notice.locator("code")).toHaveCount(0);
  await app.close();
});

test("a run that changed files says how many, and that they are left as they are", async () => {
  // A stand-in Claude Code that, asked a question, creates a page, changes one and deletes one, then fails.
  const bin = agentStubs({
    claude: `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; exit 0; fi
case "$2" in "Avanzel task: ask"*) echo "# New" > goals/new.md; echo more >> goals/old.md; rm goals/gone.md; echo 'Error: boom' >&2; exit 1;; esac
exit 0`,
  });
  const library = await makeLibrary();
  saveSettings(library, { ...loadSettings(library), harness: "claude" });
  const setUp = () => {
    writeFileSync(path.join(library, "goals", "old.md"), "# Old\n");
    writeFileSync(path.join(library, "goals", "gone.md"), "# Gone\n");
    rmSync(path.join(library, "goals", "new.md"), { force: true });
  };
  setUp();
  const app = await launch({ AVANZEL_LIBRARY: library, ...onlyAgentsIn(bin) });
  // A file created, one changed and one deleted are three.
  expect(await call(app, "ask", "What changed?")).toMatchObject({ ok: false, changedFiles: 3, failure: { kind: "other", agent: "Claude Code" } });
  setUp();
  const { ask } = await askIn(app, "What changed?");
  const notice = ask.getByRole("alert");
  await expect(notice).toContainText("Claude Code couldn't answer.", { timeout: 60_000 });
  await expect(notice.getByText("Claude Code changed 3 files while answering; they're left as they are. Boom.", { exact: true })).toBeVisible();
  await expect(notice).not.toContainText("Your library hasn't changed");
  expect(exists(library, "goals/new.md")).toBe(true); // left as it is
  expect(exists(library, "goals/gone.md")).toBe(false);
  await app.close();
});

test("a question that never reached the agent is Avanzel's own failure, in the words of what is wrong", async () => {
  // Claude Code is installed, and the library's own settings file is what is wrong: no agent failed, and none is named.
  const library = await makeLibrary();
  writeFileSync(path.join(library, ".avanzel", "config.toml"), 'harness = "claude"\ntimeout_seconds =\n');
  const app = await launch({ AVANZEL_LIBRARY: library, ...onlyAgentsIn(agentStubs()) });
  const { ask } = await askIn(app, "What are my goals?");
  const notice = ask.getByRole("alert");
  await expect(notice).toContainText("Avanzel couldn't answer.", { timeout: 60_000 });
  await expect(notice.getByText(/^Your library hasn't changed\. .*config\.toml: invalid TOML at line 2, column \d+: .+\.$/)).toBeVisible();
  await expect(notice).not.toContainText("your agent");
  await expect(notice.getByRole("button")).toHaveText(["Ask again"]); // mended by hand, then asked again
  await app.close();
});

test("when the library's agent is gone, the fix is Open Settings, on Agents", async () => {
  const bin = mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-"));
  answerAs(bin, "codex", SIGNED_IN.codex!); // this Mac has Codex, but the library's agent is Claude Code
  const { app } = await libraryOn("claude", bin);
  const { ask } = await askIn(app, "What are my goals?");
  const notice = ask.getByRole("alert");
  await expect(notice).toContainText("Claude Code isn't installed on this Mac any more.", { timeout: 60_000 });
  await expect(notice.getByText("Your library hasn't changed. Settings → Agents can choose another agent, or has its install command.", { exact: true })).toBeVisible();
  // One fix, and it is the primary: Ask again would only fail again until another agent is chosen.
  await expect(notice.getByRole("button")).toHaveText(["Open Settings"]);
  const settingsFix = notice.getByRole("button", { name: "Open Settings", exact: true });
  await expect(settingsFix).toHaveAttribute("data-variant", "primary");
  await snap(ask, "9-ask-failed-gone");
  await settingsFix.click();
  const settings = await windowFor(app, "panel");
  await expect(toolbarItem(settings, "Agents")).toHaveAttribute("aria-selected", "true");
  await app.close();
});

test("with no agent installed, the Ask window says Avanzel needs one, and the fix is Open Settings", async () => {
  const bin = mkdtempSync(path.join(tmpdir(), "avz-e2e-bin-")); // an empty folder: no agent at all
  const { app } = await libraryOn("auto", bin);
  const { ask } = await askIn(app, "What are my goals?");
  const notice = ask.getByRole("alert");
  await expect(notice).toContainText("Avanzel needs an AI agent to answer.", { timeout: 60_000 });
  // Nothing ran, so nothing is said of the library.
  await expect(notice.getByText("Claude Code works best, and Settings → Agents has its install command.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button")).toHaveText(["Open Settings"]);
  await expect(notice.getByRole("button", { name: "Open Settings" })).toHaveAttribute("data-variant", "primary");
  await app.close();
});

test("Stop gives up the question being answered, and the field is free for the next", async () => {
  const library = await makeLibrary();
  const record = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_DELAY_MS: "60000", FAKE_AGENT_RECORD: record });
  await call(app, "openAsk");
  // Main's answers to the window's questions, counted as each one settles: the window's bridge is frozen, so they are
  // counted where they are made. The test then knows when the stopped question's answer has come back.
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: { ask(question: string): Promise<unknown>; settledForTests: number } }).__avanzel;
    const ask = controller.ask.bind(controller);
    controller.settledForTests = 0;
    controller.ask = (question) => ask(question).finally(() => void (controller.settledForTests += 1));
  });
  const settled = () => app.evaluate(() => (globalThis as unknown as { __avanzel: { settledForTests: number } }).__avanzel.settledForTests);
  const ask = await windowFor(app, "ask");
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill("What are my goals?");
  await field.press("Enter");
  // The turn's status region says the agent has started. Past 10 s the line counts its seconds outside that region, so
  // VoiceOver isn't read each one.
  await expect(ask.getByRole("status")).toHaveText("Looking through your library…");
  const counting = ask.getByText(/^Looking through your library: \d+ s$/);
  await expect(counting).toBeVisible({ timeout: 20_000 });
  expect(await counting.evaluate((el) => el.closest('[role="status"],[aria-live]')?.tagName ?? null)).toBeNull();
  await expect(ask.getByRole("status")).toHaveText("");
  // The way out: a quiet Stop, which stops the question's agent.
  await expect.poll(() => exists(path.dirname(record), "runs.jsonl"), { timeout: 30_000 }).toBe(true);
  const { pid } = JSON.parse(readFileSync(record, "utf8").trim().split("\n")[0]!) as { pid: number };
  const stop = ask.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toHaveAttribute("data-variant", "quiet");
  await stop.click();
  await expect(ask.getByRole("status")).toHaveText("Stopped.");
  await expect(stop).toHaveCount(0);
  await expect(counting).toHaveCount(0);
  await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  // Main's answer to the stopped question has come back, and the window has had it: it took nothing's place. The turn
  // still says "Stopped.", and nothing says it failed.
  await expect.poll(settled, { timeout: 10_000 }).toBe(1);
  await ask.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200))); // the reply, sent as main settled, is in
  await expect(ask.getByRole("status")).toHaveText("Stopped.");
  await expect(ask.getByRole("alert")).toHaveCount(0);
  // The field is free: it has the focus, and the next question is asked at once.
  await expect(field).toBeEnabled();
  await expect(field).toBeFocused();
  await field.fill("What are my ideas?");
  await field.press("Enter");
  await expect(ask.getByRole("heading")).toHaveText(["What are my ideas?", "What are my goals?"]);
  await expect(stop).toBeVisible();
  // What main sent back for the stopped question took nothing's place: the turn still says "Stopped.", and no failure.
  await expect(ask.getByText("Stopped.", { exact: true })).toBeVisible();
  await expect(ask.getByRole("alert")).toHaveCount(0);
  await app.close();
});

test("Stop is heard from the Ask window alone: another window's page gives up no question", async () => {
  const library = await makeLibrary();
  const record = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_DELAY_MS: "60000", FAKE_AGENT_RECORD: record });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const field = ask.getByRole("textbox", { name: "Ask your library" });
  await field.fill("What are my goals?");
  await field.press("Enter");
  await expect.poll(() => exists(path.dirname(record), "runs.jsonl"), { timeout: 30_000 }).toBe(true);
  const { pid } = JSON.parse(readFileSync(record, "utf8").trim().split("\n")[0]!) as { pid: number };
  const stop = ask.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  // Every window has the same bridge, so Quick's page can send ask:cancel (the panel's is heard: Ask is in its Library too). A page's
  // messages reach main in the order they were sent: the answer to the call after it comes once main has handled the cancel.
  await call(app, "openQuick");
  const other = await windowFor(app, "quick");
  await other.evaluate(async () => {
    window.avanzel.ask.cancel();
    await window.avanzel.settings.get().catch(() => null);
  });
  // Had it been heard, the question's agent would be gone by now (the Stop below ends it in well under this time).
  await other.waitForTimeout(1_500);
  expect(alive(pid)).toBe(true);
  await expect(stop).toBeVisible();
  await expect(ask.getByRole("status")).not.toHaveText("Stopped.");
  // The Ask window's own Stop is heard.
  await stop.click();
  await expect(ask.getByRole("status")).toHaveText("Stopped.");
  await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  await app.close();
});

test("Open Settings in the Ask window leaves a recording and a note being edited as they are", async () => {
  const library = await makeLibrary();
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Remember to email Mark the hygienic plan",
    FAKE_AGENT_DELAY_MS: "60000", // the filing is still under way, with Edit on its card
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  // What the Ask window's Open Settings sends, when the library's agent isn't installed: the capsule's own call, for Agents.
  const openAgents = () => ask.evaluate(() => window.avanzel.capsule.openSettingsFor("open-settings:agents"));
  const agents = (settings: Page) => toolbarItem(settings, "Agents");

  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await openAgents();
  const settings = await windowFor(app, "panel");
  await expect(agents(settings)).toHaveAttribute("aria-selected", "true");
  expect(await capsuleKind(app)).toBe("listening"); // the recording goes on
  await expect(capsule.getByRole("status").getByRole("radio", { name: "Now", exact: true })).toHaveAttribute("aria-checked", "true");

  // The words are filed, and Edit opens the box: Open Settings leaves it open, with what is typed in it.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await capsule.getByRole("button", { name: "Edit" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("editing");
  await capsule.getByRole("textbox").fill("Remember to email Mark the agentic plan");
  await expect.poll(() => call(app, "draftForTests")).toBe("Remember to email Mark the agentic plan");
  await toolbarItem(settings, "General").click(); // so that the second Open Settings has somewhere to go
  await expect(agents(settings)).toHaveAttribute("aria-selected", "false");
  await openAgents();
  await expect(agents(settings)).toHaveAttribute("aria-selected", "true");
  expect(await capsuleKind(app)).toBe("editing");
  await expect(capsule.getByRole("textbox")).toHaveValue("Remember to email Mark the agentic plan");
  await app.close();
});

test("Open Settings still takes away the capsule's error card and its notice of a taken shortcut, whose button it is", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const capsule = await windowFor(app, "capsule");
  await call(app, "setCapsule", { kind: "error", message: "Claude Code isn't installed on this Mac any more.", detail: "Your note is safe in the inbox.", action: "open-settings:agents" });
  expect(await capsuleKind(app)).toBe("error");
  // The card names no label for its button, so it says Open Settings; the page sends the action the state names.
  await expectProblem(capsule, { title: "Claude Code isn't installed on this Mac any more.", lines: ["Your note is safe in the inbox."], fix: "Open Settings" });
  await call(app, "openSettingsFor", "open-settings:agents");
  expect(await capsuleKind(app)).toBe("hidden");
  await call(app, "setCapsule", { kind: "shortcut-taken", key: "dictate", accelerator: "Alt+Space", holder: null, alternatives: [] });
  expect(await capsuleKind(app)).toBe("shortcut-taken");
  await call(app, "openSettingsFor", "open-settings:general");
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("Esc closes Ask from anywhere in it", async () => {
  const library = await makeLibrary();
  writeFileSync(path.join(library, "goals", "run-a-marathon.md"), "# Run a marathon\n");
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await ask.getByRole("textbox", { name: "Ask your library" }).fill("What about [[run-a-marathon]]?");
  await ask.getByRole("textbox", { name: "Ask your library" }).press("Enter");
  const page = ask.getByRole("button", { name: "Run a marathon", exact: true });
  await expect(page).toBeVisible({ timeout: 60_000 });
  // The focus is on a page's button, not in the field: Esc closes the window all the same.
  await page.focus();
  await expect(page).toBeFocused();
  const closed = ask.waitForEvent("close");
  await page.press("Escape").catch(() => undefined); // closes the Ask window, before the key press returns
  await closed;
  // Closing it again, as a second Esc may, does nothing: the window is gone.
  await call(app, "closeAsk");
  await app.close();
});

test("asking while a note is being filed says it is waiting, then answers", async () => {
  const library = await makeLibrary();
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n");
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Book the dentist for Friday",
    FAKE_AGENT_DELAY_MS: "4000", // the filing keeps the library busy long enough to ask meanwhile
  });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const question = ask.getByRole("textbox", { name: "Ask your library" });
  await question.fill("What are my goals?"); // typed ahead: Enter is all it takes once the note is being filed
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000, intervals: [50] }).toBe("filing");
  await question.press("Enter");
  // It waits for whatever Avanzel is doing with the library, which it doesn't name: a filing here, but a review or a
  // stopped question letting go would hold the library as well.
  const waiting = ask.getByText("Waiting for Avanzel to finish with your library…", { exact: true });
  await expect(waiting).toBeVisible();
  await snap(ask, "9-ask-waiting");
  // The filing ends and the question has the library: the row stops saying it waits and says what the agent is doing.
  await expect(ask.getByText("Looking through your library…")).toBeVisible({ timeout: 15_000 });
  await expect(waiting).toBeHidden();
  await expect(ask.getByText("Q: What are my goals?")).toBeVisible({ timeout: 60_000 });
  expect(inbox(library)).toEqual([]); // the filing finished, undisturbed
  expect(archived(library)).toHaveLength(1);
  await app.close();
});

test("a note dictated while a question is answered says it waits for the library, then is filed", async () => {
  const library = await makeLibrary();
  writeFileSync(path.join(library, "goals", "run.md"), "# Run a marathon\n");
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Book the dentist for Friday",
    FAKE_AGENT_DELAY_MS: "4000", // the question holds the library long enough to dictate meanwhile, and the filing takes as long
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await ask.getByRole("textbox", { name: "Ask your library" }).fill("What are my goals?");
  await ask.getByRole("textbox", { name: "Ask your library" }).press("Enter");
  await expect.poll(() => exists(library, ".avanzel/lock.d")).toBe(true); // the question has the library
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  const waiting = capsule.getByText("Waiting for another Avanzel run to finish…");
  await expect(waiting).toBeVisible({ timeout: 30_000 });
  await snap(capsule, "2-filing-waiting");
  // The card's foot says why, outside its live region, whose chip says only "Waiting to file"; the card has no seconds to count meanwhile:
  // its foot's line starts with how the words were made, not with a count ("6 s of about 15 · "), though that line ends in seconds of its own.
  const card = capsule.getByRole("article");
  await expect(card.getByText("Waiting for another Avanzel run to finish…")).toBeVisible();
  await expect(card.getByRole("status")).toHaveText("Waiting to file");
  await expect(barOf(capsule)).toHaveCount(0);
  await expect(card.getByText(/^Transcribed on this Mac in \d+\.\d s$/)).toBeVisible();
  await expect(capsule.getByText(/^\d+ s( of about \d+)?( · |$)/)).toHaveCount(0);
  // The question is answered and the filing has the library: the line goes while the card still says it files.
  await expect(ask.getByText("Q: What are my goals?")).toBeVisible({ timeout: 60_000 });
  await expect(waiting).toBeHidden();
  expect(await capsuleKind(app)).toBe("filing");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("closing the Ask window gives up its question, so a note waiting behind it is filed at once", async () => {
  const library = await makeLibrary();
  const record = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-runs-")), "runs.jsonl");
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Book the dentist for Friday",
    FAKE_AGENT_DELAY_MS: "60000", // the question would keep the library for a minute,
    FAKE_AGENT_DELAY_TASK: "ask", // the filing takes no time
    FAKE_AGENT_RECORD: record,
  });
  const capsule = await windowFor(app, "capsule");
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  const question = ask.getByRole("textbox", { name: "Ask your library" });
  await question.fill("What are my goals?");
  await question.press("Enter");
  await expect.poll(() => exists(path.dirname(record), "runs.jsonl"), { timeout: 30_000 }).toBe(true); // its agent runs: it has the library
  const { pid } = JSON.parse(readFileSync(record, "utf8").trim().split("\n")[0]!) as { pid: number };
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect(capsule.getByText("Waiting for another Avanzel run to finish…")).toBeVisible({ timeout: 30_000 });
  const closed = ask.waitForEvent("close");
  await question.press("Escape").catch(() => undefined); // closes the Ask window, before the key press returns
  await closed;
  await expect.poll(() => capsuleKind(app), { timeout: 15_000 }).toBe("filed");
  expect(alive(pid)).toBe(false); // the question's agent was stopped
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a thought saved for the evening review says when that review runs, and promises none while it is off", async () => {
  const library = await makeLibrary();
  // This library's evening review runs at a time of its own.
  const review = path.join(library, "tasks", "evening-review.md");
  writeFileSync(review, readFileSync(review, "utf8").replace("schedule: daily 21:00", "schedule: daily 20:30"));
  const app = await launch({ AVANZEL_LIBRARY: library });
  const card = (await windowFor(app, "capsule")).getByRole("article");
  await call(app, "setApp", { fileMode: "evening" });
  await call(app, "submitQuick", "first thought");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", note: "Saved to the inbox for the evening review at 20:30." });
  await expect(card.getByText("first thought", { exact: true })).toBeVisible();
  await expect(card.getByText("Saved to the inbox for the evening review at 20:30.", { exact: true })).toBeVisible();
  // With the review off nothing files the thought by itself: the capsule says only where it is.
  writeFileSync(review, readFileSync(review, "utf8").replace("enabled: true", "enabled: false"));
  await call(app, "submitQuick", "second thought");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", note: "Saved to the inbox." });
  await expect(card.getByText("second thought", { exact: true })).toBeVisible();
  await expect(card.getByText("Saved to the inbox.", { exact: true })).toBeVisible();
  await expect(card.getByText(/evening review/)).toHaveCount(0);
  expect(inbox(library)).toHaveLength(2);
  await app.close();
});

test("the evening review files the inbox and writes a digest", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "setApp", { fileMode: "evening" });
  await call(app, "submitQuick", "first thought");
  await call(app, "submitQuick", "second thought");
  await expect.poll(() => inbox(library).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await call(app, "runTask", "evening-review");
  await expect.poll(async () => { await call(app, "idleForTests"); return inbox(library).length; }, { timeout: 60_000 }).toBe(0);
  const reviews = readdirSync(path.join(library, "reviews")).filter((n) => n.endsWith("-evening.md"));
  expect(reviews).toHaveLength(1);
  expect(read(library, `reviews/${reviews[0]}`)).toContain("# Evening review");
  await app.close();
});

test("an evening review that comes due with nothing to file says so", async () => {
  const library = await makeLibrary();
  // Last checked two days ago (as an older build kept it in the library; carried over at launch): due at once.
  const checked = new Date(Date.now() - 2 * 86_400_000).toISOString();
  writeFileSync(path.join(library, ".avanzel", "state.json"), JSON.stringify({ checked: { "evening-review": checked }, ran: {} }));
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toContainEqual({ title: "Evening review", body: "Inbox was empty." });
  await app.close();
});

test("an evening review that files nothing says why", async () => {
  const library = await makeLibrary();
  const dir = mkdtempSync(path.join(tmpdir(), "avz-e2e-agent-"));
  const agent = path.join(dir, "agent");
  // Picked (it is executable), but its interpreter is not, so it cannot start: running it is refused. An agent that is
  // missing altogether is a different failure, which rejects the review.
  writeFileSync(path.join(dir, "interpreter"), "not a program\n", { mode: 0o644 });
  writeFileSync(agent, `#!${path.join(dir, "interpreter")}\n`, { mode: 0o755 });
  saveSettings(library, { ...loadSettings(library), harnesses: { fake: { name: "fake", headless: [agent, "{prompt}"], interactive: [] } } });
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "setApp", { fileMode: "evening" });
  await call(app, "submitQuick", "first thought");
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toContainEqual({
    title: "Evening review: 0 thoughts filed",
    body: expect.stringContaining(`Could not start \`${agent}\``),
  });
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("the evening review transcribes a recording dropped into the inbox, with nothing dictated since launch", async () => {
  const library = await makeLibrary();
  copyFileSync(speechWav("Buy a new bicycle helmet before the summer trip."), path.join(library, "inbox", "Voice Memo 12.wav"));
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  const reviews = readdirSync(path.join(library, "reviews")).filter((n) => n.endsWith("-evening.md"));
  expect(read(library, `reviews/${reviews[0]}`)).toContain("Filed 1 of 1 capture.");
  expect(inbox(library)).toEqual([]);
  const [capture] = archived(library);
  expect(readFileSync(capture!, "utf8")).toContain("source: audio");
  expect(readFileSync(capture!, "utf8")).toMatch(/bicycle helmet/i);
  await app.close();
});

test("the speech engine that other [voice] settings or another library replace is released", async () => {
  const library = await makeLibrary();
  const other = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "capsuleStateForTests"); // the controller is up
  // The controller keeps its engine in its speech cache (`TranscriberCache`). A cache of the same kind stands in for it, whose engines
  // note their release, named in the order the cache makes them.
  const releasedAfter = await app.evaluate(async (_electron, otherLibrary) => {
    type Engine = { engine: string; transcribe(): Promise<unknown>; release(): Promise<void> };
    type Cache = { for(voice: object): Promise<unknown> };
    const controller = (globalThis as unknown as {
      __avanzel: { speech: Cache; transcriberFor(voice: object): Promise<unknown>; openLibrary(root: string): void };
    }).__avanzel;
    const released: string[] = [];
    const noting = (engine: string): Engine => ({ engine, transcribe: async () => ({ text: "", engine, seconds: 0 }), release: async () => void released.push(engine) });
    const names = ["old settings", "old library", "other library"];
    const TranscriberCache = controller.speech.constructor as new (make: () => Promise<Engine>) => Cache;
    controller.speech = new TranscriberCache(async () => noting(names.shift() ?? "more"));
    const voice = { backend: "command", model: "", quantization: "", command: ["true"], maxRecordSeconds: 600, dictionary: [], dictionarySoundAlike: false };
    const steps: string[][] = [];
    await controller.transcriberFor({ ...voice, command: ["false"] }); // the engine of the settings before
    await controller.transcriberFor(voice); // other [voice] settings
    steps.push([...released]);
    await controller.transcriberFor({ ...voice, dictionary: ["Kowalczyk"] }); // the same settings again, with only the dictionary changed
    steps.push([...released]);
    controller.openLibrary(otherLibrary); // another library
    steps.push([...released]);
    return steps;
  }, other);
  expect(releasedAfter).toEqual([["old settings"], ["old settings"], ["old settings", "old library"]]);
  await app.close();
});

// ---- A capture's file mode, and the hint of the first ten recordings ----
//
// What the switch does is told at the controller's `toggleFileMode`. Most of these press it as the bar's button does: through the
// capsule page's bridge, `window.avanzel.capsule.toggleFileMode()`, which `call()` can't do, since the channel answers only the
// page that sends it. The tests of the listening card itself click the button.

/**
 * The file mode's switch, pressed on `page` as the capsule's button will press it. A page's messages reach main in the order they
 * were sent, so the call after the press is answered once main has heard it: this returns when the press has taken effect.
 */
const toggleFileMode = (page: Page) =>
  page.evaluate(async () => {
    window.avanzel.capsule.toggleFileMode();
    await window.avanzel.settings.get();
  });

const newUserData = () => mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));

/** A launch that hears "Plant tulips in October" and files with the engine's fake agent, its data kept in `userData`; `env` adds to it. */
async function launchHearing(library: string, userData: string, env: Record<string, string> = {}) {
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    AVANZEL_FAKE_AUDIO: speechWav("hello"),
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
    ...env,
  });
  return { app, capsule: await windowFor(app, "capsule") };
}

/** Starts a recording as the menu's Record a thought does, and waits until the capsule listens. */
async function startListening(app: ElectronApplication): Promise<void> {
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
}

/** Makes `userData` the data folder of an app that has kept `kept` recordings already. */
const keptAlready = (userData: string, kept: number) =>
  writeFileSync(path.join(userData, "captures.json"), JSON.stringify({ version: 1, kept }));

/** A recording too short to hold speech: 0.1 s, under the 0.3 s Avanzel doesn't try to transcribe. */
function blip(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-audio-")), "blip.wav");
  writeWav(file, new Float32Array(1600));
  return file;
}

/** The screen comment's launch variables: a screenshot to take, and the app it is of. */
const screenOf = () => ({
  AVANZEL_FAKE_SCREEN: screenshotFixture(),
  AVANZEL_FAKE_FRONT_APP: "Safari|Growing basil|https://example.com/basil",
});

test("a capture switched to tonight while it listens is saved for the evening review, and the next one starts at the setting again", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchHearing(library, newUserData());
  await startListening(app);
  // It starts as the setting says, which for a new library is to file now.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", mode: "dictate", fileMode: "now", hint: "Alt+Space" });
  await toggleFileMode(capsule);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", fileMode: "evening", hint: "Alt+Space" });
  // The stop uses this capture's mode: it is saved for the evening review at 21:00, and nothing is filed.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({
    text: "Plant tulips in October",
    note: "Saved to the inbox for the evening review at 21:00.",
  });
  await call(app, "idleForTests");
  expect(inbox(library)).toHaveLength(1);
  expect(archived(library)).toEqual([]);
  expect(filesUnder(library, "ideas")).toEqual([]);
  // The switch was this capture's alone: the setting is as it was, and the next capture starts from it.
  expect(((await call(app, "snapshot")) as SettingsSnapshot).app.fileMode).toBe("now");
  await startListening(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", fileMode: "now" });
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(archived(library)).toHaveLength(1);
  expect(inbox(library)).toHaveLength(1); // the first one still waits for the evening
  await app.close();
});

test("a capture switched to now while the setting is tonight is filed, each press flips the mode, and the next capture starts at tonight", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchHearing(library, newUserData());
  await call(app, "setApp", { fileMode: "evening" });
  await startListening(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ fileMode: "evening" });
  for (const mode of ["now", "evening", "now"]) {
    await toggleFileMode(capsule);
    expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", fileMode: mode });
  }
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(inbox(library)).toEqual([]);
  expect(archived(library)).toHaveLength(1);
  // The setting stayed on tonight, so the next capture is saved for it.
  expect(((await call(app, "snapshot")) as SettingsSnapshot).app.fileMode).toBe("evening");
  await startListening(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", fileMode: "evening" });
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("a screen comment has no file mode to switch, and the key that finishes it is the capture shortcut", async () => {
  const library = await makeLibrary();
  const userData = newUserData();
  const { app, capsule } = await launchHearing(library, userData, screenOf());
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  // A screen comment is always saved, so there is nothing to switch; and Capture screen's shortcut finishes it, not Record a thought's.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ mode: "comment", fileMode: null, hint: "Alt+Shift+S" });
  await toggleFileMode(capsule);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ mode: "comment", fileMode: null });
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  expect(inbox(library)).toHaveLength(1);
  expect(capturesKept(userData)).toBe(1); // a kept recording like any other
  await app.close();
});

// ---- One bar, and the cards' own regions ----
//
// The bar's live region serves a recording while it has one: from listening through transcribing the page keeps ONE bar mounted, so each
// change is a change of what the region holds, which a screen reader hears. A filing and its end have no bar: they are cards, and each says
// its news from the card's own `status` region (the filing card's chip, "Filing with …", and the filed card's first foot line, "Filed by …").
// The tests tag the bar's node in the page and ask, at every change the page makes, how many live regions there are and whether the first
// is still that node.

/** What the page has: the live regions in it, and whether the first is the node that was tagged. */
type Regions = { regions: number; same: boolean; text: string };

/** Tags the page's live region now, and from now on notes every change of the page (`regionsSeen`): how many live regions stand, and whether the first is the tagged one. */
const tagBar = (page: Page) =>
  page.evaluate(() => {
    const tagged = document.querySelector('[role="status"]');
    if (!tagged) throw new Error("There is no bar to tag.");
    const seen: Regions[] = [];
    Object.assign(window, { taggedBar: tagged, regionsSeen: seen });
    const note = () => {
      const all = document.querySelectorAll('[role="status"]');
      seen.push({ regions: all.length, same: all[0] === tagged, text: all[0]?.textContent ?? "" });
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });

const regionsSeen = (page: Page) => page.evaluate(() => (window as unknown as { regionsSeen: Regions[] }).regionsSeen);

/** Whether the page's live regions are one, and the tagged node. */
const isTheTaggedBar = (page: Page) =>
  page.evaluate(() => {
    const all = document.querySelectorAll('[role="status"]');
    return { regions: all.length, same: all[0] === (window as unknown as { taggedBar: Element }).taggedBar };
  });

test("one bar serves a dictation while it listens and is transcribed, and the filing and filed cards each say their news from their own region", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchHearing(library, newUserData(), { FAKE_AGENT_DELAY_MS: "1500" }); // the filing card stays long enough to be seen
  await startListening(app);
  await expect(barOf(capsule)).toHaveCount(1);
  await tagBar(capsule);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  await expect(capsule.getByRole("article").getByRole("status").getByText(/^Filed by fake in \d+ s$/)).toBeVisible();
  await expect(barOf(capsule)).toHaveCount(0); // the filed card has no bar
  // At every change the page made, one live region stood. Until the filing card came it was the node that listening began with: a region
  // that is drawn again for each state would arrive with its line already in it, which a screen reader often does not read.
  const seen = await regionsSeen(capsule);
  expect(seen.length).toBeGreaterThan(3);
  expect(seen.filter((one) => one.regions !== 1)).toEqual([]);
  const filing = seen.findIndex((one) => one.text.includes("Filing with fake"));
  expect(filing).toBeGreaterThan(0);
  expect(seen.slice(0, filing).filter((one) => !one.same)).toEqual([]);
  // From there the region is the card's own, not the bar's: the filing card's chip, then the filed card's line.
  expect(seen.slice(filing).filter((one) => one.same)).toEqual([]);
  expect(seen.slice(filing).some((one) => /^Filed by fake in \d+ s$/.test(one.text))).toBe(true);
  expect(await isTheTaggedBar(capsule)).toEqual({ regions: 1, same: false });
  await app.close();
});

/** The states the capsule draws a card with its own live region for, and no bar, each with the line that region says. */
const CARD_STATES: [string, Record<string, unknown>, string][] = [
  [
    "filing",
    { kind: "filing", text: "Plant tulips in October", agent: "Claude Code", transcribedIn: 1.4, onThisMac: true, canEdit: true, rows: [], startedAt: Date.now(), estimate: 15, stepAt: Date.now() },
    "Filing with Claude Code",
  ],
  [
    "filing, waiting",
    { kind: "filing", text: "Plant tulips in October", agent: "Claude Code", transcribedIn: 1.4, onThisMac: true, canEdit: true, waiting: true, rows: [], startedAt: Date.now(), estimate: 15, stepAt: Date.now() },
    "Waiting to file",
  ],
  ["filed", { kind: "filed", text: "Plant tulips in October", agent: "Claude Code", seconds: 6, pages: [], canUndo: true, noted: false }, "Filed by Claude Code in 6 s"],
  ["nothing new", { kind: "filed", text: "Plant tulips in October", agent: "Claude Code", seconds: 6, pages: [], canUndo: false, noted: true }, "No note was made. Claude Code noted it in the log."],
  [
    "a reprint",
    {
      kind: "filed",
      text: "Plant tulips in October",
      agent: "Claude Code",
      seconds: 7,
      pages: [],
      canUndo: true,
      noted: false,
      reprint: { filedAt: new Date(2026, 9, 25, 12).getTime() },
    },
    "Filed by Claude Code in 7 s",
  ],
  [
    "a filed card whose words were kept",
    { kind: "filed", text: "Plant tulips in October", agent: "Claude Code", seconds: 8, pages: [], canUndo: true, noted: false, restored: true },
    "Filed by Claude Code in 8 s",
  ],
];

/** The states the capsule draws a bar for, as main sends them, each with the line its bar says (or the button it holds, where it has no line). */
const BAR_STATES: [string, Record<string, unknown>, string][] = [
  ["listening", { kind: "listening", mode: "dictate", startedAt: Date.now(), fakeMic: true, microphoneId: null, fileMode: "now", review: "at 21:00", hint: null }, "21:00"],
  ["transcribing", { kind: "transcribing", mode: "dictate", onThisMac: true }, "Transcribing on this Mac…"],
  ["a slow transcription", { kind: "transcribing", mode: "dictate", onThisMac: true, slow: true }, "Still transcribing…"],
  ["saved", { kind: "saved", text: "Plant tulips in October", note: "Saved to the inbox." }, "Saved"],
  ["undone", { kind: "saved", text: "Plant tulips in October", note: "Your words are back in the inbox.", undone: true }, "Undone"],
  ["a stopped filing", { kind: "cancelled", text: "Plant tulips in October", agent: "Claude Code", partial: false, leftovers: 0, review: "at 21:00" }, "Stopped"],
  ["a stopped transcription", { kind: "recorded", review: "at 21:00" }, "Stopped"],
  ["a picked shortcut", { kind: "shortcut-picked", key: "dictate", accelerator: "Control+Shift+Space" }, "Record a thought now uses ⌃⇧Space"],
  ["nothing to undo", { kind: "nothing-to-undo" }, "There's no filing to undo."],
];

test("every state that has a bar draws it in the one live region; the filing and filed cards speak from their own, and the editor and a problem have none", async () => {
  const { app, capsule } = await launchOn(await makeLibrary());
  const bar = capsule.getByRole("status");
  let tagged = false;
  for (const [name, state, says] of BAR_STATES) {
    await call(app, "setCapsule", state);
    await expect(bar.getByText(says, { exact: true }), name).toBeVisible();
    if (!tagged) {
      await tagBar(capsule); // the first state's bar: the others must be this one
      tagged = true;
    }
    expect(await isTheTaggedBar(capsule), name).toEqual({ regions: 1, same: true });
  }
  // A filing and a filed card have no bar: their one live region is on the card, and says the card's news.
  for (const [name, state, says] of CARD_STATES) {
    await call(app, "setCapsule", state);
    await expect(capsule.getByRole("article").getByRole("status"), name).toHaveText(says);
    await expect(barOf(capsule), name).toHaveCount(0);
    await expect(bar, name).toHaveCount(1);
  }
  // The editor is only a card, and a problem is an alert: neither has a bar, so neither has a live region.
  await call(app, "setCapsule", { kind: "editing", text: "Plant tulips in October" });
  await expect(capsule.getByText("Edit before filing", { exact: true })).toBeVisible();
  await expect(bar).toHaveCount(0);
  await call(app, "setCapsule", { kind: "error", message: "Avanzel couldn't capture the screen.", detail: "Nothing was saved." });
  await expect(capsule.getByRole("alert")).toBeVisible();
  await expect(bar).toHaveCount(0);
  await app.close();
});

// ---- The listening card: a bar whose one button is the file mode, with the hint above it ----

test("a dictation listens on a bar with its file mode, Cancel, Pause and Stop, and the first recordings' hint names the keys", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchHearing(library, newUserData());
  await startListening(app);
  await capsuleAtRest(capsule); // measured at rest: the capsule rises in, and grows from 96 %
  await snap(capsule, "1-listening-bar");
  // The bar is the card's one live region, with Zel listening. It has no line: its time and its controls are all it holds. When the
  // recording is filed is a choice of two, ✦ now or ☾ at the review; then Cancel, Pause and Stop, which wears the chosen sign.
  const bar = capsule.getByRole("status");
  await expect(capsule.locator("svg[data-mood]")).toHaveAttribute("data-mood", "listening");
  await expect(bar.getByText(/^\d:\d\d$/)).toBeVisible();
  const choice = bar.getByRole("radiogroup", { name: "When your agent files this recording" });
  const now = choice.getByRole("radio", { name: "Now", exact: true });
  const atTheReview = choice.getByRole("radio", { name: "21:00", exact: true });
  await expect(now).toHaveAttribute("aria-checked", "true");
  await expect(atTheReview).toHaveAttribute("aria-checked", "false");
  await expect(capsule.getByRole("button")).toHaveCount(4);
  // Add first: a file, a screenshot or a video to go with the note, in the menu it opens over the bar.
  await expect(bar.getByRole("button", { name: "Add a file, a screenshot or a video", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Cancel the recording", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Stop, and your agent files it now", exact: true })).toBeVisible();
  // Every control sits inside the bar's glass, and the bar inside the panel: nothing spills past either edge.
  const glass = (await bar.boundingBox())!;
  const width = await capsule.evaluate(() => innerWidth);
  expect(glass.x).toBeGreaterThanOrEqual(0);
  expect(glass.x + glass.width).toBeLessThanOrEqual(width);
  for (const control of [...(await bar.getByRole("button").all()), bar.getByRole("radiogroup")]) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(glass.x);
    expect(box.x + box.width).toBeLessThanOrEqual(glass.x + glass.width);
  }
  // The hint above it is one sentence of plain text, with the keys as keys, outside the live region.
  await expect(capsule.getByText("⌥Space to finish, Esc to cancel", { exact: true })).toBeVisible();
  await expect(capsule.locator("kbd")).toHaveText(["⌥Space", "Esc"]);
  await expect(bar.locator("kbd")).toHaveCount(0);
  // The recording has run a few seconds by the time the button is pressed: the time then shows that it isn't started over by a press.
  const { startedAt } = (await call(app, "capsuleStateForTests")) as { startedAt: number };
  await expect.poll(() => Date.now() - startedAt, { timeout: 10_000, intervals: [250] }).toBeGreaterThan(3_000);
  // Choosing the review switches this capture to it, named by when it files (this library's runs daily at 21:00); the hint stays.
  // Choosing the one already chosen changes nothing.
  await atTheReview.click();
  await expect(atTheReview).toHaveAttribute("aria-checked", "true");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", fileMode: "evening", hint: "Alt+Space", review: "at 21:00" });
  await atTheReview.click();
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", fileMode: "evening" });
  await expect(capsule.getByText("⌥Space to finish, Esc to cancel", { exact: true })).toBeVisible();
  await now.click();
  await expect(now).toHaveAttribute("aria-checked", "true");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", fileMode: "now" });
  // Stopped as it reads, the capture goes the way the switch said: to the evening review, and nothing is filed.
  await atTheReview.click();
  await expect(atTheReview).toHaveAttribute("aria-checked", "true");
  await expect(bar.getByRole("button", { name: "Stop, and file it at the evening review at 21:00", exact: true })).toBeVisible();
  // The time is the recording's own, counted from the state's `startedAt`, which no press moved: it reads what has gone since then
  // (a second or so behind, as it counts in whole seconds), not what has gone since the last press, which is under a second.
  expect(((await call(app, "capsuleStateForTests")) as { startedAt: number }).startedAt).toBe(startedAt);
  const shown = (await bar.getByText(/^\d:\d\d$/).innerText()).split(":").reduce((minutes, seconds) => minutes * 60 + Number(seconds), 0);
  const elapsed = (Date.now() - startedAt) / 1000;
  expect(shown).toBeLessThanOrEqual(elapsed);
  expect(shown).toBeGreaterThanOrEqual(elapsed - 2);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ note: "Saved to the inbox for the evening review at 21:00." });
  expect(archived(library)).toEqual([]);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

test("the capsule's corners around its panel catch no pointer: only what is drawn takes it, and gives it back", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchHearing(library, newUserData());
  await startListening(app);
  await capsuleAtRest(capsule); // measured at rest: the capsule rises in, and grows from 96 %
  const panel = (await capsule.locator(".stack .av-hud").boundingBox())!;
  const bar = (await capsule.getByRole("status").boundingBox())!;
  // The first recordings' hint stands inside the panel, above its row, on the same glass.
  const hint = (await capsule.locator(".av-capsule-hint").boundingBox())!;
  expect(hint.y).toBeGreaterThanOrEqual(panel.y);
  expect(hint.y + hint.height).toBeLessThanOrEqual(bar.y);
  const beside = { x: panel.x - 8, y: panel.y + panel.height / 2 };
  const above = { x: panel.x + panel.width / 2, y: panel.y - 20 };
  const onHint = { x: hint.x + hint.width / 2, y: hint.y + hint.height / 2 };
  const onBar = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
  expect(beside.x).toBeGreaterThan(0);
  expect(above.y).toBeGreaterThan(0);
  // What is under each point to the pointer: what is drawn answers, and the rest of the window lets it through to the app below.
  const under = (at: { x: number; y: number }) =>
    capsule.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".stack"), at);
  expect(await under(onHint)).toBe(true);
  expect(await under(onBar)).toBe(true);
  expect(await under(beside)).toBe(false);
  expect(await under(above)).toBe(false);
  // The window takes the pointer, to be clicked and to keep its card up, only while it is over what is drawn.
  await app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: { setInteractive(interactive: boolean): void } }).__avanzel;
    const asked: boolean[] = [];
    Object.assign(globalThis, { interactiveAsked: asked });
    const setInteractive = controller.setInteractive.bind(controller);
    controller.setInteractive = (interactive) => {
      asked.push(interactive);
      setInteractive(interactive);
    };
  });
  const asked = () => app.evaluate(() => (globalThis as { interactiveAsked?: boolean[] }).interactiveAsked ?? []);
  // The lists below are exact, and the pointer visits both corners before the panel, so a call from either shows: a corner that had
  // caught the pointer would not give it back at the second visit to it.
  await capsule.mouse.move(beside.x, beside.y);
  await capsule.mouse.move(beside.x + 2, beside.y);
  await capsule.mouse.move(above.x, above.y);
  await capsule.mouse.move(onHint.x, onHint.y);
  await expect.poll(asked).toEqual([true]);
  await capsule.mouse.move(above.x, above.y);
  await expect.poll(asked).toEqual([true, false]);
  await capsule.mouse.move(onBar.x, onBar.y);
  await expect.poll(asked).toEqual([true, false, true]);
  await call(app, "cancelRecording");
  await app.close();
});

test("a pointer crossing the gap between a card and its bar keeps the card up, though the card's time comes while it is in the gap", async () => {
  // Crossing the 8 px between them is a leave and then an enter. The hold is let go 250 ms after a leave, and a return cancels it, so
  // a card whose time is up in that moment is not put away under the pointer.
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const capsule = await windowFor(app, "capsule");
  const TIME_MS = 2_000;
  await call(app, "setCapsule", { kind: "saved", text: "Plant tulips in October", note: "Saved to the inbox." }, TIME_MS);
  const shownAt = Date.now(); // the card's time began a moment before: the call's own round trip
  await capsuleAtRest(capsule); // the gap is measured at rest: the capsule rises in, and grows from 96 %, as the card comes up
  const card = (await capsule.getByRole("article").boundingBox())!;
  const bar = (await capsule.getByRole("status").boundingBox())!;
  const onCard = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
  const inGap = { x: card.x + card.width / 2, y: (card.y + card.height + bar.y) / 2 };
  const onBar = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
  expect(inGap.y).toBeGreaterThan(card.y + card.height);
  expect(inGap.y).toBeLessThan(bar.y);
  const until = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, shownAt + ms - Date.now())));
  await capsule.mouse.move(onCard.x, onCard.y); // the pointer holds the card
  await until(TIME_MS - 100);
  await capsule.mouse.move(inGap.x, inGap.y); // it leaves the card for the gap just before the card's time ...
  await until(TIME_MS + 50);
  await capsule.mouse.move(onBar.x, onBar.y); // ... and is on the bar just after it: the time came while the pointer was in the gap
  // The card looks again 1.5 s after its time, and finds the pointer on the bar: the let-go that the leave began was cancelled by the
  // return. Left to run, it would have fired 250 ms after the leave, and the card would go at this second look.
  await until(TIME_MS + 1_500 + 700);
  expect(await capsuleKind(app)).toBe("saved");
  // The pointer goes for good: the hold is let go, and the card goes at its next time.
  await capsule.mouse.move(0, 0);
  await expect.poll(() => capsuleKind(app), { timeout: 8_000 }).toBe("hidden");
  await app.close();
});

test("Hide, clicked with the pointer, lets go of the hold: the next card that hides itself goes at its time, though the pointer never moved", async () => {
  // To click Hide the pointer enters the card, which holds it up. The panel then hides, and a hidden panel hears no leave: the hold
  // ends as it hides, or the next card that hides itself would wait for a pointer that is gone.
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const capsule = await windowFor(app, "capsule");
  await call(app, "setCapsule", { kind: "saved", text: "Plant tulips in October", note: "Saved to the inbox." }, 60_000);
  await barOf(capsule).getByRole("button", { name: "Hide", exact: true }).click();
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  const TIME_MS = 2_000;
  await call(app, "setCapsule", { kind: "saved", text: "Call the vet on Monday", note: "Saved to the inbox." }, TIME_MS);
  const shownAt = Date.now();
  await expect.poll(() => capsuleKind(app), { timeout: 10_000, intervals: [100] }).toBe("hidden");
  // It went at its own time: a held card looks again only every 1.5 s after it, and would have gone at a later look, if ever.
  expect(Date.now() - shownAt).toBeLessThan(TIME_MS + 1_200);
  await app.close();
});

test("a screen comment listens over a card of its screenshot, labelled with the app, and has no file mode to switch", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchHearing(library, newUserData(), screenOf());
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  await snap(capsule, "6-capture-listening-card");
  // The screenshot sits on paper, as a picture with a name, under the app's name; the bar has a time and nothing to press.
  const card = capsule.getByRole("article");
  await expect(card.getByText("Safari", { exact: true })).toBeVisible();
  const shot = card.getByRole("img", { name: "Screenshot of Safari" });
  await expect(shot).toBeVisible();
  expect(await shot.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  // The card holds no words, so it has no ruling, and the picture has room above it, under the red rule, as below it.
  await expect(card).not.toHaveAttribute("data-ruled");
  const head = (await card.locator("header").boundingBox())!;
  const picture = (await shot.boundingBox())!;
  const paper = (await card.boundingBox())!;
  expect(picture.y - (head.y + head.height)).toBeGreaterThanOrEqual(7.9); // 8 px, to a rounding of the screen's pixels
  expect(paper.y + paper.height - (picture.y + picture.height)).toBeGreaterThanOrEqual(7.9);
  await expect(capsule.getByRole("status").getByText(/^\d:\d\d$/)).toBeVisible();
  // A screen comment is always saved: nothing to switch, so Cancel, Pause and Stop alone, and Stop wears no sign of when it is filed.
  await expect(capsule.getByRole("radiogroup")).toHaveCount(0);
  await expect(capsule.getByRole("button")).toHaveCount(3);
  await expect(capsule.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  // Capture screen's shortcut finishes it, not Record a thought's.
  await expect(capsule.getByText("⌥⇧S to finish, Esc to cancel", { exact: true })).toBeVisible();
  await expect(capsule.locator("kbd")).toHaveText(["⌥⇧S", "Esc"]);
  // The card, the hint and the bar all fit in the 300 px panel, the card's top edge included.
  expect((await card.boundingBox())!.y).toBeGreaterThanOrEqual(4);
  const bar = (await capsule.getByRole("status").boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(await capsule.evaluate(() => innerHeight));
  await call(app, "cancelRecording");
  await app.close();
});

test("Pause holds a recording's time and its limit, Resume goes on from there, and Cancel gives it up", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchHearing(library, newUserData());
  await startListening(app);
  const bar = capsule.getByRole("status");
  const { startedAt } = (await call(app, "capsuleStateForTests")) as { startedAt: number };
  await expect.poll(() => Date.now() - startedAt, { timeout: 10_000, intervals: [250] }).toBeGreaterThan(2_000);
  // Paused: the voice and the time stand still, dimmed, in a bar of the same size, and Pause becomes Resume.
  const wide = (await bar.boundingBox())!.width;
  await bar.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(capsule.locator(".av-capsule-time[data-paused]")).toBeVisible();
  expect((await bar.boundingBox())!.width).toBe(wide);
  const paused = (await call(app, "capsuleStateForTests")) as { kind: string; pausedAt?: number };
  expect(paused).toMatchObject({ kind: "listening" });
  expect(paused.pausedAt).toBeGreaterThan(startedAt);
  const held = await bar.getByText(/^\d:\d\d$/).innerText();
  await new Promise((r) => setTimeout(r, 2_200));
  await expect(bar.getByText(/^\d:\d\d$/)).toHaveText(held);
  // Resumed: the start moves on by the pause, so the time goes on from where it stood.
  await bar.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  const resumed = (await call(app, "capsuleStateForTests")) as { startedAt: number; pausedAt?: number };
  expect(resumed.pausedAt).toBeUndefined();
  expect(resumed.startedAt).toBeGreaterThanOrEqual(startedAt + 2_000);
  // Cancel gives it up, as Esc does: nothing is kept.
  await bar.getByRole("button", { name: "Cancel the recording", exact: true }).click();
  await expect.poll(() => capsuleKind(app)).not.toBe("listening");
  expect(inbox(library)).toHaveLength(0);
  await app.close();
});

test("a recording that learned its keys has no hint, and a dictation has no screenshot card", async () => {
  const library = await makeLibrary();
  const userData = newUserData();
  keptAlready(userData, 10);
  const { app, capsule } = await launchHearing(library, userData);
  await startListening(app);
  await expect(capsule.getByRole("status").getByRole("radio", { name: "Now", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(capsule.locator("kbd")).toHaveCount(0);
  await expect(capsule.getByRole("article")).toHaveCount(0);
  await expect(capsule.getByRole("img", { name: /^Screenshot/ })).toHaveCount(0);
  await call(app, "cancelRecording");
  await app.close();
});

test("the file mode's switch names when the evening review files the capture, and promises no review while it is off", async () => {
  const library = await makeLibrary();
  const review = path.join(library, "tasks", "evening-review.md");
  const { app, capsule } = await launchHearing(library, newUserData());
  await call(app, "setApp", { fileMode: "evening" }); // a capture starts as the setting says: here, with the evening review
  const choice = (name: string) => capsule.getByRole("status").getByRole("radio", { name, exact: true });
  // A daily review: its time ...
  await startListening(app);
  await expect(choice("21:00")).toHaveAttribute("aria-checked", "true");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ fileMode: "evening", review: "at 21:00" });
  await choice("Now").click();
  await expect(choice("Now")).toHaveAttribute("aria-checked", "true");
  await call(app, "cancelRecording");
  // ... a weekly one: its day as well, since it isn't tonight's ...
  writeFileSync(review, readFileSync(review, "utf8").replace("schedule: daily 21:00", "schedule: weekly sun 18:00"));
  await startListening(app);
  await expect(choice("Sundays 18:00")).toHaveAttribute("aria-checked", "true");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ fileMode: "evening", review: "on Sundays at 18:00" });
  await call(app, "cancelRecording");
  // ... and with the review off, nothing files the capture, so the switch says only where it stays. It still switches.
  writeFileSync(review, readFileSync(review, "utf8").replace("enabled: true", "enabled: false"));
  await startListening(app);
  await expect(choice("Inbox")).toHaveAttribute("aria-checked", "true");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ fileMode: "evening", review: null });
  await choice("Now").click();
  await expect(choice("Now")).toHaveAttribute("aria-checked", "true");
  await choice("Inbox").click();
  await expect(choice("Inbox")).toHaveAttribute("aria-checked", "true");
  // Stopped so, it is saved as the card says: in the inbox, and nothing files it by itself.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ note: "Saved to the inbox." });
  expect(inbox(library)).toHaveLength(1);
  expect(archived(library)).toEqual([]);
  await app.close();
});

test("the capsule's page is clear, so only its glass and its cards show over the desktop", async () => {
  const app = await launch({ AVANZEL_LIBRARY: await makeLibrary() });
  const capsule = await windowFor(app, "capsule");
  // base.css paints the window's surface unless the page says it is clear; the panel is see-through, and nothing is painted behind
  // the cards.
  await expect(capsule.locator("html")).toHaveAttribute("data-backdrop", "clear");
  expect(await capsule.evaluate(() => [document.documentElement, document.body].map((el) => getComputedStyle(el).backgroundColor))).toEqual([
    "rgba(0, 0, 0, 0)",
    "rgba(0, 0, 0, 0)",
  ]);
  await app.close();
});

test("the file mode's switch is heard from the capsule's page alone, and only while a capture listens", async () => {
  const library = await makeLibrary();
  const { app, capsule } = await launchHearing(library, newUserData());
  await call(app, "setApp", { fileMode: "evening" });
  // With nothing recording there is nothing to switch, and the press leaves nothing behind for the next capture.
  await toggleFileMode(capsule);
  expect(await capsuleKind(app)).toBe("hidden");
  await startListening(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ fileMode: "evening" });
  // Every window has the same bridge, so Settings' page can send capsule:toggle-file-mode; it isn't heard.
  await call(app, "showSettings");
  const settings = await windowFor(app, "panel");
  await toggleFileMode(settings);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ fileMode: "evening" });
  // A typed thought takes the card meanwhile, and the recording goes on out of sight: a press now finds no listening card to switch.
  await call(app, "submitQuick", "A thought typed meanwhile");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", text: "A thought typed meanwhile" });
  await toggleFileMode(capsule);
  // Whatever card is in front now (the saved one hides itself after 4 s), it is not a listening one and has been given no mode.
  const inFront = (await call(app, "capsuleStateForTests")) as { kind: string };
  expect(inFront.kind).not.toBe("listening");
  expect(inFront).not.toHaveProperty("fileMode");
  // The recording is still tonight's: stopped, it is saved for the evening, not filed.
  await call(app, "toggleDictate");
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 30_000 }).toMatchObject({ kind: "saved", text: "Plant tulips in October" });
  expect(inbox(library)).toHaveLength(2);
  expect(archived(library)).toEqual([]);
  await app.close();
});

test("a switch that comes after the stop is too late: the capture goes the way it was stopped", async () => {
  const library = await makeLibrary();
  const { app } = await launchHearing(library, newUserData());
  await startListening(app);
  // In one tick, so that the recording's audio cannot have arrived: the stop, then the press.
  await app.evaluate(({ BrowserWindow }) => {
    const capsule = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/capsule/"));
    if (!capsule) throw new Error("There is no capsule window.");
    const controller = (globalThis as unknown as { __avanzel: { toggleDictate(): Promise<void>; toggleFileMode(sender: unknown): void } }).__avanzel;
    void controller.toggleDictate();
    controller.toggleFileMode(capsule.webContents);
  });
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed"); // filed now, not saved for tonight
  expect(inbox(library)).toEqual([]);
  expect(archived(library)).toHaveLength(1);
  await app.close();
});

test("the card names no key for a shortcut that isn't registered", async () => {
  const library = await makeLibrary();
  const { app } = await launchHearing(library, newUserData(), {
    AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space", // another app holds Record a thought's shortcut
    ...screenOf(),
  });
  await expect.poll(() => capsuleKind(app)).toBe("shortcut-taken"); // the shortcuts have been tried by then
  // The menu still records, but there is no shortcut to finish it with.
  await startListening(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", mode: "dictate", hint: null });
  await call(app, "cancelRecording");
  // Capture screen's shortcut works, and is the key that finishes a screen comment.
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ mode: "comment", hint: "Alt+Shift+S" });
  await call(app, "cancelRecording");
  await app.close();
});

test("the first ten kept recordings name the key that finishes them, the eleventh doesn't, and a restart keeps the count", async () => {
  const library = await makeLibrary();
  const userData = newUserData();
  keptAlready(userData, 9);
  const first = await launchHearing(library, userData);
  await call(first.app, "setApp", { fileMode: "evening" }); // saved, not filed: the agent has no part in this
  // The tenth recording's card still teaches the key ...
  await startListening(first.app);
  expect(await call(first.app, "capsuleStateForTests")).toMatchObject({ kind: "listening", hint: "Alt+Space" });
  await expect(first.capsule.getByText("⌥Space to finish, Esc to cancel", { exact: true })).toBeVisible();
  await call(first.app, "toggleDictate");
  await expect.poll(() => capsuleKind(first.app), { timeout: 30_000 }).toBe("saved");
  expect(capturesKept(userData)).toBe(10);
  // ... and the eleventh's doesn't.
  await startListening(first.app);
  expect(await call(first.app, "capsuleStateForTests")).toMatchObject({ kind: "listening", hint: null });
  await expect(first.capsule.getByRole("status").getByRole("radiogroup", { name: "When your agent files this recording" })).toBeVisible(); // the bar is up
  await expect(first.capsule.locator("kbd")).toHaveCount(0);
  await call(first.app, "cancelRecording");
  await first.app.close();
  // The count is kept with the app: a new launch has taught the key enough.
  const second = await launchHearing(library, userData);
  await startListening(second.app);
  expect(await call(second.app, "capsuleStateForTests")).toMatchObject({ kind: "listening", hint: null });
  await call(second.app, "cancelRecording");
  await second.app.close();
});

test("a recording counts once the library keeps it: saved for tonight, stopped or filed, but not an Esc, and a typed thought is none", async () => {
  const library = await makeLibrary({ git: true });
  const userData = newUserData();
  // The first filing stalls, and the ones after it file.
  const { app, capsule } = await launchHearing(library, userData, { FAKE_AGENT_MODE: "slow-once", FAKE_AGENT_ONCE: onceMarker() });
  expect(capturesKept(userData)).toBe(0);
  // Saved for tonight.
  await startListening(app);
  await toggleFileMode(capsule);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  expect(capturesKept(userData)).toBe(1);
  // An Esc keeps nothing.
  await startListening(app);
  await call(app, "cancelRecording");
  expect(capturesKept(userData)).toBe(1);
  // Stopped while it is filed: its words go back to the inbox, where they were kept already. The agent is stopped mid-run (it has
  // left its marker by the time it has started goals/half.md), so that the filing after this one is not the stalling first run.
  await startListening(app);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("filing");
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  await capsule.evaluate(() => window.avanzel.capsule.cancelFiling());
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("cancelled");
  expect(capturesKept(userData)).toBe(2);
  expect(inbox(library)).toHaveLength(2);
  // Filed.
  await startListening(app);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(capturesKept(userData)).toBe(3);
  // A thought typed in Quick is no recording: it is kept and filed, and counts for nothing.
  await call(app, "submitQuick", "Call the plumber on Monday");
  expect(capturesKept(userData)).toBe(3);
  await expect.poll(() => capsuleKind(app), { timeout: 60_000 }).toBe("filed");
  expect(capturesKept(userData)).toBe(3);
  await app.close();
});

test("an Esc, a recording with no speech and one that fails keep nothing, so none of them counts", async () => {
  const library = await makeLibrary();
  const userData = newUserData();
  keptAlready(userData, 9); // the next recording the library keeps is the tenth
  const { app } = await launchHearing(library, userData, { AVANZEL_FAKE_AUDIO: blip() });
  // An Esc.
  await startListening(app);
  await call(app, "cancelRecording");
  expect(await capsuleKind(app)).toBe("hidden");
  // No speech.
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ message: "Nothing was heard." });
  // A microphone that didn't start.
  await startListening(app);
  await call(app, "micError", "Requested device not found");
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "error", message: "The microphone didn't start." });
  expect(capturesKept(userData)).toBe(9);
  expect(inbox(library)).toEqual([]);
  // So the next card still names the key: it is the tenth recording.
  await startListening(app);
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", hint: "Alt+Space" });
  await call(app, "cancelRecording");
  await app.close();
});

test("words the library can't write keep nothing, so they don't count", async () => {
  const library = await makeLibrary();
  const userData = newUserData();
  keptAlready(userData, 9);
  const { app } = await launchHearing(library, userData);
  const waiting = path.join(library, "inbox");
  chmodSync(waiting, 0o555); // no capture can be written here now
  try {
    await call(app, "toggleDictate");
    await call(app, "toggleDictate");
    await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
    expect(capturesKept(userData)).toBe(9);
  } finally {
    chmodSync(waiting, 0o755);
  }
  await app.close();
});

test("a screen capture without a comment is kept all the same, so it counts", async () => {
  const library = await makeLibrary();
  const userData = newUserData();
  keptAlready(userData, 9);
  const { app } = await launchHearing(library, userData, { AVANZEL_FAKE_AUDIO: blip(), ...screenOf() });
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 20_000 }).toBe("listening");
  await call(app, "toggleCapture");
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  // No words, but the screenshot and its note wait in the inbox.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "saved", text: "" });
  expect(inbox(library)).toHaveLength(1);
  expect(capturesKept(userData)).toBe(10);
  await app.close();
});
