import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { git, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { alive, call, capsuleKind, exists, filesUnder, launch, makeLibrary, read, recentlyFiled, screenshotFixture, snap, speechWav, windowFor } from "./helpers.ts";

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
  await expect(capsule.getByText("couldn't file this note")).toBeVisible();
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
  await snap(capsule, "7-capture-saved");
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
  const note = capsule.getByText(
    /^Only your words were kept: raw\/audio\/\d{4}\/\d{2} isn't a plain folder\. Remove the link or file on its path to keep recordings\.$/,
  );
  // A dictation: filed without its recording.
  await call(app, "toggleDictate");
  await call(app, "toggleDictate");
  await expect(note).toBeVisible({ timeout: 30_000 });
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
  expect(await recentlyFiled(app)).toEqual(["Plant tulips in October"]);
  await capsule.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("saved");
  await expect(capsule.getByText("Undone. The note is back in your inbox.")).toBeVisible();
  expect(inbox(library)).toHaveLength(1);
  expect(filesUnder(library, "ideas")).toEqual([]);
  expect(await recentlyFiled(app)).toEqual([]);
  await app.close();
});

test("an Undo git refuses says so on the card, and the edit made since stays", async () => {
  const { library, app, capsule } = await typedAndFiled();
  // Meanwhile the new page is edited by hand, and the edit committed: undoing the filing would take the edit with it.
  const [page = ""] = filesUnder(library, "ideas");
  const file = path.join(library, "ideas", page);
  writeFileSync(file, "# Tulips, by hand\n");
  expect(await git.commitAll(library, "An edit by hand")).not.toBeNull();
  await capsule.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => capsuleKind(app), { timeout: 30_000 }).toBe("error");
  await expect(capsule.getByText("Couldn't undo")).toBeVisible();
  expect(readFileSync(file, "utf8")).toBe("# Tulips, by hand\n");
  expect(inbox(library)).toEqual([]);
  // The menu's Recently filed is read again all the same: the page is there, under the title the edit gave it.
  expect(await recentlyFiled(app)).toEqual(["Tulips, by hand"]);
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
  await expect(ask.getByText("Pages used:")).toHaveCount(0);
  await snap(ask, "9-ask");
  await app.close();
});

test("an answer's links become buttons for the pages they name", async () => {
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
  await expect(ask.getByText("Pages used:", { exact: true })).toBeVisible();
  await expect(ask.getByRole("button", { name: "Run a marathon", exact: true })).toBeVisible();
  await expect(ask.getByText("Goals", { exact: true })).toBeVisible();
  await snap(ask, "9-ask-sources");
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
  // The agent ran and failed: its last lines, under the name of the agent whose run it was. There are no lines or pages to show.
  expect(await call(app, "ask", "What are my goals?")).toMatchObject({
    ok: false,
    answer: "fake couldn't answer.\nagent crashed: not logged in",
    agent: "fake",
    paragraphs: [],
    sources: [],
  });
  // Nothing ran: the engine refused the question, and its message comes back as it is.
  expect(await call(app, "ask", "   ")).toMatchObject({
    ok: false,
    answer: 'Ask a question, e.g. "what are my goals this year?"',
    agent: "fake",
    paragraphs: [],
    sources: [],
  });
  await app.close();
});

test("a failed answer says so in the window", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, FAKE_AGENT_MODE: "fail" });
  await call(app, "openAsk");
  const ask = await windowFor(app, "ask");
  await ask.getByRole("textbox", { name: "Ask your library" }).fill("What are my goals?");
  await ask.getByRole("textbox", { name: "Ask your library" }).press("Enter");
  // The Notice names the agent whose run failed, and says what that agent said last.
  const notice = ask.getByRole("alert");
  await expect(notice).toContainText("fake couldn't answer.", { timeout: 60_000 });
  await expect(notice).toContainText("agent crashed: not logged in");
  await expect(ask.getByRole("heading", { name: "What are my goals?", exact: true })).toBeVisible();
  await snap(ask, "9-ask-failed");
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
  await expect(ask.getByText("Waiting for the filing in progress to finish…")).toBeVisible();
  await snap(ask, "9-ask-waiting");
  // The filing ends and the question has the library: the row stops saying it waits and says what the agent is doing.
  await expect(ask.getByText("Looking through your library…")).toBeVisible({ timeout: 15_000 });
  await expect(ask.getByText("Waiting for the filing in progress to finish…")).toBeHidden();
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
  const agent = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-agent-")), "agent");
  writeFileSync(agent, "#!/avanzel/no/such/interpreter\n", { mode: 0o755 }); // picked (it is executable), but it cannot start
  saveSettings(library, { ...loadSettings(library), harnesses: { fake: { name: "fake", headless: [agent, "{prompt}"], interactive: [] } } });
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "setApp", { fileMode: "evening" });
  await call(app, "submitQuick", "first thought");
  await call(app, "runTask", "evening-review");
  await call(app, "idleForTests");
  expect(await call(app, "notificationsForTests")).toContainEqual({
    title: "Evening review: 0 things filed",
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

test("settings show every pane", async () => {
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "showSettings");
  const settings = await windowFor(app, "settings");
  for (const pane of ["General", "Voice", "Agents", "Shadow tasks", "Tools & MCP", "Privacy"]) {
    await settings.getByRole("button", { name: pane, exact: true }).click();
    await expect(settings.getByRole("heading", { name: pane })).toBeVisible();
    await snap(settings, `settings-${pane.toLowerCase().replace(/[^a-z]+/g, "-")}`);
  }
  await app.close();
});

test("the speech engine that other [voice] settings or another library replace is released", async () => {
  const library = await makeLibrary();
  const other = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library });
  await call(app, "capsuleStateForTests"); // the controller is up
  // Engines that note their release stand in for the controller's current one, set by hand.
  const releasedAfter = await app.evaluate(async (_electron, otherLibrary) => {
    type Engine = { engine: string; transcribe(): Promise<unknown>; release(): Promise<void> };
    const controller = (globalThis as unknown as {
      __avanzel: { transcriber: Engine | null; transcriberKey: string; transcriberFor(voice: object): Promise<Engine>; openLibrary(root: string): void };
    }).__avanzel;
    const released: string[] = [];
    const noting = (engine: string): Engine => ({ engine, transcribe: async () => ({ text: "", engine, seconds: 0 }), release: async () => void released.push(engine) });
    const voice = { backend: "command", model: "", quantization: "", command: ["true"], maxRecordSeconds: 600 };
    const steps: string[][] = [];
    controller.transcriber = noting("old settings");
    controller.transcriberKey = "{}";
    await controller.transcriberFor(voice); // other [voice] settings
    steps.push([...released]);
    controller.transcriber = noting("old library");
    await controller.transcriberFor(voice); // the same settings again
    steps.push([...released]);
    controller.openLibrary(otherLibrary); // another library
    steps.push([...released]);
    return steps;
  }, other);
  expect(releasedAfter).toEqual([["old settings"], ["old settings"], ["old settings", "old library"]]);
  await app.close();
});
