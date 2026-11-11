// A recording's words on the capsule's one panel while they are said. The first test sends audio the whole way, from Chromium's fake capture
// device through the capsule's page to main; the others hand main its blocks (`hearLiveForTests`), since the fake microphone sends none. The
// speech model is AVANZEL_FAKE_TRANSCRIPT, which gives the same words for any audio, and the Mac's side is the fake cursor helper.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Target } from "../src/main/cursor-helper.ts";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { capsuleAtRest, expectInPanel } from "./capsule-helpers.ts";
import { call, capsuleKind, launch, makeLibrary, screenshotFixture, snap, speechWav, windowFor } from "./helpers.ts";

const WORDS = "hello Kowalczyk";
/** One transparent pixel, standing in for an app's icon as the helper gives it: a PNG in base64. */
const ICON = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const slack: Target = {
  app: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap", pid: 501, icon: ICON },
  window: { title: "#general" },
  element: { role: "AXTextArea", secure: false, takesText: "yes" },
};

function fakeCursor(target: Target = slack): { script: string; pasteOut: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "avz-e2e-live-words-"));
  const pasteOut = path.join(dir, "pasted.txt");
  const script = path.join(dir, "cursor.json");
  writeFileSync(script, JSON.stringify({ targets: [target], pasteOut }));
  return { script, pasteOut };
}

const pasted = (pasteOut: string): string => (existsSync(pasteOut) ? readFileSync(pasteOut, "utf8") : "");

async function launchWith(script: string, env: Record<string, string> = {}, library?: string): Promise<{ app: ElectronApplication; capsule: Page }> {
  const app = await launch({
    AVANZEL_LIBRARY: library ?? (await makeLibrary()),
    AVANZEL_FAKE_CURSOR: script,
    AVANZEL_FAKE_AUDIO: speechWav(WORDS),
    AVANZEL_FAKE_TRANSCRIPT: WORDS,
    ...env,
  });
  return { app, capsule: await windowFor(app, "capsule") };
}

