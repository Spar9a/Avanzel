// The setup window's first thought, spoken: the microphone, the mic check, and a recording that goes wrong. Every test
// launches as a first run (firstRun) whose microphone hears the person (spokenRun).
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault, loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import {
  call,
  capsuleKind,
  closeModelHubs,
  fakeModelHub,
  filesUnder,
  filingClaude,
  firstRun,
  launch,
  snap,
  speechWav,
  throughFound,
  windowFor,
} from "./helpers.ts";
import { closeSetup, inbox, INSTRUCTION, live, NUDGE, pressShortcut, sentToCapsule, setupSnap, THINK, watchCapsule, zel } from "./setup-helpers.ts";

test.afterEach(closeModelHubs);

// The first thought, spoken. The first press asks about the microphone when macOS hasn't yet, then the real capsule
// records; once the words exist, the setup window takes over. A mic check gets a warm answer. AVANZEL_FAKE_AUDIO stands
// in for the microphone, AVANZEL_FAKE_TRANSCRIPT for the speech model (no test downloads one), and
// AVANZEL_FAKE_MIC_ANSWER for the answer to macOS's prompt.

/** What the first-thought step says while a recording runs. */
const LISTENING = "I'm listening.";

/** Zel's answer to a mic check. */
const HEARD_YOU = "Heard you. Want to try a real thought?";

/** The footnote a press of the shortcut brings. */
const FREE = /is free on this Mac, so it works in every app\.$/;

/** What the step says to do while the capsule records, which Esc cancels. */
const DONE_TALKING = /^Press .+ again when you're done\. Esc cancels\.$/;

/** Esc's promise, which holds only while a recording runs. */
const ESC = /Esc cancels/;

/** A first run whose microphone hears "Plant tulips in October", filed by the stand-in Claude Code; `env` adds to it. */
function spokenRun(env: Record<string, string> = {}): { env: Record<string, string>; home: string } {
  const run = firstRun({ claude: filingClaude() });
  return { home: run.home, env: { ...run.env, AVANZEL_FAKE_AUDIO: speechWav("Plant tulips in October"), ...env } };
}

/** The first press records, and a second one stops it: what the person says is then the thought. */
async function sayThought(app: ElectronApplication, setup: Page): Promise<void> {
  await pressShortcut(app);
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await pressShortcut(app);
}

