// A dictation's words on the capsule while they are said. The first test sends audio the whole way, from Chromium's fake capture device
// through the capsule's page to main; the others hand main its blocks (`hearLiveForTests`), since the fake microphone sends none. The
// speech model is AVANZEL_FAKE_TRANSCRIPT, which gives the same words for any audio, and the Mac's side is the fake cursor helper.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Target } from "../src/main/cursor-helper.ts";
import { loadSettings, saveSettings } from "../../../packages/engine/src/index.ts";
import { call, capsuleKind, launch, makeLibrary, snap, speechWav, windowFor } from "./helpers.ts";

const WORDS = "hello Kowalczyk";

const slack: Target = {
  app: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap", pid: 501 },
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
const liveWords = (capsule: Page) => capsule.locator(".live-words");
const wordsInState = async (app: ElectronApplication) => ((await call(app, "capsuleStateForTests")) as { dictation?: { words?: string } }).dictation?.words;

test("the microphone's audio reaches main as it is said: the words show on a card above the bar, and go when the dictation ends", async () => {
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
  const words = liveWords(capsule).getByText(WORDS, { exact: true });
  await expect(words).toBeVisible({ timeout: 15_000 });
  await expect(liveWords(capsule).getByText("Dictation", { exact: true })).toBeVisible();
  await expect(liveWords(capsule).getByText("Preview", { exact: true })).toBeVisible();
  // The card and the bar are all there is: no line on how a dictation ends takes room above the bar.
  await expect(capsule.locator(".hint")).toHaveCount(0);
  expect(await capsule.evaluate(() => document.querySelector(".stack")!.children.length)).toBe(2);
  // None of it is in the bar's live region, so a screen reader doesn't read the words out at each change.
  expect(await words.evaluate((el) => el.closest('[role="status"],[aria-live]')?.tagName ?? null)).toBeNull();
  await snap(capsule, "live-words");

  // Words can show from the first moment of audio, and a recording that short has none to paste, so this one runs on a little.
  await wait(1_500);
  await call(app, "pressCursorDictation");
  await expect(liveWords(capsule)).toHaveCount(0);
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await app.close();
});

test("the words grow on the card as more is said, and the newest stay in view when they no longer fit", async () => {
  const { script } = fakeCursor();
  const { app, capsule } = await launchWith(script);
  await dictating(app);
  // Until there are words, the bar is all there is.
  await expect(liveWords(capsule)).toHaveCount(0);
  await expect(capsule.locator(".hint")).toHaveCount(0);
  expect(await capsule.evaluate(() => document.querySelector(".stack")!.children.length)).toBe(1);
  await call(app, "hearLiveForTests", 1);
  await expect(liveWords(capsule).getByText(WORDS, { exact: true })).toBeVisible();

  // Each 12 s is settled, and what is said after it follows it.
  await call(app, "hearLiveForTests", 12);
  await expect(liveWords(capsule).getByText(`${WORDS} ${WORDS}`, { exact: true })).toBeVisible();
  for (let i = 0; i < 24; i++) {
    await call(app, "hearLiveForTests", 12);
    await wait(20);
  }
  await expect.poll(async () => (await wordsInState(app))?.length ?? 0).toBeGreaterThan(300);
  const fit = await capsule.evaluate(() => {
    const clip = document.querySelector(".words.latest")!;
    const words = clip.firstElementChild!;
    const lineHeight = parseFloat(getComputedStyle(clip).lineHeight);
    const of = (element: Element) => element.getBoundingClientRect();
    return {
      lines: of(clip).height / lineHeight,
      overflowsAbove: of(words).top < of(clip).top - 1,
      newestAtBottom: Math.abs(of(words).bottom - of(clip).bottom) < 1,
      cardInPanel: of(document.querySelector(".live-words")!).top >= 0,
      pointerOnCard: getComputedStyle(document.querySelector(".live-words")!).pointerEvents,
      pointerOnBar: getComputedStyle(document.querySelector(".stack")!.lastElementChild!).pointerEvents,
    };
  });
  expect(fit).toEqual({ lines: 4, overflowsAbove: true, newestAtBottom: true, cardInPanel: true, pointerOnCard: "none", pointerOnBar: "auto" });
  await snap(capsule, "live-words-long");
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
    await expect(liveWords(capsule)).toHaveCount(0);
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
  await expect(liveWords(capsule)).toHaveCount(0);
  expect(await wordsInState(app)).toBeUndefined();
  expect(pasted(pasteOut)).toBe("");
  await app.close();
});

test("a thought that is recorded shows no words as it is said", async () => {
  const { script } = fakeCursor();
  const { app, capsule } = await launchWith(script);
  await call(app, "setCursorDictation", { enabled: true });
  await call(app, "toggleDictate");
  await expect.poll(() => capsuleKind(app)).toBe("listening");
  await call(app, "hearLiveForTests", 2);
  await wait(300);
  await expect(liveWords(capsule)).toHaveCount(0);
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
  await expect(liveWords(capsule)).toHaveCount(0);
  await call(app, "pressCursorDictation");
  await expect.poll(() => pasted(pasteOut), { timeout: 30_000 }).toBe(WORDS);
  await app.close();
});
