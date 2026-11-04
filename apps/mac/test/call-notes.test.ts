import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSettings, Librarian, Vault, type TimedText, type Transcriber } from "@avanzel/engine";
import { CALL_RUNNING_LINE } from "../src/shared/transcribing.ts";
import { CALL_CONSENT_DIALOG, CallNotes, isNoSpeechFolder, THEM_NOT_HEARD, type CallHost, type Tap } from "../src/main/call-notes.ts";
import type { TapEvent } from "../src/main/calltap.ts";

const RATE = 16_000;
const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-notes-"));

/** `seconds` of a constant `level`, as floats (the microphone's blocks) or as s16le bytes (the tap's file). */
const floats = (seconds: number, level: number) => new Float32Array(Math.round(seconds * RATE)).fill(level);
const pcm = (seconds: number, level: number) => Buffer.from(new Int16Array(Math.round(seconds * RATE)).fill(Math.round(level * 32767)).buffer);

/** Tells the streams apart by their level: the microphone is the louder one here. */
const transcriber: Transcriber = {
  engine: "fake",
  async transcribe() {
    throw new Error("segments only");
  },
  async transcribeSegments(samples): Promise<TimedText[]> {
    return Math.max(...samples.slice(0, 100)) > 0.3
      ? [{ start: 0, end: 1, text: "Shall we start with the budget?" }]
      : [{ start: 2, end: 3, text: "Yes, the budget is ready." }];
  },
};