test("the first press asks about the microphone behind one Continue, then records, and the words are filed", async () => {
  const { env, home } = spokenRun({
    AVANZEL_FAKE_PERMISSIONS: "microphone:not-determined",
    AVANZEL_FAKE_MIC_ANSWER: "granted",
    AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October",
  });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await pressShortcut(app);
  const primer = setup.getByRole("dialog");
  await expect(primer.getByText("Next, macOS asks about the microphone.", { exact: true })).toBeVisible();
  // The primer is the step: its one button is Continue, with no Back beside it, and nothing records until macOS asks.
  // It has its own Zel, so the stage has none meanwhile.
  await expect(setup.getByRole("main").getByRole("button")).toHaveText(["Continue"]);
  await expect(zel(setup)).toHaveCount(1);
  await expect(primer.locator("svg[data-mood]")).toHaveCount(1);
  await expect(setup.getByRole("button", { name: "Back" })).toHaveCount(0);
  expect(await capsuleKind(app)).toBe("hidden");
  await snap(setup, "setup-think-primer");
  await primer.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await expect(zel(setup)).toHaveAttribute("data-mood", "listening");
  await expect(zel(setup)).toHaveAttribute("data-look", "up"); // at the card the words will fill
  await expect(setup.getByText(FREE)).toBeVisible(); // the first press was heard
  await expect(setup.getByText(DONE_TALKING)).toBeVisible(); // and Esc cancels now
  await snap(setup, "setup-think-listening");
  await pressShortcut(app);
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  // Filed from the inbox with its recording kept, and the capsule hid once the words existed.
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1);
  expect(await capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("the first spoken thought has no file mode to switch: setup files it whatever the setting says, and it is a kept capture", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  const { env, home } = spokenRun({ AVANZEL_USER_DATA: userData, AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October" });
  const app = await launch(env);
  await call(app, "setApp", { fileMode: "evening" }); // any other capture would be saved for tonight
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await pressShortcut(app);
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  // Nothing to switch, and a press of the switch finds nothing to do; the card still names the key that finishes the recording.
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", mode: "dictate", fileMode: null, hint: "Alt+Space" });
  const capsule = await windowFor(app, "capsule");
  await capsule.evaluate(async () => {
    window.avanzel.capsule.toggleFileMode();
    await window.avanzel.settings.get(); // answered once main has heard the press
  });
  expect(await call(app, "capsuleStateForTests")).toMatchObject({ kind: "listening", fileMode: null });
  await pressShortcut(app);
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "ideas")).toHaveLength(1);
  expect(JSON.parse(readFileSync(path.join(userData, "captures.json"), "utf8"))).toEqual({ version: 1, kept: 1 });
  await app.close();
});

test("a denied microphone says where to allow it, and offers typing", async () => {
  const { env } = spokenRun({ AVANZEL_FAKE_PERMISSIONS: "microphone:denied", AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October" });
  const app = await launch(env);
  const setup = await throughFound(app);
  await pressShortcut(app);
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Avanzel can't hear you yet.", { exact: true })).toBeVisible();
  await expect(notice.getByText("Allow it in System Settings, under Microphone.", { exact: true })).toBeVisible();
  const open = notice.getByRole("button", { name: "Open System Settings" });
  await expect(open).toHaveAttribute("data-variant", "primary");
  // One Type it instead: the Notice's, in place of the step's own.
  await expect(setup.getByRole("button", { name: "Type it instead" })).toHaveCount(1);
  await expect(notice.getByRole("button", { name: "Type it instead" })).toHaveAttribute("data-variant", "secondary");
  expect(await capsuleKind(app)).toBe("hidden");
  await expect(zel(setup)).toHaveAttribute("data-mood", "needs-you");
  // The press was heard, but nothing records, so nothing says Esc cancels.
  await expect(setup.getByText(FREE)).toBeVisible();
  await expect(setup.getByText(ESC)).toHaveCount(0);
  await snap(setup, "setup-think-denied");
  // With AVANZEL_TEST=1 System Settings stays shut, and openedForTests says which pane it would have opened.
  await open.click();
  await expect.poll(() => call(app, "openedForTests")).toEqual(["System Settings → Microphone"]);
  await notice.getByRole("button", { name: "Type it instead" }).click();
  await expect(setup.getByRole("textbox", { name: "Your thought" })).toBeFocused();
  await app.close();
});

test("testing, testing gets a warm answer, and Try again starts over", async () => {
  // A short wait, which Try again doesn't start: the nudge would show within it.
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing.", AVANZEL_PRESS_WAIT_MS: "300" });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await sayThought(app, setup);
  await expect(setup.getByText(HEARD_YOU, { exact: true })).toBeVisible({ timeout: 30_000 });
  // The words are on the card, kept in the inbox with their recording; nothing is filed, and the capsule has hidden.
  await expect(setup.getByText("Testing, testing.", { exact: true })).toBeVisible();
  expect(inbox(library)).toHaveLength(1);
  expect(filesUnder(library, "raw/audio")).toHaveLength(1);
  expect(await capsuleKind(app)).toBe("hidden");
  const tryAgain = setup.getByRole("button", { name: "Try again", exact: true });
  await expect(tryAgain).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByRole("button", { name: "File it anyway" })).toHaveAttribute("data-variant", "secondary");
  await expect(setup.getByText(INSTRUCTION)).toHaveCount(0);
  await snap(setup, "setup-think-test");
  await tryAgain.click();
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await expect.poll(() => inbox(library)).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toEqual([]);
  await expect(setup.getByText(HEARD_YOU, { exact: true })).toHaveCount(0);
  // The step asks afresh, but nobody has reached for the shortcut since: nothing asks whether it did nothing.
  await setup.waitForTimeout(1_000);
  await expect(setup.getByText(NUDGE)).toHaveCount(0);
  await app.close();
});

test("File it anyway files a mic check", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing." });
  const app = await launch(env);
  const setup = await throughFound(app);
  await sayThought(app, setup);
  await setup.getByRole("button", { name: "File it anyway" }).click();
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  expect(inbox(path.join(home, "Avanzel"))).toEqual([]);
  await app.close();
});

/**
 * What isn't the mic check's, put in `library` before it is said: a note of the person's own in the inbox, and an older
 * recording under raw/audio/ that no note there names. Their names, as `inbox` and filesUnder(…, "raw/audio") list them.
 */
function bystanders(library: string): { note: string; recording: string } {
  const note = new Vault(library).newCapture("Plant tulips in October", { source: "text", now: new Date(2026, 8, 30, 8, 0) });
  const recording = path.join(library, "raw", "audio", "2026", "09", "2026-09-30-0800.wav");
  mkdirSync(path.dirname(recording), { recursive: true });
  writeFileSync(recording, "RIFF");
  return { note: path.basename(note.path), recording: path.relative(path.join(library, "raw", "audio"), recording) };
}

/** The person says "Testing, testing." (the run's fake transcript), and Zel answers. */
async function sayMicCheck(app: ElectronApplication, setup: Page): Promise<void> {
  await sayThought(app, setup);
  await expect(setup.getByText(HEARD_YOU, { exact: true })).toBeVisible({ timeout: 30_000 });
}

test("Try again removes only the mic check's own note and recording", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing." });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  const kept = bystanders(library);
  await sayMicCheck(app, setup);
  expect(inbox(library)).toHaveLength(2);
  expect(filesUnder(library, "raw/audio")).toHaveLength(2);
  await setup.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await expect.poll(() => inbox(library)).toEqual([kept.note]);
  expect(filesUnder(library, "raw/audio")).toEqual([kept.recording]);
  await app.close();
});