/** Starts a dictation and waits until it listens and its session has looked at what has focus. */
async function dictating(app: ElectronApplication): Promise<void> {
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await wait(100);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const heard = (capsule: Page) => capsule.locator(".av-capsule-words");
const wordsInState = async (app: ElectronApplication) => ((await call(app, "capsuleStateForTests")) as { words?: string }).words;

test("the microphone's audio reaches main as it is said: the words show on the panel's glass, with no card, and go when the dictation ends", async () => {
  const { script, pasteOut } = fakeCursor();
  const library = await makeLibrary();
  const app = await launch({ AVANZEL_LIBRARY: library, AVANZEL_FAKE_CURSOR: script, AVANZEL_FAKE_TRANSCRIPT: WORDS }, [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ]);
  const capsule = await windowFor(app, "capsule");
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  const words = heard(capsule).getByText(WORDS, { exact: true });
  await expect(words).toBeVisible({ timeout: 15_000 });
  // One piece of glass: no card of paper, and nothing else above the row.
  await expect(capsule.getByRole("article")).toHaveCount(0);
  await expect(capsule.locator(".stack > *")).toHaveCount(1);
  // None of it is in the row's live region, so a screen reader doesn't read the words out at each change.
  expect(await words.evaluate((el) => el.closest('[role="status"],[aria-live]')?.tagName ?? null)).toBeNull();
  await snap(capsule, "live-words");

  // Words can show from the first moment of audio, and a recording that short has none to paste, so this one runs on a little.
  await wait(1_500);
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await app.close();
});

test("the panel is one row until there are words and grows upward as they come, the row staying where it is and the newest words in view", async () => {
  const { script } = fakeCursor();
  const { app, capsule } = await launchWith(script);
  await dictating(app);
  const row = capsule.getByRole("status");
  const panel = capsule.locator(".stack .av-hud");
  await capsuleAtRest(capsule); // the row's place is its place at rest: the capsule rises in, and grows from 96 %, as it comes up
  const before = (await row.boundingBox())!;
  await expect(heard(capsule)).toHaveCount(0);
  expect((await panel.boundingBox())!.height).toBe(before.height);
  await snap(capsule, "live-words-started");

  await call(app, "hearLiveForTests", 1);
  await expect(heard(capsule).getByText(WORDS, { exact: true })).toBeVisible();
  expect((await panel.boundingBox())!.height).toBeGreaterThan(before.height);
  expect((await row.boundingBox())!.y).toBe(before.y);

  // Each 12 s is settled, and what is said after it follows it.
  await call(app, "hearLiveForTests", 12);
  await expect(heard(capsule).getByText(`${WORDS} ${WORDS}`, { exact: true })).toBeVisible();
  for (let i = 0; i < 24; i++) {
    await call(app, "hearLiveForTests", 12);
    await wait(20);
  }
  await expect.poll(async () => (await wordsInState(app))?.length ?? 0).toBeGreaterThan(300);
  const fit = await capsule.evaluate(() => {
    const room = document.querySelector(".av-capsule-words")!;
    const words = room.firstElementChild!;
    const lineHeight = parseFloat(getComputedStyle(room).lineHeight);
    const of = (element: Element) => element.getBoundingClientRect();
    return {
      // Three lines, and the strip of the fourth that shows there is more above.
      lines: Math.floor(of(room).height / lineHeight),
      overflowsAbove: of(words).top < of(room).top - 1,
      newestAtBottom: Math.abs(of(words).bottom - of(room).bottom) < 1,
      inWindow: of(document.querySelector(".stack")!).top >= 0,
      pointer: getComputedStyle(document.querySelector(".stack")!.lastElementChild!).pointerEvents,
    };
  });
  expect(fit).toEqual({ lines: 3, overflowsAbove: true, newestAtBottom: true, inWindow: true, pointer: "none" });
  expect((await row.boundingBox())!.y).toBe(before.y);
  await snap(capsule, "live-words-long");
  await app.close();
});

test("a dictation shows the app its words are going to in Zel's place, named outside the live region, and an empty place where it has no icon", async () => {
  const withIcon = fakeCursor();
  const first = await launchWith(withIcon.script);
  await dictating(first.app);
  const icon = first.capsule.locator(".av-capsule-app");
  await expect(icon).toBeVisible();
  expect(await icon.getAttribute("src")).toBe(`data:image/png;base64,${ICON}`);
  await expect(first.capsule.locator("svg[data-mood]")).toHaveCount(0);
  // Named for a screen reader that moves onto it, and silent as it changes: nothing speaks over the person, where the microphone would hear it.
  const name = first.capsule.getByText("Dictating into Slack", { exact: true });
  await expect(name).toHaveCount(1);
  expect(await name.evaluate((el) => el.closest('[role="status"],[aria-live]')?.tagName ?? null)).toBeNull();
  await expect(first.capsule.getByRole("status")).not.toContainText("Slack");
  expect(await icon.getAttribute("alt")).toBe("");
  await first.app.close();

  const noIcon = fakeCursor({ ...slack, app: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap", pid: 501 } });
  const second = await launchWith(noIcon.script);
  await dictating(second.app);
  // Zel stands for the library, and these words aren't going there.
  await expect(second.capsule.locator("svg[data-mood]")).toHaveCount(0);
  await expect(second.capsule.locator(".av-capsule-app")).toHaveCount(0);
  await second.app.close();
});

test("the words said so far stay on the panel while the final words are made, with the line in the voice's place, and go when they are pasted", async () => {
  const { script, pasteOut } = fakeCursor();
  const { app, capsule } = await launchWith(script, { AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "1200" });
  await dictating(app);
  await call(app, "hearLiveForTests", 1);
  await expect(heard(capsule).getByText(WORDS, { exact: true })).toBeVisible({ timeout: 10_000 });
  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("transcribing");
  await expect(heard(capsule).getByText(WORDS, { exact: true })).toBeVisible();
  await expect(capsule.getByRole("status").getByText("Transcribing on this Mac…", { exact: true })).toBeVisible();
  await expect(capsule.locator(".av-capsule-app")).toBeVisible();
  await expect(capsule.locator(".av-wave")).toHaveCount(0);
  await snap(capsule, "live-words-finishing");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await expect(heard(capsule)).toHaveCount(0);
  await app.close();
});

const OFF_THE_SCREEN: [string, Target][] = [
  ["a password field", { ...slack, element: { role: "AXTextField", secure: true, takesText: "yes" } }],
  ["an app on the skip list", { ...slack, app: { name: "1Password", bundleId: "com.1password.1password", pid: 502 } }],
];
for (const [where, target] of OFF_THE_SCREEN) {
  test(`in ${where} the words don't show, and still go in`, async () => {
    const { script, pasteOut } = fakeCursor(target);
    const { app, capsule } = await launchWith(script);
    await dictating(app);
    await call(app, "hearLiveForTests", 2);
    await wait(300);
    await expect(heard(capsule)).toHaveCount(0);
    expect(await wordsInState(app)).toBeUndefined();
    await call(app, "pressCursorDictation");
    await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
    await app.close();
  });
}

test("Esc takes the words with it: a recognition still running shows nothing, and the next dictation starts with none", async () => {
  const { script, pasteOut } = fakeCursor();
  const { app, capsule } = await launchWith(script, { AVANZEL_FAKE_TRANSCRIPT_DELAY_MS: "400" });
  await dictating(app);
  await call(app, "hearLiveForTests", 1);
  expect(await call(app, "pressShortcutForTests", "Escape")).toBe(true);
  await expect.poll(() => capsuleKind(app)).toBe("hidden");
  await wait(700);
  expect(await capsuleKind(app)).toBe("hidden");

  await call(app, "pressCursorDictation");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await wait(500);
  await expect(heard(capsule)).toHaveCount(0);
  expect(await wordsInState(app)).toBeUndefined();
  expect(pasted(pasteOut)).toBe("");
  await app.close();
});

test("a thought shows its words too, in place of the first recordings' hint, with Zel, and its buttons still take the pointer", async () => {
  const { script } = fakeCursor();
  const { app, capsule } = await launchWith(script);
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await expect(capsule.getByText("⌥Space to finish, Esc to cancel", { exact: true })).toBeVisible();
  await expect(capsule.locator("svg[data-mood]")).toHaveAttribute("data-mood", "listening");
  await call(app, "hearLiveForTests", 2);
  await expect(heard(capsule).getByText(WORDS, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(capsule.getByText("⌥Space to finish, Esc to cancel", { exact: true })).toHaveCount(0);
  await expect(capsule.locator("svg[data-mood]")).toHaveAttribute("data-mood", "listening");
  // The row's controls (Add, Cancel, Pause and Stop) all take the pointer: the words above them don't let it through to the app below.
  const buttons = capsule.getByRole("status").getByRole("button");
  await expect(capsule.getByRole("status").getByRole("button", { name: /^Stop/ })).toBeVisible();
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    expect(await button.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("auto");
  }
  await snap(capsule, "live-words-thought");
  await app.close();
});

test("a screen comment's screenshot and two lines of its words fit the panel together", async () => {
  const { script } = fakeCursor();
  const { app, capsule } = await launchWith(script);
  const thumbnail = `data:image/png;base64,${readFileSync(screenshotFixture()).toString("base64")}`;
  await call(app, "setCapsule", {
    kind: "listening",
    mode: "comment",
    startedAt: Date.now(),
    fakeMic: true,
    microphoneId: null,
    thumbnail,
    context: { app: "Safari" },
    fileMode: null,
    hint: null,
    review: null,
    words: "This page is the one I meant, and the button at the top of it is the one that does nothing when you press it on the second visit, which is what I keep running into every single time.",
  });
  await expect(capsule.locator(".av-capsule-words")).toHaveAttribute("data-lines", "2");
  await expectInPanel(capsule);
  await snap(capsule, "live-words-comment");
  await app.close();
});

test("a call's row keeps its line whole, and its voice takes the rest of the row, beside the time and Stop", async () => {
  const { script } = fakeCursor();
  const { app, capsule } = await launchWith(script);
  await call(app, "setCapsule", { kind: "listening", mode: "call", startedAt: Date.now(), fakeMic: true, microphoneId: null, fileMode: null, hint: null, review: null });
  const line = capsule.locator(".av-capsule-text");
  await expect(line).toHaveText("Taking notes on the call");
  expect(await line.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // The line is a steady label at the left, and the voice fills what the row leaves after it: as many bars as fit, no fewer than a
  // thought's 24, the last at the room's end, and none under the line or past it.
  const wave = capsule.locator(".av-wave");
  await expect(wave).toHaveAttribute("data-fill", "");
  expect(await capsule.locator(".av-wave > i").count()).toBeGreaterThanOrEqual(24);
  const room = await capsule.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return { line: box(".av-capsule-live"), wave: box(".av-wave"), last: box(".av-wave > i:last-child"), middle: box(".av-capsule-middle") };
  });
  expect(room.wave.left).toBeGreaterThan(room.line.right);
  expect(room.wave.right).toBeCloseTo(room.middle.right, 0);
  expect(room.last.right).toBeCloseTo(room.wave.right, 0);
  await expect(capsule.getByRole("status").getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await app.close();
});

test("a library whose speech-to-text is a command isn't asked once a second, and its words still go in at the end", async () => {
  const { script, pasteOut } = fakeCursor();
  const library = await makeLibrary();
  const settings = loadSettings(library);
  saveSettings(library, { ...settings, voice: { ...settings.voice, backend: "command", model: "", quantization: "", command: ["true"] } });
  const { app, capsule } = await launchWith(script, {}, library);
  await dictating(app);
  await call(app, "hearLiveForTests", 2);
  await wait(300);
  await expect(heard(capsule)).toHaveCount(0);
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await app.close();
});
