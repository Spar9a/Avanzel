// Notes on a call, from the panel's Capture: its list of calls, the consent question, the call's card, what a call refuses
// meanwhile, Stop, and a call cut short by a quit that the next launch offers to finish. The call app's side is AVANZEL_FAKE_CALLTAP
// (raw 16 kHz mono s16le, made here from a spoken WAV), which holds until Stop as the helper does; the microphone's is
// AVANZEL_FAKE_AUDIO, and both are heard as AVANZEL_FAKE_TRANSCRIPT. No test opens a real alert: `answerDialogs` stands in for it.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, readWav, saveSettings } from "../../../packages/engine/src/index.ts";
import { askIsKey, filedInto, onDay } from "./capsule-helpers.ts";
import { answerDialogs, call, capsuleKind, dialogsAsked, filesUnder, launch, letDialogsGo, makeLibrary, read, speechWav, windowFor } from "./helpers.ts";
import { pressShortcut } from "./setup-helpers.ts";

const RUNNING = "Notes on the call are running. Stop them to record a thought.";
const CUT_SHORT = "Finish notes for a call that was cut short";

/** The call app's side of a call: a spoken WAV as raw 16 kHz mono s16le. */
function themPcm(): string {
  const { samples } = readWav(speechWav("Yes, the budget is ready."));
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((x, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), i * 2));
  const file = path.join(mkdtempSync(path.join(tmpdir(), "avz-e2e-call-")), "them.pcm");
  writeFileSync(file, pcm);
  return file;
}

/**
 * Avanzel on a new library whose captures wait in the inbox (the evening file mode), with `callConsent` as given. `userData` may be
 * one an earlier launch used.
 */
async function launchForCalls({ consent, userData, library }: { consent: boolean; userData?: string; library?: string }) {
  const lib = library ?? (await makeLibrary());
  const data = userData ?? mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  if (!userData) writeFileSync(path.join(data, "settings.json"), JSON.stringify({ version: 1, callConsent: consent, fileMode: "evening" }));
  const app = await launch({
    AVANZEL_LIBRARY: lib,
    AVANZEL_USER_DATA: data,
    AVANZEL_FAKE_CALLTAP: themPcm(),
    AVANZEL_FAKE_AUDIO: speechWav("Shall we start with the budget?"),
    AVANZEL_FAKE_TRANSCRIPT: "Shall we start with the budget?",
  });
  return { app, library: lib, userData: data, capsule: await windowFor(app, "capsule") };
}

/** What the panel offers for calls now, and the calls cut short it offers to finish, as main last worked them out. */
const offered = async (app: ElectronApplication) => {
  const snap = (await call(app, "panelSnapshot")) as { callNotesOffer: string; cutShortCalls: number; recording: boolean };
  return { offer: snap.callNotesOffer, cutShort: snap.cutShortCalls, recording: snap.recording };
};

/** The panel's Capture tile for calls: Take notes on a call…, or Stop taking notes while one runs. */
// Named by its label and the line under it: the recording's own Stop taking notes, on the same tab, is named by its label alone.
const callTile = (panel: Page, label: "Take notes on a call…" | "Stop taking notes") => panel.getByRole("button", { name: new RegExp(`^${label} `) });

/**
 * Take notes on a call… is offered again, and not Stop: whatever start or end was under way has settled. Within 3 s, under the 4 s of
 * the saved card, whose hiding works the panel's state out again: an offer that only that brought back would pass otherwise. Then the
 * panel, opened on Capture, shows it.
 */
async function expectReadyMenu(app: ElectronApplication): Promise<void> {
  await expect.poll(async () => (await offered(app)).offer, { timeout: 3_000 }).toBe("ready");
  await call(app, "showPanel", "capture");
  const panel = await windowFor(app, "panel");
  await expect(callTile(panel, "Take notes on a call…")).toBeVisible();
  // None that can be pressed: the recording's own, gone with it, is still in the page, out of reach (inert) as it leaves.
  await expect(panel.getByRole("button", { name: /^Stop taking notes/ }).and(panel.locator(":not([inert] *)"))).toHaveCount(0);
}

/** The captures in the inbox whose source is a call. */
const callCaptures = (library: string) =>
  filesUnder(library, "inbox").filter((name) => name.endsWith(".md") && read(library, path.join("inbox", name)).includes("source: call"));

const callFolders = (userData: string) => (existsSync(path.join(userData, "calls")) ? readdirSync(path.join(userData, "calls")) : []);

/**
 * Take notes on a call… on the panel's Capture, then Everything this Mac plays, the last of the calls it offers, after any call app that
 * runs on this Mac. Gives the panel.
 */