test("a press on a mic check's answer removes only its note and recording, and records again", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing." });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  const kept = bystanders(library);
  await sayMicCheck(app, setup);
  await pressShortcut(app);
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  expect(inbox(library)).toEqual([kept.note]);
  expect(filesUnder(library, "raw/audio")).toEqual([kept.recording]);
  await call(app, "cancelRecording");
  await app.close();
});

test("closing setup on a mic check's answer takes its note and recording away, and only those", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing." });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  const kept = bystanders(library);
  await sayMicCheck(app, setup);
  expect(inbox(library)).toHaveLength(2);
  // Left in the inbox, the evening review would file "Testing, testing" with an agent run.
  await closeSetup(app);
  expect(inbox(library)).toEqual([kept.note]);
  expect(filesUnder(library, "raw/audio")).toEqual([kept.recording]);
  await app.close();
});

test("Try again keeps a file outside raw/audio/ that the mic check's note names as its recording", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing." });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await sayMicCheck(app, setup);
  // A page of the person's, which the note's audio line now names by a path that starts in raw/audio/ and leaves it.
  const page = path.join(library, "ideas", "plant-tulips.md");
  const words = "# Plant tulips\n\nIn October, before the frost.\n";
  writeFileSync(page, words);
  const [name = ""] = inbox(library);
  const note = path.join(library, "inbox", name);
  writeFileSync(note, readFileSync(note, "utf8").replace(/^audio: .*$/m, "audio: raw/audio/../../ideas/plant-tulips.md"));
  expect(readFileSync(note, "utf8")).toContain("\naudio: raw/audio/../../ideas/plant-tulips.md\n");
  await setup.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await expect.poll(() => inbox(library)).toEqual([]);
  expect(existsSync(page) ? readFileSync(page, "utf8") : null).toBe(words);
  await app.close();
});

test("while the ears are still arriving, a press says so and typing is the way", async () => {
  const hub = await fakeModelHub("stall");
  const { env } = spokenRun({ AVANZEL_MODELS_URL: hub.url });
  const app = await launch(env);
  const setup = await throughFound(app);
  await pressShortcut(app);
  await expect(setup.getByText(FREE)).toBeVisible();
  await expect(setup.getByText(ESC)).toHaveCount(0);
  await expect(setup.getByText("My ears are still arriving. Type it instead, or talk to me once they land.", { exact: true })).toBeVisible();
  // The press records nothing: no capsule, and typing is the moment's one primary.
  expect(await capsuleKind(app)).toBe("hidden");
  await expect(setup.getByRole("button", { name: "Type it instead" })).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByText(LISTENING)).toHaveCount(0);
  await snap(setup, "setup-think-ears");
  await app.close();
});

