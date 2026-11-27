// The offer of call notes: when an app other than Avanzel has held the microphone for 5 s, the capsule asks whether to take notes on
// the call, with Not now and Take notes. Who holds the microphone is given by `micHoldersForTests`, as the watcher will report it; the
// call itself is AVANZEL_FAKE_CALLTAP and AVANZEL_FAKE_AUDIO, heard as AVANZEL_FAKE_TRANSCRIPT, as in call-notes.spec.ts.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readWav } from "../../../packages/engine/src/index.ts";
import { call, filesUnder, launch, makeLibrary, read, speechWav, windowFor } from "./helpers.ts";

const ASKED = "Zoom is using the microphone. Take notes on this call?";

/** Zoom, holding the microphone, as the watcher reports it. */
const ZOOM = { pid: 4242, bundle: "us.zoom.xos", appPid: 4242, app: "Zoom", path: null };

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
 * Avanzel on a new library whose captures wait in the inbox (the evening file mode), with consent to call notes given, as
 * call-notes.spec.ts launches it. Its own config folder keeps the owner's `~/.config/avanzel` out of reach. Waits until call notes
 * could start, which the offer needs before it asks.
 */
async function launchForCalls() {
  const library = await makeLibrary();
  const userData = mkdtempSync(path.join(tmpdir(), "avz-e2e-data-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ version: 1, callConsent: true, fileMode: "evening" }));
  const app = await launch({
    AVANZEL_LIBRARY: library,
    AVANZEL_USER_DATA: userData,
    XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "avz-e2e-config-")),
    AVANZEL_FAKE_CALLTAP: themPcm(),
    AVANZEL_FAKE_AUDIO: speechWav("Shall we start with the budget?"),
    AVANZEL_FAKE_TRANSCRIPT: "Shall we start with the budget?",
  });
  const capsule = await windowFor(app, "capsule");
  await expect.poll(async () => ((await call(app, "panelSnapshot")) as { callNotesOffer: string }).callNotesOffer, { timeout: 15_000 }).toBe("ready");
  return { app, library, userData, capsule };
}

const capsuleState = (app: ElectronApplication) => call(app, "capsuleStateForTests") as Promise<{ kind: string }>;

/** The captures in the inbox whose source is a call. */
const callCaptures = (library: string) =>
  filesUnder(library, "inbox").filter((name) => name.endsWith(".md") && read(library, path.join("inbox", name)).includes("source: call"));

/** The call's card is up: its line, its time, and Stop. */
async function expectCallCard(app: ElectronApplication, capsule: Awaited<ReturnType<typeof windowFor>>): Promise<void> {
  await expect.poll(() => call(app, "capsuleStateForTests"), { timeout: 15_000 }).toMatchObject({ kind: "listening", mode: "call" });
  await expect(capsule.getByText("Taking notes on the call", { exact: true })).toBeVisible();
  await expect(capsule.getByText(/^\d+:\d\d$/)).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
}

/** Waits `ms`, for a question that must not come: past the 5 s an app holds the microphone before it is asked about. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("an app that holds the microphone is asked about after 5 s; Take notes starts the call with that app's name", async () => {
  const { app, library, capsule } = await launchForCalls();
  await call(app, "micHoldersForTests", [ZOOM]);
  await expect.poll(() => capsuleState(app), { timeout: 15_000 }).toMatchObject({ kind: "call-offer", app: "Zoom" });
  await expect(capsule.getByText(ASKED, { exact: true })).toBeVisible();
  await expect(capsule.getByRole("button", { name: "Not now", exact: true })).toBeVisible();

  await capsule.getByRole("button", { name: "Take notes", exact: true }).click();
  await expectCallCard(app, capsule);
  await capsule.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => callCaptures(library), { timeout: 60_000 }).toHaveLength(1);
  expect(read(library, path.join("inbox", callCaptures(library)[0]!))).toMatch(/^app: Zoom$/m);
  await app.close();
});

test("Not now hides it, and it isn't asked again while the app holds the microphone", async () => {
  const { app, capsule } = await launchForCalls();
  await call(app, "micHoldersForTests", [ZOOM]);
  await expect.poll(() => capsuleState(app), { timeout: 15_000 }).toMatchObject({ kind: "call-offer", app: "Zoom" });

  await capsule.getByRole("button", { name: "Not now", exact: true }).click();
  await expect.poll(() => capsuleState(app)).toMatchObject({ kind: "hidden" });
  await call(app, "micHoldersForTests", [ZOOM]);
  await wait(6_000);
  expect(await capsuleState(app)).toMatchObject({ kind: "hidden" });
  await app.close();
});

test("nothing is asked while a call runs, nor after its Stop while the app still holds the microphone", async () => {
  const { app, capsule } = await launchForCalls();
  await call(app, "startCallNotes");
  await expectCallCard(app, capsule);
  await call(app, "micHoldersForTests", [ZOOM]);
  await wait(6_000);
  expect((await capsuleState(app)).kind).not.toBe("call-offer");

  await call(app, "stopCallNotes");
  await wait(6_000);
  expect((await capsuleState(app)).kind).not.toBe("call-offer");
  await app.close();
});

test("nothing is asked about Avanzel's own processes", async () => {
  const { app } = await launchForCalls();
  const own = await app.evaluate(() => process.pid);
  await call(app, "micHoldersForTests", [{ ...ZOOM, pid: own }]);
  await wait(6_000);
  expect(await capsuleState(app)).toMatchObject({ kind: "hidden" });
  await app.close();
});