async function takeNotes(app: ElectronApplication): Promise<Page> {
  await call(app, "showPanel", "capture");
  const panel = await windowFor(app, "panel");
  const tile = callTile(panel, "Take notes on a call…");
  await tile.click();
  const choices = panel.locator(`[id="${await tile.getAttribute("aria-controls")}"]`);
  await expect(choices.getByRole("button").last()).toHaveText("Everything this Mac plays");
  await choices.getByRole("button", { name: "Everything this Mac plays", exact: true }).click();
  return panel;
}

/** The call's card is up: its line, its time, and Stop. */
async function expectCallCard(app: ElectronApplication, capsule: Awaited<ReturnType<typeof windowFor>>): Promise<void> {
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 15_000 }).toMatchObject({ kind: "listening", mode: "call" });
  await expect(capsule.getByText("Taking notes on the call", { exact: true })).toBeVisible();
  await expect(capsule.getByText(/^\d+:\d\d$/)).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
}

test("Take notes on a call… with Everything this Mac plays: the call's card, what it refuses meanwhile, and Stop files one call capture", async () => {
  // A dictionary whose heard-as entry corrects the call's words, and a term that only sounds like one of them, which a call leaves.
  const dictionaryLibrary = await makeLibrary();
  const settings = loadSettings(dictionaryLibrary);
  saveSettings(dictionaryLibrary, { ...settings, voice: { ...settings.voice, dictionary: ["Budget Plan = budget", "Stahrt"] } });
  const { app, library, userData, capsule } = await launchForCalls({ consent: true, library: dictionaryLibrary });
  filedInto(library, "ideas", "tulips", "Plant tulips in October", onDay(0)); // a page, so ⌥Space in Ask records a question
  await answerDialogs(app, 1);
  // Nothing offers Stop yet.
  expect((await offered(app)).offer).toBe("ready");

  const panel = await takeNotes(app);
  await expectCallCard(app, capsule);
  expect(await dialogsAsked(app)).toEqual([]); // consent was given before
  expect((await offered(app)).offer).toBe("running");
  // Capture shows the call as it is recorded, over its tiles, with Stop taking notes.
  await call(app, "showPanel", "capture");
  const live = panel.getByRole("group", { name: "Taking notes on a call", exact: true });
  await expect(live.getByRole("button", { name: "Stop taking notes", exact: true })).toBeVisible();
  await expect(callTile(panel, "Take notes on a call…")).toHaveCount(0);
  expect(callFolders(userData)).toHaveLength(1);

  // Record a thought, Capture screen and Ask's ⌥Space each show the notice, and the call's card comes back.
  for (const press of [
    () => call(app, "toggleDictate"),
    () => call(app, "toggleCapture"),
    async () => {
      await call(app, "openAsk");
      await windowFor(app, "ask");
      await askIsKey(app, true);
      await pressShortcut(app);
    },
  ]) {
    await press();
    await expect.poll(() => capsuleKind(app)).toBe("call-running");
    await expect(capsule.getByText(RUNNING, { exact: true })).toBeVisible();
    await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 10_000 }).toMatchObject({ kind: "listening", mode: "call" });
  }
  // Esc and Hide (the capsule's dismiss) don't end the call: its card stays.
  await call(app, "dismiss");
  expect(await call(app, "pressShortcutForTests", "Escape")).toBe(false); // no Esc is registered for a call
  await expectCallCard(app, capsule);
  expect(callFolders(userData)).toHaveLength(1);
  expect(callCaptures(library)).toEqual([]);

  // Stop taking notes, on the panel: one capture of source call in the inbox, and the call's folder is gone.
  await call(app, "showPanel", "capture");
  await live.getByRole("button", { name: "Stop taking notes", exact: true }).click();
  await expect.poll(() => callCaptures(library), { timeout: 60_000 }).toHaveLength(1);
  // Both sides went through the heard-as entry, and not the sound-alike match ("start" sounds like Stahrt).
  const transcript = read(library, path.join("inbox", callCaptures(library)[0]!));
  expect(transcript).toContain("Shall we start with the Budget Plan?");
  expect(transcript).not.toContain("budget?");
  await expect.poll(() => callFolders(userData)).toEqual([]);
  await expectReadyMenu(app);
  await app.close();
});