test("Esc while listening cancels, and setup asks again", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October" });
  const app = await launch(env);
  // Esc's own callback, as a recording registers it: the test presses it.
  await app.evaluate(({ globalShortcut }) => {
    const register = globalShortcut.register.bind(globalShortcut);
    globalShortcut.register = (accelerator: string, callback: () => void) => {
      if (accelerator === "Escape") (globalThis as { pressEsc?: () => void }).pressEsc = callback;
      return register(accelerator, callback);
    };
  });
  const setup = await throughFound(app);
  await pressShortcut(app);
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await expect(setup.getByText(INSTRUCTION)).toHaveCount(0);
  await expect(setup.getByText(FREE)).toBeVisible();
  await expect(setup.getByText(DONE_TALKING)).toBeVisible();
  expect(await app.evaluate(() => {
    const pressEsc = (globalThis as { pressEsc?: () => void }).pressEsc;
    pressEsc?.();
    return !!pressEsc;
  })).toBe(true);
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await expect(setup.getByText(LISTENING)).toHaveCount(0);
  // Nothing records now, so Esc's promise goes with the recording.
  await expect(setup.getByText(FREE)).toBeVisible();
  await expect(setup.getByText(ESC)).toHaveCount(0);
  expect(await capsuleKind(app)).toBe("hidden");
  expect(inbox(path.join(home, "Avanzel"))).toEqual([]);
  // And again: a press records, and cancelling it (what Esc calls) asks again.
  await pressShortcut(app);
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await call(app, "cancelRecording");
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  expect(inbox(path.join(home, "Avanzel"))).toEqual([]);
  await app.close();
});

test("a recording that goes wrong says so in the window, in setup's own words, and Try again asks again", async () => {
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October", AVANZEL_AUDIO_TIMEOUT_MS: "1000" });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  // The audio is lost on its way from the capsule.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("capsule:audio");
    ipcMain.handle("capsule:audio", () => undefined);
  });
  await watchCapsule(app);
  await sayThought(app, setup);
  // What happened, what is safe (nothing was saved, and nothing was), and the way on: no trip to Settings.
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("Your recording didn't reach me.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(notice.getByText("Nothing was saved. Try again, or type it instead.", { exact: true })).toBeVisible();
  await expect(notice).not.toContainText("Settings");
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toEqual([]);
  // The capsule hid and showed no card: the window says it. Nothing records now, so nothing says Esc cancels.
  expect(await capsuleKind(app)).toBe("hidden");
  expect(await sentToCapsule(app)).not.toContain("error");
  await expect(setup.getByText(FREE)).toBeVisible();
  await expect(setup.getByText(ESC)).toHaveCount(0);
  await expect(zel(setup)).toHaveAttribute("data-mood", "needs-you");
  // Try again is the primary; Type it instead is the Notice's, the only button of that name.
  const tryAgain = notice.getByRole("button", { name: "Try again", exact: true });
  await expect(tryAgain).toHaveAttribute("data-variant", "primary");
  await expect(setup.getByRole("button", { name: "Type it instead" })).toHaveCount(1);
  await expect(notice.getByRole("button", { name: "Type it instead" })).toHaveAttribute("data-variant", "secondary");
  await snap(setup, "setup-think-lost");
  await tryAgain.click();
  await expect(notice).toHaveCount(0);
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  await app.close();
});

test("a recording with no words in it says so, and that nothing was saved, which is true", async () => {
  // The words come out empty, as from a recording of silence.
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "   " });
  const app = await launch(env);
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await sayThought(app, setup);
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("I didn't hear any words.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(notice.getByText("Nothing was saved. Try again a little closer to the microphone, or type it instead.", { exact: true })).toBeVisible();
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toEqual([]);
  expect(await capsuleKind(app)).toBe("hidden");
  // Type it instead, in the Notice, opens the box for the thought.
  await notice.getByRole("button", { name: "Type it instead" }).click();
  await expect(setup.getByRole("textbox", { name: "Your thought" })).toBeFocused();
  await app.close();
});