/** A stand-in helper: it writes `them` to its file as it starts, and the test says what it reports (`emit`). */
class FakeTap implements Tap {
  stopped = false;
  constructor(readonly opts: { pids: number[]; outFile: string; onEvent(e: TapEvent): void }, private readonly them: Buffer) {}
  start(): void {
    writeFileSync(this.opts.outFile, this.them);
    this.opts.onEvent({ event: "started" });
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
  emit(e: TapEvent): void {
    this.opts.onEvent(e);
  }
}

interface Options {
  consent?: boolean;
  answer?: boolean;
  them?: Buffer;
  maxCallMs?: number;
  audioTimeoutMs?: number;
  /** The capsule page answers a stop with its last block (false: it never does, and the wait times out). */
  answerStop?: boolean;
  speech?: Transcriber;
}

async function setup({ consent = true, answer = true, them = pcm(4, 0.1), maxCallMs = 60_000, audioTimeoutMs = 1_000, answerStop = true, speech = transcriber }: Options = {}) {
  const root = tmp();
  const vault = await Vault.init(path.join(root, "lib"), { git: false });
  const librarian = new Librarian(vault, defaultSettings());
  const log: string[] = [];
  const taps: FakeTap[] = [];
  const filed: { path: string; text: string }[] = [];
  const failed: { title: string; body: string; action?: string; actionLabel?: string }[] = [];
  let consented = consent;
  let calls!: CallNotes;
  /** The ids the call-start commands carried, in order. */
  const micIds: number[] = [];
  const state = { recording: false };
  const host: CallHost = {
    callsDir: path.join(root, "calls"),
    audioTimeoutMs,
    maxCallMs,
    tapAvailable: () => true,
    consented: () => consented,
    async askConsent() {
      log.push("asked");
      if (answer) consented = true;
      return answer;
    },
    readyToListen: async () => true,
    recording: () => state.recording,
    newTap(opts) {
      const tap = new FakeTap(opts, them);
      taps.push(tap);
      return tap;
    },
    transcriber: async () => speech,
    captureCall: async (call) => librarian.captureCall(call).path,
    listening: (startedAt) => log.push(`listening ${typeof startedAt}`),
    microphone(on, call) {
      log.push(on ? "mic on" : "mic off");
      if (on) micIds.push(call);
      // The capsule page answers a stop with what it still holds.
      if (!on && answerStop) queueMicrotask(() => calls.audio(call, floats(0.5, 0.5), true));
    },
    refused: () => log.push("refused"),
    finishing: () => log.push("finishing"),
    filed: (capturePath, text) => filed.push({ path: capturePath, text }),
    failed: (problem, action, actionLabel) => failed.push({ ...problem, ...(action ? { action } : {}), ...(actionLabel ? { actionLabel } : {}) }),
    changed: () => undefined,
  };
  calls = new CallNotes(host);
  const inbox = () => readdirSync(vault.inbox).filter((name) => name.endsWith(".md"));
  /** A block of the newest call's microphone, as the capsule page sends it. */
  const mic = (samples: Float32Array, last = false) => calls.audio(micIds.at(-1)!, samples, last);
  /** The folder of the only call on disk. */
  const callDir = () => path.join(host.callsDir, readdirSync(host.callsDir)[0]!);
  return { calls, host, log, taps, filed, failed, vault, inbox, callsDir: host.callsDir, consented: () => consented, micIds, mic, callDir, state };
}

const zoom = { name: "zoom.us", pids: [101, 102] };

describe("call notes", () => {
  it("asks for consent first, and does nothing on Not now", async () => {
    const t = await setup({ consent: false, answer: false });
    expect(await t.calls.start(zoom)).toBe(false);
    expect(t.log).toEqual(["asked"]);
    expect(t.taps).toHaveLength(0);
    expect(t.calls.running).toBe(false);
    expect(existsSync(t.callsDir)).toBe(false);
    expect(t.consented()).toBe(false);
  });

  it("asks once: after Take notes it starts, and the next call is not asked", async () => {
    const t = await setup({ consent: false, answer: true });
    expect(await t.calls.start(zoom)).toBe(true);
    await t.calls.stop();
    expect(await t.calls.start("everything")).toBe(true);
    expect(t.log.filter((line) => line === "asked")).toHaveLength(1);
  });

  it("the consent dialog says what the brief fixes, with Not now the default", () => {
    expect(CALL_CONSENT_DIALOG.message).toBe("Take notes on a call?");
    expect(CALL_CONSENT_DIALOG.detail).toBe(
      [
        "In many places everyone on a call must agree to it being recorded, and some workplaces forbid recording tools. Tell the people on the call.",
        "Avanzel hears both sides on this Mac and turns them into text here. It never joins the call.",
        "When the notes are filed, the text, including other people's words, goes to your agent.",
      ].join("\n\n"),
    );
    expect(CALL_CONSENT_DIALOG.buttons).toEqual(["Take notes", "Not now"]);
    expect(CALL_CONSENT_DIALOG.defaultId).toBe(1);
    expect(CALL_CONSENT_DIALOG.cancelId).toBe(1);
  });

  it("with consent, starts the tap on the app's pids and the microphone, and shows the call's listening card", async () => {
    const t = await setup();
    expect(await t.calls.start(zoom)).toBe(true);
    expect(t.calls.running).toBe(true);
    expect(t.taps).toHaveLength(1);
    expect(t.taps[0]!.opts.pids).toEqual([101, 102]);
    expect(t.log).toEqual(["listening number", "mic on"]);
    const [dir] = readdirSync(t.callsDir);
    expect(JSON.parse(readFileSync(path.join(t.callsDir, dir!, "call.json"), "utf8")).app).toBe("zoom.us");
  });

  it("refuses a second call while one runs", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    expect(await t.calls.start("everything")).toBe(false);
    expect(t.taps).toHaveLength(1);
    expect(readdirSync(t.callsDir)).toHaveLength(1);
  });

  it("Stop writes one capture of source call in the inbox, removes calls/<id>/, and files it as a thought is", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    await t.calls.stop();
    expect(t.taps[0]!.stopped).toBe(true);
    expect(t.calls.running).toBe(false);
    expect(t.inbox()).toHaveLength(1);
    const note = readFileSync(path.join(t.vault.inbox, t.inbox()[0]!), "utf8");
    expect(note).toContain("source: call");
    expect(note).toContain("Shall we start with the budget?");
    expect(note).toContain("Yes, the budget is ready.");
    expect(readdirSync(t.callsDir)).toEqual([]);
    expect(t.filed).toHaveLength(1);
    expect(t.filed[0]!.path).toBe(path.join(t.vault.inbox, t.inbox()[0]!));
    expect(t.log).toContain("mic off");
    expect(t.log).toContain("finishing");
  });

  it("puts the not-heard line first when the other side is silent", async () => {
    const t = await setup({ them: pcm(4, 0) });
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    await t.calls.stop();
    const text = t.filed[0]!.text;
    expect(text.split("\n")[0]).toBe(THEM_NOT_HEARD);
    expect(THEM_NOT_HEARD).toBe("The other side of this call wasn't heard. System Audio Recording may be off for Avanzel.");
    expect(text).toContain("Shall we start with the budget?");
  });

