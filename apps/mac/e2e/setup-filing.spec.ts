// The setup window's Filing step: the first thought is filed in the window, step by step, and what Cancel, a sign-in and
// another failure do there. Every test launches as a first run (firstRun), taken through Found.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault, loadSettings } from "../../../packages/engine/src/index.ts";
import {
  call,
  capsuleKind,
  exists,
  filesUnder,
  filingClaude,
  firstRun,
  launch,
  limitedClaude,
  onceMarker,
  shown,
  snap,
  speechWav,
  throughFound,
  typeFirstThought,
  windowFor,
} from "./helpers.ts";
import {
  callsTo,
  closeSetup,
  CODEX_INSTALL,
  failingClaude,
  inbox,
  live,
  NUDGE,
  pressShortcut,
  reachFor,
  settingsSnap,
  setupSnap,
  tabs,
  windowsTitled,
  zel,
} from "./setup-helpers.ts";

// The same steps, as the Filing step shows them: a row each under the working line, the shelf tabs counting the pages as
// they are written, and nothing announced but the heading. The stand-in takes a second over each step, so the rows come
// while the run goes on.

/**
 * The rows the stand-in's filing of "Call the vet on Monday" shows, in the order it takes its steps. Its first read, of the
 * capture, is no row.
 */
const VET_ROWS = ["Reading your library index", "New idea page: Call the vet on Monday", "Updated your library index", "Added a line to the log"];

/**
 * A first run whose stand-in Claude Code reports its steps as Claude Code does and takes a second over each (`agent` steers
 * it further), taken through Found.
 */
async function steppedRun(agent: Record<string, string> = {}): Promise<{ app: ElectronApplication; setup: Page }> {
  const { env } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, FAKE_AGENT_STREAM: "claude", FAKE_AGENT_STEP_MS: "1000", ...agent });
  return { app, setup: await throughFound(app) };
}

/** What the setup step showed at one moment, as `watchStep` notes it. */
interface Shown {
  heading: string;
  /** The step's paragraphs in page order, each with its tone: "secondary", or null for the default ink. */
  paragraphs: { text: string; tone: string | null }[];
  /** The shelf tabs, each as its name and then its count. */
  tabs: string[];
  /** What the tabs' counts are labelled. */
  counts: string[];
}

/**
 * From now on, the setup window notes what its step shows after each change to it. A test then reads every moment as it was,
 * however slowly it polls: a row that is up for a second is caught, with the heading that read beside it.
 */
