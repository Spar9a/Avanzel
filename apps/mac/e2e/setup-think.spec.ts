// The setup window's first-thought step (Think): the press test of Record a thought's shortcut and the keycaps, which the step
// takes even with the Ask window in front, then the first thought typed and filed. Every test launches as a first run (firstRun),
// taken through Found.
import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NarrationRow } from "../src/shared/ipc.ts";
import { askIsKey, filedInto, onDay } from "./capsule-helpers.ts";
import { call, capsuleKind, capturesKept, filesUnder, filingClaude, firstRun, launch, speechWav, throughFound, typeFirstThought, windowFor, paneShown } from "./helpers.ts";
import {
  inbox,
  INSTRUCTION,
  NUDGE,
  pressShortcut,
  reachFor,
  sentToCapsule,
  settingsSnap,
  setupSnap,
  THINK,
  watchCapsule,
  zel,
} from "./setup-helpers.ts";

/** The stage's keycaps, as the first-thought step draws Record a thought's shortcut. */
const keycaps = (setup: Page) => setup.locator('kbd[data-size="key"]');

// The first-thought step tests the shortcut with a real press: macOS lets an app register a shortcut another app holds,
// so only a press that arrives says it works. firstRun() makes the wait 60 s, so these tests set it when they need it.

test("a press of the shortcut is heard, and setup says it is free", async () => {
  const app = await launch(firstRun().env);
  const setup = await throughFound(app);
  await expect(setup.getByText(INSTRUCTION)).toContainText("⌥Space");
  await expect(setup.getByText("If you're stuck, try a goal, someone you work with, or an idea you keep coming back to.", { exact: true })).toBeVisible();
  await expect(setup.getByText("Your words will appear here.", { exact: true })).toBeVisible();
  // The stage draws the shortcut as keycaps, one per key.
  await expect(keycaps(setup)).toHaveText(["⌥", "Space"]);
  await expect.poll(() => call(app, "setupStepForTests")).toBe("think");
  await pressShortcut(app);
  await expect(setup.getByText("⌥Space is free on this Mac, so it works in every app.", { exact: true })).toBeVisible();
  // The speech model can't download here (its server is a dead port), so the press only says that the shortcut works:
  // nothing records, the capsule shows nothing, and nothing promises that Esc cancels.
  expect(await capsuleKind(app)).toBe("hidden");
  await expect(setup.getByText(/Esc cancels/)).toHaveCount(0);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await app.close();
});