  it("ends the call with what was heard when the helper stops by itself (the app quit)", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    t.taps[0]!.emit({ event: "stopped", seconds: 4 });
    await t.calls.settled();
    expect(t.calls.running).toBe(false);
    expect(t.inbox()).toHaveLength(1);
    expect(t.filed).toHaveLength(1);
    expect(t.failed).toEqual([]);
  });

  it("ends a call that reaches its length as Stop does", async () => {
    const t = await setup({ maxCallMs: 30 });
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await t.calls.settled();
    expect(t.calls.running).toBe(false);
    expect(t.inbox()).toHaveLength(1);
  });

  it("a helper that fails mid-call ends the call, keeps what was heard, and Finish the notes makes the capture", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    t.taps[0]!.emit({ event: "error", message: "avanzel-calltap ended unexpectedly" });
    await t.calls.settled();
    expect(t.calls.running).toBe(false);
    expect(t.failed).toEqual([
      {
        title: "The other side of the call stopped being heard.",
        body: "What was heard so far is safe on this Mac.",
        action: "finish-call",
        actionLabel: "Finish the notes",
      },
    ]);
    expect(readdirSync(t.callsDir)).toHaveLength(1);
    expect(t.inbox()).toHaveLength(0);
    await t.calls.finishKept();
    expect(t.inbox()).toHaveLength(1);
    expect(readdirSync(t.callsDir)).toEqual([]);
  });

  it("a finish that fails keeps the folder and offers Try again, which finishes it", async () => {
    const t = await setup();
    let broken = true;
    const real = t.host.captureCall;
    t.host.captureCall = async (call) => {
      if (broken) throw new Error("disk full");
      return real(call);
    };
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    await t.calls.stop();
    expect(t.failed).toEqual([
      {
        title: "The call's notes couldn't be made.",
        body: "The recording is safe on this Mac and nothing was changed in your library.",
        action: "finish-call",
        actionLabel: "Try again",
      },
    ]);
    expect(readdirSync(t.callsDir)).toHaveLength(1);
    broken = false;
    await t.calls.finishKept();
    expect(t.inbox()).toHaveLength(1);
    expect(readdirSync(t.callsDir)).toEqual([]);
  });

  it("finishes a leftover folder, as recovery will", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    await t.calls.leave(); // Avanzel quits mid-call: the folder stays
    const [id] = readdirSync(t.callsDir);
    expect(t.inbox()).toHaveLength(0);
    await t.calls.finishCallFolder(path.join(t.callsDir, id!));
    expect(t.inbox()).toHaveLength(1);
    expect(readdirSync(t.callsDir)).toEqual([]);
  });

  it("refuses a thought while the call runs, with the notice, and the call's microphone file keeps growing", async () => {
    const t = await setup();
    expect(t.calls.refuse()).toBe(false); // the guard of a thought's start: with no call it lets the thought start
    await t.calls.start(zoom);
    t.mic(floats(1, 0.5), false);
    const [id] = readdirSync(t.callsDir);
    const you = path.join(t.callsDir, id!, "you.pcm");
    const before = statSync(you).size;
    expect(t.calls.refuse()).toBe(true);
    expect(t.log.filter((line) => line === "refused")).toHaveLength(1);
    expect(CALL_RUNNING_LINE).toBe("Notes on the call are running. Stop them to record a thought.");
    expect(t.log.filter((line) => line === "mic on")).toHaveLength(1); // no second recorder
    t.mic(floats(1, 0.5), false);
    expect(statSync(you).size).toBeGreaterThan(before);
    await t.calls.stop();
    expect(t.calls.refuse()).toBe(false);
  });

  it("aborts a start when a thought began recording while the consent question was up", async () => {
    const t = await setup({ consent: false, answer: true });
    t.host.askConsent = async () => {
      t.state.recording = true; // Record a thought was pressed meanwhile
      return true;
    };
    expect(await t.calls.start(zoom)).toBe(false);
    expect(t.taps).toHaveLength(0);
    expect(t.log).not.toContain("mic on");
    expect(existsSync(t.callsDir)).toBe(false);
    expect(t.calls.running).toBe(false);
  });

  it("refuses a start while another is in flight, and holds a thought back quietly meanwhile", async () => {
    const t = await setup({ consent: false });
    let answer!: (yes: boolean) => void;
    t.host.askConsent = () => new Promise((resolve) => (answer = resolve));
    const first = t.calls.start(zoom);
    expect(await t.calls.start("everything")).toBe(false);
    expect(t.calls.refuse()).toBe(true); // a thought doesn't start while a call is starting
    expect(t.log).not.toContain("refused"); // and no notice says a call runs: none does yet
    answer(true);
    expect(await first).toBe(true);
    expect(t.taps).toHaveLength(1);
  });

  it("refuses a start while the last call is still being finished", async () => {
    let release!: () => void;
    const slow: Transcriber = {
      ...transcriber,
      async transcribeSegments(samples, rate) {
        await new Promise<void>((resolve) => (release = resolve));
        release = () => undefined;
        return transcriber.transcribeSegments!(samples, rate);
      },
    };
    const t = await setup({ speech: slow });
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5));
    const stopping = t.calls.stop();
    while (!t.log.includes("finishing")) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await t.calls.start("everything")).toBe(false);
    expect(t.taps).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      release();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await stopping;
    expect(t.inbox()).toHaveLength(1);
    expect(await t.calls.start("everything")).toBe(true);
  });

  it("keeps a call with no speech in it, marked, and offers Try again", async () => {
    const silent: Transcriber = { ...transcriber, transcribeSegments: async () => [] };
    const t = await setup({ speech: silent });
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5));
    await t.calls.stop();
    const dir = t.callDir();
    expect(isNoSpeechFolder(dir)).toBe(true);
    expect(existsSync(path.join(dir, "you.pcm"))).toBe(true);
    expect(t.inbox()).toHaveLength(0);
    expect(t.failed).toEqual([
      { title: "No speech was heard on this call.", body: "The recording is safe on this Mac.", action: "finish-call", actionLabel: "Try again" },
    ]);
  });

  it("isNoSpeechFolder: only a folder with the marker", () => {
    const dir = path.join(tmp(), "call");
    mkdirSync(dir);
    expect(isNoSpeechFolder(dir)).toBe(false);
    writeFileSync(path.join(dir, "no-speech"), "");
    expect(isNoSpeechFolder(dir)).toBe(true);
    expect(isNoSpeechFolder(path.join(dir, "missing"))).toBe(false);
  });

  it("a microphone that didn't start keeps the folder when the call holds sound", async () => {
    const t = await setup({ answerStop: false, audioTimeoutMs: 20 });
    await t.calls.start(zoom); // the tap wrote the other side's first seconds
    await t.calls.cancel({ title: "The microphone didn't start.", body: "x" });
    expect(t.calls.running).toBe(false);
    expect(readdirSync(t.callsDir)).toHaveLength(1);
    expect(t.failed.map((f) => f.title)).toEqual(["The microphone didn't start."]);
  });

  it("a microphone that didn't start removes the folder when the call holds no sound", async () => {
    const t = await setup({ answerStop: false, audioTimeoutMs: 20, them: Buffer.alloc(0) });
    await t.calls.start(zoom);
    await t.calls.cancel({ title: "The microphone didn't start.", body: "x" });
    expect(readdirSync(t.callsDir)).toEqual([]);
  });

  it("drops a late block of an ended call while a newer one runs, whose blocks still arrive", async () => {
    const t = await setup({ answerStop: false, audioTimeoutMs: 20 });
    await t.calls.start(zoom);
    const first = t.micIds[0]!;
    await t.calls.stop(); // its last block never came in time: the other side alone is filed
    expect(t.inbox()).toHaveLength(1);
    await t.calls.start("everything");
    expect(t.micIds[1]).not.toBe(first);
    const you = path.join(t.callDir(), "you.pcm");
    t.calls.audio(first, floats(1, 0.5), true); // the first call's last block, late
    expect(existsSync(you)).toBe(false);
    t.mic(floats(1, 0.5));
    t.mic(floats(1, 0.5));
    expect(statSync(you).size).toBe(2 * RATE * 2);
  });
});