async function watchStep(setup: Page): Promise<void> {
  await setup.evaluate(() => {
    const moments: Shown[] = [];
    Object.assign(window, { moments });
    const note = () => {
      const step = document.querySelector("main");
      moments.push({
        heading: step?.querySelector("h2")?.textContent ?? "",
        paragraphs: [...(step?.querySelectorAll("p") ?? [])].map((p) => ({ text: p.textContent ?? "", tone: p.getAttribute("data-tone") })),
        tabs: [...document.querySelectorAll('[data-shelf][data-variant="tab"]')].map((tab) => tab.textContent ?? ""),
        counts: [...document.querySelectorAll('[data-variant="tab"] [aria-label]')].map((count) => count.getAttribute("aria-label") ?? ""),
      });
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
    note();
  });
}

/** What `watchStep` noted while the filing worked, so while the heading still read "Watch me file it.". */
const whileWorking = async (setup: Page) =>
  (await setup.evaluate(() => (window as { moments?: Shown[] }).moments ?? [])).filter((shown) => shown.heading === "Watch me file it.");

/** The rows a moment showed: the paragraphs under the working line. */
const rowsOf = (shown: Shown) => shown.paragraphs.slice(1).map((p) => p.text);

test("the first filing shows each step the agent takes, as it takes it", async () => {
  const { app, setup } = await steppedRun();
  await watchStep(setup);
  await typeFirstThought(setup, "Call the vet on Monday");
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  // Each row came while the heading still read "Watch me file it.", in the order of the agent's steps and not all at once.
  const working = await whileWorking(setup);
  const first = VET_ROWS.map((line) => working.findIndex((shown) => rowsOf(shown).includes(line)));
  expect(first).not.toContain(-1);
  expect(first).toEqual([...first].sort((a, b) => a - b));
  expect(first[0]).toBeLessThan(first.at(-1) ?? 0);
  // A row stayed in view as the next came, and no other row ever showed: the capture is in none.
  for (const shown of working) expect(rowsOf(shown)).toEqual(VET_ROWS.slice(0, rowsOf(shown).length));
  expect(working.map((shown) => rowsOf(shown).length).at(-1)).toBe(VET_ROWS.length);
  await app.close();
});

test("the shelf tabs count the pages while the filing runs", async () => {
  const { app, setup } = await steppedRun();
  await watchStep(setup);
  await typeFirstThought(setup, "Call the vet on Monday");
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  const working = await whileWorking(setup);
  const idea = working.findIndex((shown) => rowsOf(shown).includes("New idea page: Call the vet on Monday"));
  expect(idea).toBeGreaterThan(0);
  // No tab counted anything before the idea's page was written. As its row showed, Ideas counted one, labelled "1 new",
  // and no other tab did; the index and the log are on no shelf, so it stayed so while the rest of the steps came.
  for (const shown of working.slice(0, idea)) expect(shown.counts).toEqual([]);
  for (const shown of working.slice(idea)) {
    expect(shown.tabs).toEqual(["Goals", "Ideas1", "Problems", "Memories", "People", "Topics"]);
    expect(shown.counts).toEqual(["1 new"]);
  }
  // Once filed, the tabs count the same.
  await expect(tabs(setup)).toHaveText(["Goals", "Ideas1", "Problems", "Memories", "People", "Topics"]);
  await expect(setup.getByLabel("1 new")).toBeVisible();
  await app.close();
});

test("the window shows the newest six steps, the newest in full ink", async () => {
  // Ten pages are read back to back after the index: eleven rows by the time the idea's page is written, six of them shown.
  const { app, setup } = await steppedRun({ FAKE_AGENT_READS: "10" });
  await watchStep(setup);
  await typeFirstThought(setup, "Call the vet on Monday");
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  const working = await whileWorking(setup);
  expect(Math.max(...working.map((shown) => rowsOf(shown).length))).toBe(6);
  // Once the ten are read, the six newest are the last six of them.
  const read = working.find((shown) => rowsOf(shown).at(-1) === "Reading seen-10");
  expect(read && rowsOf(read)).toEqual(["Reading seen-5", "Reading seen-6", "Reading seen-7", "Reading seen-8", "Reading seen-9", "Reading seen-10"]);
  // At every moment the newest row is in the default ink, and the others are secondary.
  for (const shown of working) {
    const tones = shown.paragraphs.slice(1).map((p) => p.tone);
    expect(tones).toEqual(tones.map((_, n) => (n === tones.length - 1 ? null : "secondary")));
  }
  await app.close();
});

test("a hundred quick steps reach the setup window as a few updates", async () => {
  // The stand-in reads a hundred pages back to back, after the index and before it writes.
  const { app, setup } = await steppedRun({ FAKE_AGENT_READS: "100" });
  // From now on, each snapshot sent to the setup window is noted: what state its filing is in, and how many rows it carries.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"));
    if (!win) throw new Error("There is no setup window to watch.");
    const sent: { kind: string | null; rows: number }[] = [];
    Object.assign(globalThis, { stepSends: sent });
    const send = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel: string, ...args: unknown[]) => {
      const filing = (args[0] as { filing?: { kind: string; rows?: unknown[] } | null } | undefined)?.filing;
      if (channel === "setup:changed") sent.push({ kind: filing?.kind ?? null, rows: filing?.rows?.length ?? 0 });
      send(channel, ...args);
    };
  });
  await typeFirstThought(setup, "Call the vet on Monday");
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  const sent = await app.evaluate(() => (globalThis as { stepSends?: { kind: string | null; rows: number }[] }).stepSends ?? []);
  expect(sent.length).toBeLessThanOrEqual(20); // not one for each of the hundred
  // They did arrive, in those few: a send held the fifty newest rows, which is all main keeps.
  expect(Math.max(...sent.map((snapshot) => snapshot.rows))).toBe(50);
  await app.close();
});

test("the steps aren't announced", async () => {
  const { app, setup } = await steppedRun();
  await typeFirstThought(setup, "Call the vet on Monday");
  const row = setup.getByText("Reading your library index", { exact: true });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByRole("heading", { name: "Watch me file it." })).toBeVisible();
  // Components take no aria props, so the test climbs from the row's text: none of what holds it is a live region.
  expect(await row.evaluate((el) => el.closest('[aria-live],[role="status"],[role="log"]')?.tagName ?? null)).toBeNull();
  // The one live region on the step holds the heading alone, so VoiceOver hears the filing's start and its end, not its steps.
  expect(await live(setup)).toEqual(["Watch me file it."]);
  await app.close();
});

