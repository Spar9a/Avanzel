// Notes on a call, from the menu: the picker under the menu bar icon, the consent question, the call's card, what a call refuses
// meanwhile, Stop, and a call cut short by a quit that the next launch offers to finish. The call app's side is AVANZEL_FAKE_CALLTAP
// (raw 16 kHz mono s16le, made here from a spoken WAV), which holds until Stop as the helper does; the microphone's is
// AVANZEL_FAKE_AUDIO, and both are heard as AVANZEL_FAKE_TRANSCRIPT. No test opens a real menu or alert: `answerTrayMenus` and
// `answerDialogs` stand in for them.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, readWav, saveSettings } from "../../../packages/engine/src/index.ts";
import type { MenuItemModel } from "../src/main/menu-model.ts";
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

/**
 * From now on, the menus the menu bar icon pops up (`trayChoice`) open nothing: each records its items' labels and picks the one
 * labelled `choice`. Each call starts a new record (`trayMenus`).
 */
async function answerTrayMenus(app: ElectronApplication, choice: string): Promise<void> {
  await app.evaluate(({ Tray }, pick) => {
    const shown: string[][] = [];
    (globalThis as { trayMenus?: string[][] }).trayMenus = shown;
    Tray.prototype.popUpContextMenu = function (menu?: Electron.Menu) {
      shown.push(menu?.items.map((item) => item.label) ?? []);
      menu?.items.find((item) => item.label === pick)?.click();
    };
  }, choice);
}

const trayMenus = (app: ElectronApplication) => app.evaluate(() => (globalThis as { trayMenus?: string[][] }).trayMenus ?? []);

const menuLabels = async (app: ElectronApplication) =>
  ((await call(app, "menuForTests")) as MenuItemModel[]).flatMap((item) => (item.type === "item" ? [item.label] : []));

/**
 * The labels of the menu the tray holds (`MenuBar.menu`, what `refreshMenu` last gave it), not the model built afresh as
 * `menuForTests` does: a menu that wasn't rebuilt after a call settled shows here.
 */
async function heldMenu(app: ElectronApplication): Promise<string[]> {
  await call(app, "capsuleStateForTests"); // the controller is up
  return app.evaluate(() => {
    const controller = (globalThis as unknown as { __avanzel: { menuBar: { menu: { items: { label: string }[] } | null } } }).__avanzel;
    return controller.menuBar.menu?.items.map((item) => item.label) ?? [];
  });
}

/**
 * The tray's menu offers Take notes on a call… again, and not Stop: whatever start or end was under way has settled. Within 3 s, under
 * the 4 s of the saved card, whose hiding builds the menu again: a menu that only that rebuild brought back would pass otherwise.
 */
async function expectReadyMenu(app: ElectronApplication): Promise<void> {
  await expect.poll(async () => (await heldMenu(app)).includes("Take notes on a call…"), { timeout: 3_000 }).toBe(true);
  expect(await heldMenu(app)).not.toContain("Stop taking notes");
}

/** The captures in the inbox whose source is a call. */
const callCaptures = (library: string) =>
  filesUnder(library, "inbox").filter((name) => name.endsWith(".md") && read(library, path.join("inbox", name)).includes("source: call"));

const callFolders = (userData: string) => (existsSync(path.join(userData, "calls")) ? readdirSync(path.join(userData, "calls")) : []);

/** Take notes on a call… in the menu, then Everything this Mac plays in the picker. */
async function takeNotes(app: ElectronApplication): Promise<void> {
  await answerTrayMenus(app, "Everything this Mac plays");
  await call(app, "menuAction", "call-notes");
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
  // The item sits right under Capture screen…; nothing offers Stop yet.
  const before = await menuLabels(app);
  expect(before[before.indexOf("Capture screen…") + 1]).toBe("Take notes on a call…");
  expect(before).not.toContain("Stop taking notes");

  await takeNotes(app);
  const [picker] = await trayMenus(app);
  expect(picker!.at(-1)).toBe("Everything this Mac plays"); // after any call app that runs on this Mac
  await expectCallCard(app, capsule);
  expect(await dialogsAsked(app)).toEqual([]); // consent was given before
  const during = await menuLabels(app);
  expect(during[during.indexOf("Capture screen…") + 1]).toBe("Stop taking notes");
  expect(during).not.toContain("Take notes on a call…");
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

  // Stop taking notes: one capture of source call in the inbox, and the call's folder is gone.
  await call(app, "menuAction", "call-notes-stop");
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
  expect(await heldMenu(app)).not.toContain("Take notes on a call…"); // the call is starting
  // toggleDictate returns once the press was refused or its recording began: no wait is needed to see which.
  await call(app, "toggleDictate");
  expect(await capsuleKind(app)).not.toBe("listening");
  expect(await call(app, "menuForTests")).not.toContainEqual(expect.objectContaining({ label: "Stop recording" }));
  await letDialogsGo(app);
  await expectReadyMenu(app); // Not now ended the start: nothing can begin listening after this
  expect(await capsuleKind(app)).not.toBe("listening");
  expect(callFolders(userData)).toEqual([]);
  await app.close();
});

test("quitting mid-call keeps its folder, and the next launch offers to finish it, once, from a notification and from the menu", async () => {
  const first = await launchForCalls({ consent: true });
  await answerDialogs(first.app, 1);
  await takeNotes(first.app);
  await expectCallCard(first.app, first.capsule);
  await first.app.close(); // a quit mid-call: both sides end, and the folder stays
  const [id] = callFolders(first.userData);
  expect(callFolders(first.userData)).toHaveLength(1);
  expect(callCaptures(first.library)).toEqual([]);
  // A second call cut short, a copy of the first: one is finished from the menu, the other from its notification.
  cpSync(path.join(first.userData, "calls", id!), path.join(first.userData, "calls", `${id}-2`), { recursive: true });

  const { app, library, userData } = await launchForCalls({ consent: true, userData: first.userData, library: first.library });
  const offers = async () => ((await call(app, "notificationsForTests")) as { title: string; body: string }[]).filter((n) => n.title === CUT_SHORT);
  const body = expect.stringMatching(/^The call from .+ was cut short\. Click to finish the notes\. Your recording stays on this Mac until then\.$/);
  await expect.poll(offers).toEqual([
    { title: CUT_SHORT, body },
    { title: CUT_SHORT, body },
  ]);
  expect(callCaptures(library)).toEqual([]); // nothing is filed until the person chooses it
  // The menu offers the row right under Take notes on a call…, and it finishes the oldest.
  await expect.poll(async () => (await heldMenu(app)).includes(CUT_SHORT)).toBe(true);
  const menu = await menuLabels(app);
  expect(menu[menu.indexOf("Take notes on a call…") + 1]).toBe(CUT_SHORT);
  await call(app, "menuAction", "finish-cut-short");
  await expect.poll(() => callCaptures(library), { timeout: 60_000 }).toHaveLength(1);
  await expect.poll(() => callFolders(userData)).toEqual([`${id}-2`]);
  // The other one waits, still offered in the menu; its notification finishes it.
  await expect.poll(async () => (await heldMenu(app)).includes(CUT_SHORT), { timeout: 10_000 }).toBe(true);
  expect(await call(app, "clickNotificationForTests", CUT_SHORT)).toBe(true);
  await expect.poll(() => callCaptures(library), { timeout: 60_000 }).toHaveLength(2);
  await expect.poll(() => callFolders(userData)).toEqual([]);
  await expect.poll(async () => (await heldMenu(app)).includes(CUT_SHORT), { timeout: 10_000 }).toBe(false);
  expect(await offers()).toHaveLength(2);
  await app.close();
});