test("no press within the wait offers two free shortcuts, and the one picked is the one to press", async () => {
  const app = await launch({ ...firstRun().env, AVANZEL_PRESS_WAIT_MS: "300" });
  const setup = await throughFound(app);
  // Entering the step starts no wait: nobody has reached for the shortcut.
  await setup.waitForTimeout(1_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  // ⌥ goes down, and no press follows.
  await reachFor(setup, "Alt");
  await expect(setup.getByText("Did ⌥Space do nothing?", { exact: true })).toBeVisible();
  // Whatever this Mac runs: a running Alfred, Raycast, ChatGPT or Superwhisper is named as the likely holder.
  await expect(setup.getByText(/^Another app may be using it(, probably \w+)?\. Try another shortcut\.$/)).toBeVisible();
  // The best one last, as the primary.
  const uses = setup.getByRole("button", { name: /^Use / });
  await expect(uses).toHaveText(["Use ⌃⌥R", "Use ⌃⇧Space"]);
  await expect(uses.last()).toHaveAttribute("data-variant", "primary");
  // Whether the step is ever without the nudge from here on, even for a frame.
  await setup.evaluate(() => {
    const page = window as { cleared?: boolean };
    page.cleared = false;
    new MutationObserver(() => {
      if (!/do nothing\?/.test(document.querySelector("main")?.textContent ?? "")) page.cleared = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await setup.getByRole("button", { name: "Use ⌃⇧Space" }).click();
  await expect.poll(async () => (await settingsSnap(app)).app.shortcuts.dictate).toBe("Control+Shift+Space");
  await expect(setup.getByText(INSTRUCTION)).toContainText("⌃⇧Space");
  await expect(keycaps(setup)).toHaveText(["⌃", "⇧", "Space"]);
  // The test starts over for the new shortcut: the nudge goes with the pick, and stays gone until the person reaches
  // for the new one (⌃ goes down) and doesn't press it; a press ends it.
  await setup.waitForTimeout(1_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  expect(await setup.evaluate(() => (window as { cleared?: boolean }).cleared)).toBe(true);
  await reachFor(setup, "Alt"); // ⌥ isn't the new shortcut's first modifier: it starts nothing
  await setup.waitForTimeout(1_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await reachFor(setup, "Control");
  await expect(setup.getByText("Did ⌃⇧Space do nothing?", { exact: true })).toBeVisible();
  await pressShortcut(app);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await expect(setup.getByText("⌃⇧Space is free on this Mac, so it works in every app.", { exact: true })).toBeVisible();
  await app.close();
});

test("the nudge waits for the person to reach for the shortcut, and then for the real 3 s", async () => {
  // The real wait: none of the tests' own.
  const app = await launch({ ...firstRun().env, AVANZEL_PRESS_WAIT_MS: "" });
  const setup = await throughFound(app);
  // The person reads, thinks and types, with ⌥ in the box for a typed thought, where it types a character: for longer
  // than the wait, and nothing asks whether ⌥Space did nothing.
  await setup.getByRole("button", { name: "Type it instead" }).click();
  const box = setup.getByRole("textbox", { name: "Your thought" });
  await expect(box).toBeFocused();
  await reachFor(setup, "Alt");
  await setup.waitForTimeout(4_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  expect((await setupSnap(app)).press.silent).toBe(false);
  // Out of the box, ⌥ goes down and no press follows: 3 s later, and not before, the step asks.
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(box).toHaveCount(0);
  const reached = Date.now();
  await reachFor(setup, "Alt");
  await setup.waitForTimeout(2_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await expect(setup.getByText("Did ⌥Space do nothing?", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - reached).toBeGreaterThanOrEqual(3_000);
  await app.close();
});

test("a ⌥Space another app holds is named at once, and the capsule doesn't name it too", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const app = await launch({ ...firstRun().env, AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space", AVANZEL_USER_DATA: userData });
  await call(app, "snapshot"); // it has started: a launch notice would show by now
  expect(await capsuleKind(app)).toBe("hidden");
  await watchCapsule(app);
  const setup = await throughFound(app);
  const notice = setup.getByRole("alert");
  await expect(notice.getByText(/^⌥Space is used by another app/)).toBeVisible();
  await expect(notice.getByText("Pick another shortcut.", { exact: true })).toBeVisible();
  await expect(notice.getByRole("button", { name: /^Use / })).toHaveText(["Use ⌃⌥R", "Use ⌃⇧Space"]);
  await expect(notice.getByRole("button", { name: "Use ⌃⇧Space" })).toHaveAttribute("data-variant", "primary");
  // From launch to here the capsule showed nothing: no state but hidden was sent to it.
  expect(await capsuleKind(app)).toBe("hidden");
  expect((await sentToCapsule(app)).filter((kind) => kind !== "hidden")).toEqual([]);
  // Named here, so the capsule won't name it at the next launch either.
  expect(JSON.parse(readFileSync(path.join(userData, "noticed-shortcuts.json"), "utf8"))).toContain("Alt+Space");
  await app.close();
});

test("with no free shortcut, setup offers Settings, and the shortcut set there is the one it listens for", async () => {
  const app = await launch({
    ...firstRun().env,
    AVANZEL_PRESS_WAIT_MS: "300",
    // ⌥Space and every one Record a thought could move to.
    AVANZEL_FAKE_TAKEN_SHORTCUTS: "Alt+Space,Control+Shift+Space,Control+Alt+R,Control+Alt+D",
  });
  const setup = await throughFound(app);
  const taken = setup.getByRole("alert");
  await expect(taken.getByText(/^⌥Space is used by another app/)).toBeVisible();
  await expect(taken.getByText("Pick another one in Settings → Shortcuts.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: /^Use / })).toHaveCount(0);
  const open = taken.getByRole("button", { name: "Open Settings" });
  await expect(open).toHaveAttribute("data-variant", "primary");
  await open.click();
  // Settings opens on Shortcuts, as the line says.
  const settings = await windowFor(app, "panel");
  await paneShown(settings, "Shortcuts");
  // A shortcut set in Settings is the one the step listens for now, from the start of a new wait.
  await call(app, "setApp", { shortcuts: { ...(await settingsSnap(app)).app.shortcuts, dictate: "Control+Alt+K" } });
  await expect(taken).toHaveCount(0);
  await expect(setup.getByText(INSTRUCTION)).toContainText("⌃⌥K");
  await reachFor(setup, "Control");
  await expect(setup.getByText("Did ⌃⌥K do nothing?", { exact: true })).toBeVisible();
  await expect(setup.getByText("Another app may be using it. Pick another one in Settings → Shortcuts.", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Open Settings" })).toHaveAttribute("data-variant", "primary");
  await app.close();
});

test("the keycaps press themselves twice each time the step opens, and stay still under Reduce Motion", async () => {
  const app = await launch(firstRun().env);
  const setup = await windowFor(app, "setup");
  // Each keycap drawn pressed, by its key, from before the step first opens.
  await setup.evaluate(() => {
    const page = window as { presses?: string[] };
    page.presses = [];
    new MutationObserver((records) => {
      for (const { target } of records) {
        if (target instanceof Element && target.hasAttribute("data-pressed")) page.presses?.push(target.textContent ?? "");
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-pressed"] });
  });
  const presses = () => setup.evaluate(() => (window as { presses?: string[] }).presses ?? []);
  await throughFound(app);
  await expect.poll(presses, { timeout: 10_000 }).toEqual(["⌥", "Space", "⌥", "Space"]);
  await expect(setup.locator("kbd[data-pressed]")).toHaveCount(0); // they end up, unpressed
  // Again on the way back to the step.
  await setup.getByRole("button", { name: "Back" }).click();
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  await expect.poll(presses, { timeout: 10_000 }).toHaveLength(8);
  // Under Reduce Motion the step opens on their last frame, unpressed, and they stay so.
  await setup.emulateMedia({ reducedMotion: "reduce" });
  await setup.getByRole("button", { name: "Back" }).click();
  await setup.getByRole("button", { name: "Use this folder" }).click();
  await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
  await setup.waitForTimeout(2_500); // past the time of both presses
  expect(await presses()).toHaveLength(8);
  await expect(keycaps(setup)).toHaveText(["⌥", "Space"]);
  await app.close();
});

test("a press with Ask in front is still setup's: the step records its first thought, not a question", async () => {
  // The step takes the press before Ask does (`pressDictate`). Ask is the key window and the shelves hold a page, which are all a
  // question needs, and the press still starts the step's own recording: its window says it listens, as for any press on the step.
  const { env, home } = firstRun();
  const app = await launch({ ...env, AVANZEL_FAKE_AUDIO: speechWav("hello"), AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October" });
  const setup = await throughFound(app);
  filedInto(path.join(home, "Avanzel"), "ideas", "tulips", "Plant tulips in October", onDay(0));
  await call(app, "openAsk");
  await windowFor(app, "ask");
  await askIsKey(app, true);
  await pressShortcut(app);
  await expect.poll(async () => (await setupSnap(app)).thought.kind, { timeout: 15_000 }).toBe("listening");
  await expect(setup.getByText("I'm listening.", { exact: true })).toBeVisible();
  await call(app, "cancelRecording");
  await app.close();
});

// The first thought, typed: setup files it in its own window while the person watches, with the time, Cancel, and
// one fix when it fails. The stand-in Claude Code runs the engine's fake agent (filingClaude), and ~/Avanzel is the
// library Looks good made.

test("a typed first thought is filed in the window, with the time shown", async () => {
  const { env, home } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, FAKE_AGENT_DELAY_MS: "1500", FAKE_AGENT_DELAY_TASK: "file" });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: "Watch me file it." })).toBeVisible();
  await expect(setup.getByText(/^Claude Code is working: \d+ s of about 15$/)).toBeVisible();
  await expect(setup.getByRole("heading", { name: /^All filed\. Claude Code took \d+ s\.$/ })).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByRole("listitem")).toHaveCount(1); // the receipt: the new note, on its shelf
  await expect(setup.getByRole("listitem")).toContainText(["Plant tulips in October"]);
  await expect(setup.getByRole("listitem")).toContainText(["Ideas"]);
  await expect(zel(setup)).toHaveAttribute("data-mood", "filed");
  await expect(setup.getByRole("button", { name: "Continue" })).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(inbox(library)).toEqual([]);
  // The setup window showed the filing, so the capsule showed nothing.
  expect(await capsuleKind(app)).toBe("hidden");
  // Only the first-thought step takes a typed thought: one sent from here (a second click, say) makes no capture.
  await call(app, "typeSetupThought", "A second thought");
  expect(inbox(library)).toEqual([]);
  await app.close();
});

test("a typed first thought is not counted: only a recording is", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { env } = firstRun({ claude: filingClaude() });
  const app = await launch({ ...env, AVANZEL_USER_DATA: userData });
  const setup = await throughFound(app);
  await typeFirstThought(setup, "Plant tulips in October");
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  // It is kept and filed like any thought, but the count is the recording card's hint, which a typed thought never shows.
  expect(capturesKept(userData)).toBe(0);
  await app.close();
});

test("setup's snapshot carries each step while the first thought is filed", async () => {
  const { env } = firstRun({ claude: filingClaude() });
  // The stand-in Claude Code reports each tool call as the real one does, a second apart: the steps come while the run goes on.
  const app = await launch({ ...env, FAKE_AGENT_STREAM: "claude", FAKE_AGENT_STEP_MS: "1000" });
  const setup = await throughFound(app);
  // From now on, each snapshot sent to the setup window is noted: what state its filing is in, and the rows it carries.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/renderer/setup/"));
    if (!win) throw new Error("There is no setup window to watch.");
    const sent: { kind: string | null; rows: unknown[] }[] = [];
    Object.assign(globalThis, { setupSent: sent });
    const send = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel: string, ...args: unknown[]) => {
      const filing = (args[0] as { filing?: { kind: string; rows?: unknown[] } | null } | undefined)?.filing;
      if (channel === "setup:changed") sent.push({ kind: filing?.kind ?? null, rows: filing?.rows ?? [] });
      send(channel, ...args);
    };
  });
  const sent = () => app.evaluate(() => (globalThis as { setupSent?: { kind: string | null; rows: NarrationRow[] }[] }).setupSent ?? []);
  await typeFirstThought(setup, "Call the vet on Monday");
  // The rows of the filing while it runs; the filing that has ended has none to show.
  let rows: NarrationRow[] = [];
  await expect
    .poll(
      async () => {
        const { filing } = await setupSnap(app);
        rows = filing?.kind === "running" ? filing.rows : [];
        return rows.some((row) => row.kind === "new" && row.title === "Call the vet on Monday" && row.shelf === "ideas");
      },
      { intervals: [50], timeout: 30_000 },
    )
    .toBe(true);
  // What the agent has done by then, in the order it did it: it read the index, then wrote the idea's page (a slow machine
  // may have let a later step in). Its first read, of the capture in the inbox, is no row.
  expect(rows.slice(0, 2)).toEqual([
    { kind: "read", path: "index.md", title: expect.any(String), shelf: "" },
    { kind: "new", path: expect.stringMatching(/^ideas\/idea-.+\.md$/), title: "Call the vet on Monday", shelf: "ideas" },
  ]);
  expect(rows.flatMap((row) => (row.path && /^(inbox|raw)\//.test(row.path) ? [row.path] : []))).toEqual([]);
  // The window was sent them, while the filing ran, not only offered them to whoever asks.
  await expect
    .poll(async () => (await sent()).some((snapshot) => snapshot.kind === "running" && snapshot.rows.some((row) => row.kind === "new")))
    .toBe(true);
  // The steps never fail the filing: it ends as it does without them.
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  const { filing } = await setupSnap(app);
  expect(filing).toMatchObject({ kind: "filed", pages: [{ title: "Call the vet on Monday", shelf: "ideas" }], canUndo: true });
  await app.close();
});