test("File it waits for words, and Return with none files nothing", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  await setup.getByRole("button", { name: "Type it instead" }).click();
  const box = setup.getByRole("textbox", { name: "Your thought" });
  await expect(box).toBeFocused();
  const fileIt = setup.getByRole("button", { name: "File it", exact: true });
  await expect(fileIt).toBeDisabled();
  await box.fill("   ");
  await expect(fileIt).toBeDisabled();
  await box.press("Enter"); // Return files, as File it does: here, nothing
  await setup.evaluate(() => window.avanzel.setup.typeThought("   ")); // nor do empty words sent from the page
  expect(inbox(path.join(home, "Avanzel"))).toEqual([]);
  expect(await call(app, "setupStepForTests")).toBe("think");
  // Nothing scolds: there is no problem to show under the box.
  expect((await setupSnap(app)).typeProblem).toBeNull();
  await expect(box).toHaveAccessibleDescription("");
  await expect(setup.getByText("Type a thought first.")).toHaveCount(0);
  await box.fill("Plant tulips in October");
  await expect(fileIt).toBeEnabled();
  await box.fill("");
  // Cancel puts the box away, and Type it instead brings it back.
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(box).toHaveCount(0);
  await setup.getByRole("button", { name: "Type it instead" }).click();
  await expect(box).toBeVisible();
  await app.close();
});

test("setup's channels act only on what its window offers, and take anything without throwing", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, AVANZEL_PRESS_WAIT_MS: "300" });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // Copy names an install by its agent, and main copies the command it holds: never text of the page's own.
  await setup.evaluate(async () => {
    window.avanzel.setup.copy("codex");
    window.avanzel.setup.copy("rm -rf ~" as never);
    window.avanzel.setup.copy({ command: "rm -rf ~" } as never);
    await window.avanzel.setup.get(); // main answers in order: the copies before it have been handled
  });
  expect(await call(app, "copiedForTests")).toEqual([CODEX_INSTALL]);
  // Install git is offered only while this Mac has no usable git: with one, asking for it runs nothing.
  await setup.evaluate(async () => {
    window.avanzel.setup.installGit();
    await window.avanzel.setup.get();
  });
  expect(await call(app, "spawnedForTests")).toEqual([]);
  // Only a shortcut the first-thought step offers is set from it: none is offered until the nudge shows its two.
  const shortcut = async () => (await settingsSnap(app)).app.shortcuts.dictate;
  await setup.evaluate(() => window.avanzel.setup.useShortcut("Command+Q"));
  await setup.evaluate(() => window.avanzel.setup.useShortcut("Control+Shift+Space"));
  expect(await shortcut()).toBe("Alt+Space");
  await reachFor(setup, "Alt");
  await expect(setup.getByText(NUDGE)).toBeVisible();
  await setup.evaluate(() => window.avanzel.setup.useShortcut("Command+Q"));
  expect(await shortcut()).toBe("Alt+Space");
  await setup.evaluate(() => window.avanzel.setup.useShortcut("Control+Shift+Space"));
  expect(await shortcut()).toBe("Control+Shift+Space");
  // What isn't words is no thought, and no question: nothing throws, and nothing is made.
  await setup.evaluate(() => window.avanzel.setup.typeThought(42 as never));
  await setup.evaluate(() => window.avanzel.setup.typeThought({ words: "Plant tulips" } as never));
  await setup.evaluate(() => window.avanzel.setup.ask(null as never));
  expect(inbox(library)).toEqual([]);
  expect(await call(app, "setupStepForTests")).toBe("think");
  await app.close();
});

