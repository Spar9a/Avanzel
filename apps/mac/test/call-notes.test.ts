import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AvanzelError, defaultSettings, Librarian, Vault, type TimedText, type Transcriber } from "@avanzel/engine";
import { CALL_RUNNING_LINE } from "../src/shared/transcribing.ts";
import {
  APP_QUIT_LINE,
  CALL_CONSENT_DIALOG,
  CALL_KEPT_LINE,
  CallNotes,
  isNoSpeechFolder,
  THEM_NOT_HEARD,
  type CallHost,
  type CutShortCall,
  type Tap,
} from "../src/main/call-notes.ts";
import { CallSession } from "../src/main/call-session.ts";
import type { TapEvent } from "../src/main/calltap.ts";

const RATE = 16_000;
const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-notes-"));

/**
 * `seconds` at `level`: the microphone's blocks as floats whose sign flips every sample, and the tap's file as s16le bytes of a
 * constant level (`micPcm`: the microphone's sound as a file). The two sides sound nothing alike, so neither is taken for the
 * other's echo (`echoSegments`).
 */
const floats = (seconds: number, level: number) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => (i % 2 ? -level : level));
const pcm = (seconds: number, level: number) => Buffer.from(new Int16Array(Math.round(seconds * RATE)).fill(Math.round(level * 32767)).buffer);
const micPcm = (seconds: number, level: number) => Buffer.from(Int16Array.from(floats(seconds, level), (x) => Math.round(x * 32767)).buffer);

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

/**
 * A stand-in helper: it writes `them` to its file as it starts and says started (unless `says` is false: it is still waiting for the
 * app's sound), and the test says what it reports (`emit`).
 */