test("a recording whose words can't be made says so, and that nothing was saved, which is true", async () => {
  // The recording can't be read, so no words are made from it, and it is never written to the library.
  const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October" });
  const app = await launch({ ...env, AVANZEL_FAKE_AUDIO: path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-wav-")), "missing.wav") });
  const setup = await throughFound(app);
  const library = path.join(home, "Avanzel");
  await sayThought(app, setup);
  const notice = setup.getByRole("alert");
  await expect(notice.getByText("I couldn't turn your voice into words.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(notice.getByText("Nothing was saved. Try again, or type it instead.", { exact: true })).toBeVisible();
  expect(inbox(library)).toEqual([]);
  expect(filesUnder(library, "raw/audio")).toEqual([]);
  await app.close();
});

test("words slow to come say how long they have taken, from 10 s on", async () => {
  const { env } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October", AVANZEL_AUDIO_TIMEOUT_MS: "60000" });
  const app = await launch(env);
  const setup = await throughFound(app);
  // The audio is held on its way from the capsule, so the words take as long as the test likes. The window's clock is
  // the test's to move.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("capsule:audio");
    ipcMain.handle("capsule:audio", () => undefined);
  });
  await setup.clock.install();
  await sayThought(app, setup);
  await expect(setup.getByText("Turning your voice into text on this Mac…", { exact: true })).toBeVisible();
  await expect(setup.getByText(/^\d+ s$/)).toHaveCount(0);
  await expect(zel(setup)).toHaveAttribute("data-mood", "thinking");
  await setup.clock.fastForward(11_000);
  // The seconds show beside the line, outside the live region: VoiceOver hears the line once, not each second.
  await expect(setup.getByText(/^1\d s$/)).toBeVisible();
  expect(await live(setup)).toEqual(["Turning your voice into text on this Mac…"]);
  await app.close();
});

test("the words are made on this Mac, the step says, unless the library's speech is a command that can run anywhere", async () => {
  for (const command of [false, true]) {
    const { env, home } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October", AVANZEL_AUDIO_TIMEOUT_MS: "60000" });
    if (command) {
      // A library brought from another Mac is there already, and its speech-to-text is the command in its settings.
      const library = path.join(home, "Avanzel");
      await Vault.init(library, { git: true });
      const voice = { backend: "command", model: "", quantization: "", command: ["true"], maxRecordSeconds: 600 };
      saveSettings(library, { ...loadSettings(library), voice });
    }
    const app = await launch(env);
    let setup: Page;
    if (command) {
      // Found offers the library that is there: Use this folder, where a new library has Looks good.
      setup = await windowFor(app, "setup");
      await setup.getByRole("button", { name: "Set me up" }).click();
      await expect(setup.getByText("This folder is already an Avanzel library.")).toBeVisible();
      await expect.poll(async () => (await setupSnap(app)).agent, { timeout: 20_000 }).toBe("claude");
      await setup.getByRole("button", { name: "Use this folder" }).click();
      await expect(setup.getByRole("heading", { name: THINK })).toBeVisible({ timeout: 20_000 });
    } else {
      setup = await throughFound(app);
    }
    // The audio is held on its way from the capsule, so the words take as long as the test likes.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("capsule:audio");
      ipcMain.handle("capsule:audio", () => undefined);
    });
    await sayThought(app, setup);
    await expect(setup.getByText(command ? "Turning your voice into text…" : "Turning your voice into text on this Mac…", { exact: true })).toBeVisible();
    expect((await setupSnap(app)).thought).toMatchObject({ kind: "transcribing", onThisMac: !command });
    expect(await live(setup)).toEqual([command ? "Turning your voice into text…" : "Turning your voice into text on this Mac…"]);
    await app.close();
  }
});

test("each moment of the first thought is one short sentence for VoiceOver, never the prompts", async () => {
  const { env } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Testing, testing.", AVANZEL_AUDIO_TIMEOUT_MS: "60000" });
  const app = await launch(env);
  const setup = await throughFound(app);
  // Asking: the prompts are read as the step is, and nothing is announced.
  await expect(setup.getByText(INSTRUCTION)).toBeVisible();
  expect(await live(setup)).toEqual([]);
  // A press is heard, and the capsule listens: the line that it is listening, and the press test's answer, which came
  // with the press. Not the instructions after them.
  await pressShortcut(app);
  await expect(setup.getByText(LISTENING)).toBeVisible();
  expect(await live(setup)).toEqual(["I'm listening.", "⌥Space is free on this Mac, so it works in every app."]);
  // Its words are made, then answered as a mic check: one sentence each.
  await pressShortcut(app);
  await expect(setup.getByText(HEARD_YOU, { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await live(setup)).toEqual([HEARD_YOU]);
  await app.close();
});

test("Record a thought in the menu records on the first-thought step, but isn't a press of the shortcut", async () => {
  const { env } = spokenRun({ AVANZEL_FAKE_TRANSCRIPT: "Plant tulips in October" });
  const app = await launch(env);
  const setup = await throughFound(app);
  await call(app, "menuAction", "dictate");
  await expect(setup.getByText(LISTENING)).toBeVisible();
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  // Nothing pressed the shortcut, so nothing says it is free.
  await expect(setup.getByText(/is free on this Mac/)).toHaveCount(0);
  await call(app, "menuAction", "dictate"); // Stop recording
  await expect(setup.getByRole("heading", { name: /^All filed\./ })).toBeVisible({ timeout: 30_000 });
  await app.close();
});