test("Cancel stops the agent, takes back what it did, and File it again files it", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, FAKE_AGENT_MODE: "slow-once", FAKE_AGENT_ONCE: onceMarker() });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await typeFirstThought(setup, "Plant tulips in October");
  // The stalled run has changed something, and hangs.
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  await expect(setup.getByText(/^Claude Code is working: \d+ s( of about 15)?$/)).toBeVisible();
  await expect(zel(setup)).toHaveAttribute("data-mood", "thinking");
  // While it runs, Cancel is the only way on: the footer has no Continue, and no step has Back here.
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  // Whether the stopped run is ever shown as a failure, even for a frame, before it is cancelled.
  await setup.evaluate(() => {
    const page = window as { sawFailure?: boolean };
    page.sawFailure = false;
    new MutationObserver(() => {
      if (document.querySelector('[role="alert"]')) page.sawFailure = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup.getByRole("heading", { name: "Cancelled." })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByText("Your words are back in the inbox, untouched, and nothing else changed.", { exact: true })).toBeVisible();
  expect(await setup.evaluate(() => (window as { sawFailure?: boolean }).sawFailure)).toBe(false);
  expect(exists(library, "goals/half.md")).toBe(false);
  expect(inbox(library)).toHaveLength(1);
  await expect(zel(setup)).toHaveAttribute("data-mood", "idle");
  // File it again is the moment's primary; Continue steps back (one primary per moment).
  const again = setup.getByRole("button", { name: "File it again" });
  await expect(again).toHaveAttribute("data-variant", "primary");
  await expect(again).toBeFocused(); // where Cancel was
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "secondary");
  await again.click();
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("Cancel in a library without git leaves the stopped run's edits as they are, and says nothing recorded them", async () => {
  // AVANZEL_GIT_USABLE=0 plays a Mac with no usable git: Looks good makes the library without a repository, so the run's edits
  // have no commit to be taken back from. "slow-messy" writes a page, then never finishes.
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, AVANZEL_GIT_USABLE: "0", FAKE_AGENT_MODE: "slow-messy" });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  expect(exists(library, ".git")).toBe(false);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect.poll(() => exists(library, "goals/half.md"), { timeout: 30_000 }).toBe(true);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup.getByRole("heading", { name: "Cancelled." })).toBeVisible({ timeout: 30_000 });
  await expect(
    setup.getByText("Your words are back in the inbox. The agent's partial edits stay as they are, because nothing recorded them.", { exact: true }),
  ).toBeVisible();
  await expect(setup.getByText("nothing else changed", { exact: false })).toHaveCount(0);
  expect((await setupSnap(app)).filing).toMatchObject({ kind: "cancelled", partial: false, leftovers: 1 });
  // What the run wrote stays, as the line says; the words are in the inbox, and File it again is still the way on.
  expect(exists(library, "goals/half.md")).toBe(true);
  expect(inbox(library)).toHaveLength(1);
  await expect(setup.getByRole("button", { name: "File it again" })).toHaveAttribute("data-variant", "primary");
  await app.close();
});

test("Cancel in a library without git, before the run changed anything, keeps the line that nothing else changed", async () => {
  // "slow-noisy" talks, then never finishes: it writes nothing.
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, AVANZEL_GIT_USABLE: "0", FAKE_AGENT_MODE: "slow-noisy" });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByText(/^Claude Code is working: \d+ s( of about 15)?$/)).toBeVisible();
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup.getByRole("heading", { name: "Cancelled." })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByText("Your words are back in the inbox, untouched, and nothing else changed.", { exact: true })).toBeVisible();
  expect((await setupSnap(app)).filing).toMatchObject({ kind: "cancelled", partial: false, leftovers: 0 });
  expect(exists(library, "goals/half.md")).toBe(false);
  expect(inbox(library)).toHaveLength(1);
  await app.close();
});

/** The usage-limit waits the app keeps in its run state, for any library: a filing in setup's window never starts one. */
async function waitsKept(app: ElectronApplication): Promise<unknown[]> {
  const file = path.join(await app.evaluate(() => process.env.AVANZEL_USER_DATA ?? ""), "run-state.json");
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, "utf8")) as Record<string, { waiting?: unknown[] }>;
  return Object.values(state).flatMap((library) => library.waiting ?? []);
}