class FakeTap implements Tap {
  stopped = false;
  constructor(
    readonly opts: { pids: number[]; outFile: string; onEvent(e: TapEvent): void },
    private readonly them: Buffer,
    private readonly says: boolean,
  ) {}
  start(): void {
    writeFileSync(this.opts.outFile, this.them);
    if (this.says) this.opts.onEvent({ event: "started" });
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
  /** The helper says started as it starts (false: it waits, and the test emits what it says). */
  tapStarts?: boolean;
}

async function setup({
  consent = true,
  answer = true,
  them = pcm(4, 0.1),
  maxCallMs = 60_000,
  audioTimeoutMs = 1_000,
  answerStop = true,
  speech = transcriber,
  tapStarts = true,
}: Options = {}) {
  const root = tmp();
  const vault = await Vault.init(path.join(root, "lib"), { git: false });
  const librarian = new Librarian(vault, defaultSettings());
  const log: string[] = [];
  const taps: FakeTap[] = [];
  const filed: { path: string; text: string }[] = [];
  const failed: { title: string; body: string; action?: string; actionLabel?: string }[] = [];
  /** The calls cut short that were offered (`recover`), what choosing each does, and the offer given back (closed once taken back). */
  const offers: { call: CutShortCall; finish: () => Promise<void>; notice: { closed: boolean; close(): void } }[] = [];
  /** The short notices (`notice`). */
  const notices: string[] = [];
  let consented = consent;
  let calls!: CallNotes;
  /** The ids the call-start commands carried, in order. */
  const micIds: number[] = [];
  const state = { recording: false };
  /** The phase each `changed` saw, in order: the menu is built from the phase as it is when it is told. */
  const phases: string[] = [];
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
      const tap = new FakeTap(opts, them, tapStarts);
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
    notice: (line) => notices.push(line),
    changed: () => void phases.push(calls.phase),
    offerCutShort(call, finish) {
      const notice = {
        closed: false,
        close() {
          this.closed = true;
        },
      };
      offers.push({ call, finish, notice });
      return notice;
    },
  };
  calls = new CallNotes(host);
  const inbox = () => readdirSync(vault.inbox).filter((name) => name.endsWith(".md"));
  /** A block of the newest call's microphone, as the capsule page sends it. */
  const mic = (samples: Float32Array, last = false) => calls.audio(micIds.at(-1)!, samples, last);
  /** The folder of the only call on disk. */
  const callDir = () => path.join(host.callsDir, readdirSync(host.callsDir)[0]!);
  return { calls, host, log, taps, filed, failed, offers, notices, phases, vault, inbox, callsDir: host.callsDir, consented: () => consented, micIds, mic, callDir, state };
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
        "When the notes are filed, the text, including other people's words, goes to your agent's provider, such as Anthropic for Claude Code or OpenAI for Codex.",
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
    expect(THEM_NOT_HEARD).toBe(
      "The other side of this call wasn't heard. System Audio Recording may be off for Avanzel: check System Settings, Privacy & Security, Screen & System Audio Recording.",
    );
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
    expect(t.notices).toEqual(["The call app quit, so the notes were finished with what was heard."]);
    expect(APP_QUIT_LINE).toBe("The call app quit, so the notes were finished with what was heard.");
  });

  it("Stop gives no notice that the app quit", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    await t.calls.stop();
    expect(t.filed).toHaveLength(1);
    expect(t.notices).toEqual([]);
  });

  it("a helper that fails before it started says the app wasn't playing sound, and ends the call with nothing kept", async () => {
    const t = await setup({ tapStarts: false, them: Buffer.alloc(0), answerStop: false, audioTimeoutMs: 20 });
    await t.calls.start(zoom);
    t.taps[0]!.emit({ event: "error", message: "no app you named is playing sound" });
    await t.calls.settled();
    expect(t.calls.running).toBe(false);
    expect(t.failed).toEqual([
      { title: "That app wasn't playing sound yet.", body: "Start the notes once the call is on, or choose Everything this Mac plays." },
    ]);
    expect(readdirSync(t.callsDir)).toEqual([]);
    expect(t.calls.cutShortCalls).toBe(0);
    expect(t.inbox()).toHaveLength(0);
    expect(t.phases.at(-1)).toBe("idle");
  });

  it("a helper that fails before it started keeps what the microphone heard, to be finished from the menu", async () => {
    const t = await setup({ tapStarts: false, them: Buffer.alloc(0) });
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    t.taps[0]!.emit({ event: "error", message: "no app you named is playing sound" });
    await t.calls.settled();
    expect(t.failed.map((f) => f.title)).toEqual(["That app wasn't playing sound yet."]);
    expect(readdirSync(t.callsDir)).toHaveLength(1);
    expect(t.calls.cutShortCalls).toBe(1);
  });

  it("a full disk on the microphone's side ends the call with a problem that names it, and keeps the folder", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    t.mic(floats(1, 0.5), false);
    const you = path.join(t.callDir(), "you.pcm");
    rmSync(you);
    mkdirSync(you); // the next block can't be written
    expect(() => t.mic(floats(1, 0.5), false)).not.toThrow();
    await t.calls.settled();
    expect(t.calls.running).toBe(false);
    expect(t.failed).toEqual([
      {
        title: "There's no room left on this Mac to keep the call.",
        body: "What was heard so far is safe.",
        action: "finish-call",
        actionLabel: "Finish the notes",
      },
    ]);
    expect(readdirSync(t.callsDir)).toHaveLength(1);
    expect(t.calls.cutShortCalls).toBe(1);
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

  /** The microphone's problem as the controller words it: a kept folder is told with CALL_KEPT_LINE, not "Nothing was recorded." */
  const micProblem = (kept: boolean) => ({ title: "The microphone didn't start.", body: kept ? CALL_KEPT_LINE : "Nothing was recorded." });

  it("a microphone that didn't start keeps the folder when the call holds sound, and its card says what was heard is safe", async () => {
    const t = await setup({ answerStop: false, audioTimeoutMs: 20 });
    await t.calls.start(zoom); // the tap wrote the other side's first seconds
    await t.calls.cancel(micProblem);
    expect(t.calls.running).toBe(false);
    expect(readdirSync(t.callsDir)).toHaveLength(1);
    expect(t.failed).toEqual([{ title: "The microphone didn't start.", body: "The call's notes weren't made. What was heard is safe on this Mac." }]);
    expect(t.calls.cutShortCalls).toBe(1); // the menu offers to finish it
  });

  it("a microphone that didn't start removes the folder when the call holds no sound", async () => {
    const t = await setup({ answerStop: false, audioTimeoutMs: 20, them: Buffer.alloc(0) });
    await t.calls.start(zoom);
    await t.calls.cancel(micProblem);
    expect(readdirSync(t.callsDir)).toEqual([]);
    expect(t.failed).toEqual([{ title: "The microphone didn't start.", body: "Nothing was recorded." }]);
    expect(t.calls.cutShortCalls).toBe(0);
  });

  it("another error worded as no speech is not taken for one: only the session's own NoSpeechError marks the folder", async () => {
    const t = await setup();
    t.host.captureCall = async () => {
      throw new AvanzelError("No speech was heard on this call.");
    };
    await t.calls.start(zoom);
    t.mic(floats(2, 0.5), false);
    await t.calls.stop();
    expect(t.failed.map((f) => f.title)).toEqual(["The call's notes couldn't be made."]);
    expect(isNoSpeechFolder(t.callDir())).toBe(false);
  });

  it("two calls begun in the same second get folders of their own", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 10, 4, 10, 0, 0, 100));
      const t = await setup();
      await t.calls.start(zoom);
      t.mic(floats(1, 0.5));
      await t.calls.leave(); // its folder stays
      vi.setSystemTime(new Date(2026, 10, 4, 10, 0, 0, 900));
      await t.calls.start("everything");
      expect(readdirSync(t.callsDir).sort()).toEqual(["2026-11-04-100000", "2026-11-04-100000-2"]);
      expect(CallSession.read(path.join(t.callsDir, "2026-11-04-100000"))?.app).toBe("zoom.us");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps in call.json how far after the microphone the other side began, and the finish lines the two up by it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const at = new Date(2026, 10, 4, 10, 0, 0).getTime();
      vi.setSystemTime(at);
      // Each side says one line at 0-1 s of its own stream: the other side began 5 s after the microphone.
      const speech: Transcriber = {
        ...transcriber,
        async transcribeSegments(samples): Promise<TimedText[]> {
          return Math.max(...samples.slice(0, 100)) > 0.3
            ? [{ start: 3, end: 4, text: "Shall we start with the budget?" }]
            : [{ start: 0, end: 2, text: "Yes, the budget is ready." }];
        },
      };
      const t = await setup({ tapStarts: false, speech });
      await t.calls.start(zoom);
      vi.setSystemTime(at + 1_000);
      t.mic(floats(1, 0.5)); // the microphone's first second: it opened at `at`
      vi.setSystemTime(at + 5_000);
      t.taps[0]!.emit({ event: "started" }); // after its wait
      expect(CallSession.read(t.callDir())?.themOffsetSeconds).toBe(5);
      t.mic(floats(4, 0.5));
      await t.calls.leave();
      await t.calls.finishCallFolder(t.callDir()); // as a finish after a launch does: from call.json
      expect(t.filed[0]!.text).toBe("[00:03] You: Shall we start with the budget?\n\n[00:05] Them: Yes, the budget is ready.\n");
    } finally {
      vi.useRealTimers();
    }
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