test("the first call asks for consent: Not now writes nothing, Take notes starts the call and is remembered", async () => {
  const { app, library, userData, capsule } = await launchForCalls({ consent: false });
  await answerDialogs(app, 1); // Not now
  await takeNotes(app);
  await expect.poll(async () => (await dialogsAsked(app)).length).toBe(1);
  const [asked] = await dialogsAsked(app);
  expect(asked!.options).toMatchObject({ message: "Take notes on a call?", buttons: ["Take notes", "Not now"], defaultId: 1, cancelId: 1 });
  await expectReadyMenu(app); // the start has ended: nothing can begin listening after this
  expect(await capsuleKind(app)).not.toBe("listening");
  expect(callFolders(userData)).toEqual([]);
  expect(JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8")).callConsent).toBe(false);

  await answerDialogs(app, 0); // Take notes
  await takeNotes(app);
  await expectCallCard(app, capsule);
  expect(JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8")).callConsent).toBe(true);
  await call(app, "stopCallNotes");
  await expect.poll(() => callCaptures(library), { timeout: 60_000 }).toHaveLength(1);
  await expectReadyMenu(app);
  // Asked once: the next call starts without the question.
  await answerDialogs(app, 1);
  await takeNotes(app);
  await expectCallCard(app, capsule);
  expect(await dialogsAsked(app)).toEqual([]);
  await call(app, "stopCallNotes");
  await expect.poll(() => callCaptures(library), { timeout: 60_000 }).toHaveLength(2);
  await expectReadyMenu(app);
  await app.close();
});

test("a thought pressed while the consent question is up starts nothing, and neither does the call on Not now", async () => {
  const { app, userData } = await launchForCalls({ consent: false });
  await answerDialogs(app, 1, { hold: true });
  await takeNotes(app);
  await expect.poll(async () => (await dialogsAsked(app)).length).toBe(1);
  expect((await offered(app)).offer).not.toBe("ready"); // the call is starting
  // toggleDictate returns once the press was refused or its recording began: no wait is needed to see which.
  await call(app, "toggleDictate");
  expect(await capsuleKind(app)).not.toBe("listening");
  expect((await offered(app)).recording).toBe(false);
  await letDialogsGo(app);
  await expectReadyMenu(app); // Not now ended the start: nothing can begin listening after this
  expect(await capsuleKind(app)).not.toBe("listening");
  expect(callFolders(userData)).toEqual([]);
  await app.close();
});

test("quitting mid-call keeps its folder, and the next launch offers to finish it, once, from a notification and from the panel", async () => {
  const first = await launchForCalls({ consent: true });
  await answerDialogs(first.app, 1);
  await takeNotes(first.app);
  await expectCallCard(first.app, first.capsule);
  await first.app.close(); // a quit mid-call: both sides end, and the folder stays
  const [id] = callFolders(first.userData);
  expect(callFolders(first.userData)).toHaveLength(1);
  expect(callCaptures(first.library)).toEqual([]);
  // A second call cut short, a copy of the first: one is finished from the panel, the other from its notification.
  cpSync(path.join(first.userData, "calls", id!), path.join(first.userData, "calls", `${id}-2`), { recursive: true });

  const { app, library, userData } = await launchForCalls({ consent: true, userData: first.userData, library: first.library });
  const offers = async () => ((await call(app, "notificationsForTests")) as { title: string; body: string }[]).filter((n) => n.title === CUT_SHORT);
  const body = expect.stringMatching(/^The call from .+ was cut short\. Click to finish the notes\. Your recording stays on this Mac until then\.$/);
  await expect.poll(offers).toEqual([
    { title: CUT_SHORT, body },
    { title: CUT_SHORT, body },
  ]);
  expect(callCaptures(library)).toEqual([]); // nothing is filed until the person chooses it
  // The panel offers to finish them, on Capture, and its button finishes the oldest.
  await expect.poll(async () => (await offered(app)).cutShort).toBe(2);
  await call(app, "showPanel", "capture");
  const panel = await windowFor(app, "panel");
  await panel.getByRole("button", { name: CUT_SHORT, exact: true }).click();
  await expect.poll(() => callCaptures(library), { timeout: 60_000 }).toHaveLength(1);
  await expect.poll(() => callFolders(userData)).toEqual([`${id}-2`]);
  // The other one waits, still offered in the panel; its notification finishes it.
  await expect.poll(async () => (await offered(app)).cutShort, { timeout: 10_000 }).toBe(1);
  await expect(panel.getByRole("button", { name: CUT_SHORT, exact: true })).toBeVisible();
  expect(await call(app, "clickNotificationForTests", CUT_SHORT)).toBe(true);
  await expect.poll(() => callCaptures(library), { timeout: 60_000 }).toHaveLength(2);
  await expect.poll(() => callFolders(userData)).toEqual([]);
  await expect.poll(async () => (await offered(app)).cutShort, { timeout: 10_000 }).toBe(0);
  // The panel went as its notification was clicked; opened again, it offers none.
  await call(app, "showPanel", "capture");
  await expect(panel.getByRole("button", { name: CUT_SHORT, exact: true })).toHaveCount(0);
  expect(await offers()).toHaveLength(2);
  await app.close();
});