test("a filing that asks to sign in names it and offers Open Terminal", async () => {
  const { env, home } = firstRun({ claude: failingClaude("Error: not logged in") });
  const app = await launch(env);
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code isn't signed in on this Mac.", { exact: true })).toBeVisible({ timeout: 30_000 });
  // Setup watches for no sign-in, so it says to try again once signed in, and that the note is safe in the inbox.
  await expect(notice).toContainText("Run claude once in Terminal and sign in, then try again. Your note is safe in the inbox.");
  await expect(notice.getByText("claude", { exact: true })).toBeVisible(); // the command, set as code
  await expect(notice.locator("code")).toHaveText("claude");
  // The fix is Open Terminal: the moment's one primary, and last in the row, as the Ask window has it. Try again, which would
  // only fail again until the person has signed in, is secondary.
  await expect(notice.getByRole("button")).toHaveText(["Try again", "Open Terminal"]);
  await expect(notice.getByRole("button", { name: "Open Terminal", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(notice.getByRole("button", { name: "Try again", exact: true })).toHaveAttribute("data-variant", "secondary");
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Open Terminal"]);
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "secondary");
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(zel(setup)).toHaveAttribute("data-mood", "needs-you");
  await snap(setup, "setup-filing-signin");
  expect(inbox(path.join(home, "Avanzel"))).toHaveLength(1);
  expect(await call(app, "signInWatchesForTests")).toEqual([]); // nothing watches for the sign-in, as the words say
  await notice.getByRole("button", { name: "Open Terminal" }).click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["Terminal"]);
  await app.close();
});

test("a filing that hits a usage limit says when it resets, and that setup waits for nothing", async () => {
  const { env, home } = firstRun({ claude: limitedClaude() }); // resets tomorrow at 09:00
  const app = await launch(env);
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code has hit its usage limit.", { exact: true })).toBeVisible({ timeout: 30_000 });
  // Setup keeps no wait for the reset, so it says to try again then, and that the note is safe in the inbox.
  await expect(notice.getByText("It resets tomorrow at 09:00. Your note is safe in the inbox; try again then.", { exact: true })).toBeVisible();
  // Setup's own buttons: Try again alone, the moment's primary, with no other agent to file it with.
  await expect(notice.getByRole("button")).toHaveText(["Try again"]);
  await expect(notice.getByRole("button", { name: "Try again", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(zel(setup)).toHaveAttribute("data-mood", "needs-you");
  await snap(setup, "setup-filing-limit");
  expect(inbox(path.join(home, "Avanzel"))).toHaveLength(1);
  expect(await waitsKept(app)).toEqual([]);
  await app.close();
});

test("a usage limit that names no reset leaves the retry to the evening review", async () => {
  const { env } = firstRun({ claude: failingClaude("Error: usage limit reached") });
  const app = await launch(env);
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code has hit its usage limit.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText("Your note is safe in the inbox; the evening review will try again.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button")).toHaveText(["Try again"]);
  await app.close();
});

test("another failure shows its own line", async () => {
  const { env, home } = firstRun({ claude: failingClaude("Error: boom") });
  const app = await launch(env);
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code couldn't file this note.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText("Boom. Your note is safe in the inbox; the evening review will try again.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Open Terminal" })).toHaveCount(0); // signing in isn't the fix
  expect(inbox(path.join(home, "Avanzel"))).toHaveLength(1);
  // Try again files the same note again: the agent is asked once more.
  const filings = async () => (await callsTo(app, "claude")).filter((line) => line.startsWith("claude -p ")).length;
  expect(await filings()).toBe(1);
  await notice.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(filings, { timeout: 30_000 }).toBe(2);
  await expect(notice.getByText("Claude Code couldn't file this note.", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(inbox(path.join(home, "Avanzel"))).toHaveLength(1);
  await app.close();
});

test("a failed filing that left edits behind says where they are kept", async () => {
  // "messy" fails a note that says "unfileable" after rewriting the index: the stopped run's edits are committed on their own.
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, FAKE_AGENT_MODE: "messy" });
  const setup = await throughFound(app);
  await typeFirstThought(setup, "This one is unfileable");
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code couldn't file this note.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(
    notice.getByText(
      "Agent crashed: cannot file this one. Your note is safe in the inbox; the evening review will try again. Claude Code's partial edits are kept as their own commit in the library's history.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await setupSnap(app)).filing).toMatchObject({ kind: "failed", partial: "commit", failure: { kind: "other", agent: "Claude Code" } });
  expect(inbox(path.join(home, "Avanzel"))).toHaveLength(1);
  await app.close();
});

test("a filing whose agent has gone offers Open Settings, the moment's primary, and not Try again", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // Found chose Claude Code and saved it as the library's agent; it is uninstalled before the thought is filed.
  expect(loadSettings(library).harness).toBe("claude");
  rmSync(path.join(env.PATH!.split(":")[0]!, "claude"));
  await typeFirstThought(setup, "Plant tulips in October");
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code isn't installed on this Mac any more.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(
    notice.getByText("Your note is safe in the inbox. Settings → Agents can choose another agent, or has its install command.", { exact: true }),
  ).toBeVisible();
  // Trying again would only fail again until another agent is chosen: the fix is Settings → Agents.
  await expect(notice.getByRole("button")).toHaveText(["Open Settings"]);
  await expect(setup.locator('button[data-variant="primary"]')).toHaveText(["Open Settings"]);
  await expect(setup.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "secondary");
  expect(inbox(library)).toHaveLength(1);
  await snap(setup, "setup-filing-gone");
  await notice.getByRole("button", { name: "Open Settings", exact: true }).click();
  const settings = await windowFor(app, "settings");
  await expect(settings.getByRole("radio", { name: "Agents", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(setup.getByRole("alert")).toBeVisible(); // setup stays where it was
  await app.close();
});

test("a note that left the inbox after setup's window closed says nothing of a failed filing", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // Another Avanzel run has the library: this test holds its lock, and the filing waits for it.
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await typeFirstThought(setup, "Plant tulips in October");
    await expect(setup.getByText("Waiting for another Avanzel run to finish…", { exact: true })).toBeVisible({ timeout: 30_000 });
    // The window closes, and the filing goes on without it. Meanwhile the note leaves the inbox, as when another Avanzel files it.
    await closeSetup(app);
    for (const name of inbox(library)) rmSync(path.join(library, "inbox", name));
  } finally {
    letGo();
    await held;
  }
  await call(app, "idleForTests");
  // Nothing failed, and there are no words to be safe in the inbox: no card and no notification, as for any note found gone.
  expect(await call(app, "notificationsForTests")).toEqual([]);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await call(app, "cardCaptureForTests")).toBeNull();
  await app.close();
});

test("a recording started on Filing keeps the capsule through Try again", async () => {
  const words = "Plant tulips in October";
  const { env } = firstRun({ claude: failingClaude("Error: boom") });
  const app = await launch({ ...env, AVANZEL_FAKE_AUDIO: speechWav(words), AVANZEL_FAKE_TRANSCRIPT: words });
  const setup = await throughFound(app);
  await typeFirstThought(setup, words);
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code couldn't file this note.", { exact: true })).toBeVisible({ timeout: 30_000 });
  // On Filing the shortcut records as it does anywhere: the capsule listens.
  await pressShortcut(app);
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  const filings = async () => (await callsTo(app, "claude")).filter((line) => line.startsWith("claude -p ")).length;
  // Try again files the thought in a new run (File it again does the same, fileSetupAgain), and leaves the capsule be:
  // the recording goes on, in view.
  await notice.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(filings, { timeout: 30_000 }).toBe(2);
  await expect(notice.getByText("Claude Code couldn't file this note.", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  await app.close();
});

test("a filing that waits for the library says so, and a note gone from the inbox meanwhile is named", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // Another Avanzel run has the library: this test holds its lock, and the filing waits for it.
  let letGo = () => {};
  const held = new Vault(library).withLock(() => new Promise<void>((resolve) => (letGo = resolve)));
  try {
    await typeFirstThought(setup, "Plant tulips in October");
    await expect(setup.getByText("Waiting for another Avanzel run to finish…", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(setup.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    // Meanwhile the note leaves the inbox, as when another Avanzel files it.
    for (const name of inbox(library)) rmSync(path.join(library, "inbox", name));
  } finally {
    letGo();
    await held;
  }
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Claude Code couldn't file it.", { exact: true })).toBeVisible({ timeout: 30_000 });
  // Nothing says the words are safe in the inbox, and there is nothing to try again: Continue is the way on.
  await expect(notice.getByText("The note isn't in the inbox any more.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button")).toHaveCount(0);
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "primary");
  await app.close();
});

test("closing setup during the filing still files the thought and says so", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const words = "Plant tulips in October";
  const voice = { AVANZEL_USER_DATA: userData, AVANZEL_FAKE_AUDIO: speechWav(words), AVANZEL_FAKE_TRANSCRIPT: words };
  const app = await launch({ ...env, ...voice, FAKE_AGENT_DELAY_MS: "3000", FAKE_AGENT_DELAY_TASK: "file" });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await typeFirstThought(setup, words);
  await expect(setup.getByRole("heading", { name: "Watch me file it." })).toBeVisible();
  await closeSetup(app);
  await call(app, "idleForTests");
  const notes = (await call(app, "notificationsForTests")) as { title: string; body: string }[];
  expect(notes.map((note) => note.title)).toContain("Filed by Claude Code");
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(await shown(app, "setup")).toBe(false);
  // The shortcut works as it does everywhere: a dictation starts in the capsule.
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "cancelRecording");
  await app.close();
  // The next launch has a library, so setup doesn't open.
  const next = await launch({ ...env, ...voice });
  expect((await settingsSnap(next)).library?.path).toBe(library);
  expect(await shown(next, "setup")).toBe(false);
  expect(await windowsTitled(next, "Set up Avanzel")).toBe(0);
  await next.close();
});