describe("a call that was cut short", () => {
  const DAY = 24 * 60 * 60 * 1000;
  /** A folder a quit (or a crash) left in calls/: call.json, and the two files with what they hold. */
  interface Leftover {
    /** What each file holds; null: the file isn't there. */
    you?: Buffer | null;
    them?: Buffer | null;
    app?: string | null;
    /** Whether call.json is there. */
    meta?: boolean;
  }
  function leftover(callsDir: string, id: string, { you = micPcm(2, 0.5), them = pcm(2, 0.1), app = "zoom.us", meta = true }: Leftover = {}) {
    const dir = path.join(callsDir, id);
    if (meta) new CallSession({ dir, app, startedAt: new Date(2026, 10, 3, 14, 3) });
    else mkdirSync(dir, { recursive: true });
    if (you) writeFileSync(path.join(dir, "you.pcm"), you);
    if (them) writeFileSync(path.join(dir, "them.pcm"), them);
    return dir;
  }

  it("offers a leftover call once, with its id and app, and choosing it writes the capture and removes the folder", async () => {
    const t = await setup();
    const dir = leftover(t.callsDir, "2026-11-03-140300");
    const found = t.calls.recover();
    expect(found.map(({ id, app, dir }) => ({ id, app, dir }))).toEqual([{ id: "2026-11-03-140300", app: "zoom.us", dir }]);
    expect(t.offers.map((o) => o.call.id)).toEqual(["2026-11-03-140300"]);
    expect(t.inbox()).toHaveLength(0); // nothing is filed until the person chooses it
    await t.offers[0]!.finish();
    expect(t.inbox()).toHaveLength(1);
    const note = readFileSync(path.join(t.vault.inbox, t.inbox()[0]!), "utf8");
    expect(note).toContain("source: call");
    expect(note).toContain("Shall we start with the budget?");
    expect(note).toContain("Yes, the budget is ready.");
    expect(existsSync(dir)).toBe(false);
    expect(t.filed).toHaveLength(1);
  });

  it("removes folders with no sound in them quietly", async () => {
    const t = await setup();
    const none = leftover(t.callsDir, "2026-11-03-140300", { you: null, them: null });
    const empty = leftover(t.callsDir, "2026-11-03-150000", { you: Buffer.alloc(0), them: Buffer.alloc(0) });
    expect(t.calls.recover()).toEqual([]);
    expect(t.offers).toEqual([]);
    expect(existsSync(none)).toBe(false);
    expect(existsSync(empty)).toBe(false);
  });

  it("removes a call with no speech in it once it is a day old, and offers a younger one", async () => {
    const t = await setup();
    const old = leftover(t.callsDir, "2026-11-01-090000");
    writeFileSync(path.join(old, "no-speech"), "");
    expect(isNoSpeechFolder(old)).toBe(true);
    expect(t.calls.recover(Date.now() + DAY + 60_000)).toEqual([]);
    expect(existsSync(old)).toBe(false);

    const t2 = await setup();
    const young = leftover(t2.callsDir, "2026-11-03-090000");
    writeFileSync(path.join(young, "no-speech"), "");
    expect(t2.calls.recover().map((c) => c.id)).toEqual(["2026-11-03-090000"]);
  });

  it("a folder without call.json is offered with no app and the folder's time, and is finished all the same", async () => {
    const t = await setup();
    const dir = leftover(t.callsDir, "2026-11-03-140300", { meta: false });
    const [found] = t.calls.recover();
    expect(found).toMatchObject({ id: "2026-11-03-140300", app: null });
    expect(found!.startedAt.getTime()).toBe(statSync(dir).mtime.getTime());
    await t.offers[0]!.finish();
    expect(t.inbox()).toHaveLength(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("never offers the folder of the call that runs", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    t.mic(floats(1, 0.5));
    expect(t.calls.recover()).toEqual([]);
    expect(readdirSync(t.callsDir)).toHaveLength(1);
  });

  it("choosing it while a call runs does nothing: the folder waits for the next launch", async () => {
    const t = await setup();
    const dir = leftover(t.callsDir, "2026-11-03-140300");
    t.calls.recover();
    await t.calls.start("everything");
    await t.offers[0]!.finish();
    expect(t.inbox()).toHaveLength(0);
    expect(existsSync(dir)).toBe(true);
  });

  it("with no calls folder at all there is nothing to offer", async () => {
    const t = await setup();
    expect(t.calls.recover()).toEqual([]);
  });

  it("removes quietly a call no one finished whose files are a week old, and offers one six days old", async () => {
    const t = await setup();
    const age = (dir: string, days: number) => {
      const when = new Date(Date.now() - days * DAY);
      for (const name of readdirSync(dir)) utimesSync(path.join(dir, name), when, when);
      utimesSync(dir, when, when);
    };
    const old = leftover(t.callsDir, "2026-10-27-090000");
    const young = leftover(t.callsDir, "2026-10-29-090000");
    age(old, 7.1);
    age(young, 6);
    expect(t.calls.recover().map((c) => c.id)).toEqual(["2026-10-29-090000"]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
  });

  it("holds each offer until its call is finished, then takes it back", async () => {
    const t = await setup();
    leftover(t.callsDir, "2026-11-03-140300");
    leftover(t.callsDir, "2026-11-03-150000");
    t.calls.recover();
    expect(t.calls.cutShortNotices()).toEqual(t.offers.map((o) => o.notice));
    await t.offers[1]!.finish();
    expect(t.offers[1]!.notice.closed).toBe(true);
    expect(t.calls.cutShortNotices()).toEqual([t.offers[0]!.notice]);
    expect(t.offers[0]!.notice.closed).toBe(false);
  });

  it("the menu counts the calls waiting, and its row finishes the oldest, as clicking its offer would", async () => {
    const t = await setup();
    const older = leftover(t.callsDir, "2026-11-03-140300");
    const newer = leftover(t.callsDir, "2026-11-03-150000");
    t.calls.recover();
    expect(t.calls.cutShortCalls).toBe(2);
    await t.calls.finishOldestCutShort();
    expect(existsSync(older)).toBe(false);
    expect(existsSync(newer)).toBe(true);
    expect(t.inbox()).toHaveLength(1);
    expect(t.offers[0]!.notice.closed).toBe(true);
    expect(t.calls.cutShortCalls).toBe(1);
    await t.offers[0]!.finish(); // its offer, clicked after all: the folder is gone, nothing happens
    expect(t.inbox()).toHaveLength(1);
    await t.calls.finishOldestCutShort();
    expect(t.inbox()).toHaveLength(2);
    expect(t.calls.cutShortCalls).toBe(0);
    await t.calls.finishOldestCutShort(); // none left: nothing
    expect(t.inbox()).toHaveLength(2);
  });

  it("the menu's row does nothing while a call runs, and the call's own folder is not counted", async () => {
    const t = await setup();
    const dir = leftover(t.callsDir, "2026-11-03-140300");
    t.calls.recover();
    await t.calls.start("everything");
    t.mic(floats(1, 0.5));
    expect(t.calls.cutShortCalls).toBe(1);
    await t.calls.finishOldestCutShort();
    expect(existsSync(dir)).toBe(true);
    expect(t.inbox()).toHaveLength(0);
  });

  it("a folder removed meanwhile is no longer counted, and its offer is taken back", async () => {
    const t = await setup();
    const dir = leftover(t.callsDir, "2026-11-03-140300");
    t.calls.recover();
    rmSync(dir, { recursive: true });
    expect(t.calls.cutShortCalls).toBe(0);
    expect(t.offers[0]!.notice.closed).toBe(true);
    expect(t.calls.cutShortNotices()).toEqual([]);
  });
});

describe("what the menu offers", () => {
  it("is idle with no call, busy while a start asks its questions, running until Stop, and busy while the call is finished", async () => {
    const t = await setup({ consent: false });
    expect(t.calls.phase).toBe("idle");
    let answer!: (yes: boolean) => void;
    t.host.askConsent = () => new Promise((resolve) => (answer = resolve));
    const starting = t.calls.start(zoom);
    expect(t.calls.phase).toBe("busy");
    answer(true);
    await starting;
    expect(t.calls.phase).toBe("running");
    const stopping = t.calls.stop();
    expect(t.calls.phase).toBe("busy");
    await stopping;
    expect(t.calls.phase).toBe("idle");
  });
});

describe("the menu settles after a call ends", () => {
  // The menu is built from `phase` when the host is told `changed`; nothing tells it again later, so the last telling must see the end.
  it("the last change after Stop sees idle", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    await t.calls.stop();
    expect(t.inbox()).toHaveLength(1);
    expect(t.phases.at(-1)).toBe("idle");
  });

  it("the last change after the helper stopped by itself sees idle", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    t.taps[0]!.emit({ event: "stopped", seconds: 4 });
    await t.calls.settled();
    expect(t.inbox()).toHaveLength(1);
    expect(t.phases.at(-1)).toBe("idle");
  });

  it("the last change after the helper was lost sees idle", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    t.taps[0]!.emit({ event: "error", message: "gone" });
    await t.calls.settled();
    expect(t.failed.map((f) => f.title)).toEqual(["The other side of the call stopped being heard."]);
    expect(t.phases.at(-1)).toBe("idle");
  });

  it("the last change after a cancel that keeps the folder offers to finish it", async () => {
    const t = await setup({ answerStop: false, audioTimeoutMs: 20 });
    await t.calls.start(zoom); // the tap wrote the other side's first seconds
    const seen: number[] = [];
    const changed = t.host.changed;
    t.host.changed = () => {
      seen.push(t.calls.cutShortCalls); // what the menu's "Finish notes for a call that was cut short" is built from
      changed();
    };
    await t.calls.cancel(() => ({ title: "The microphone didn't start.", body: CALL_KEPT_LINE }));
    expect(readdirSync(t.callsDir)).toHaveLength(1);
    expect(seen.at(-1)).toBe(1);
    expect(t.phases.at(-1)).toBe("idle");
  });

  it("the last change after a cancel sees idle", async () => {
    const t = await setup();
    await t.calls.start(zoom);
    await t.calls.cancel(() => ({ title: "The microphone didn't start.", body: "x" }));
    expect(t.phases.at(-1)).toBe("idle");
  });
});
