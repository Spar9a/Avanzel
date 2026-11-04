// Notes on a call: the call app's sound through avanzel-calltap and the person's through the capsule's microphone, each to its own file
// in <userData>/calls/<id>/ (`CallSession`), until Stop, the helper's own end or four hours; then the two become one transcript, one
// capture in the inbox, filed as a thought is. The controller is the host: it owns the capsule, the dialogs and the library, and this
// owns the call. A call is not a recording (`Controller.recording`): while one runs no thought starts (`refuse`).
import { rmSync } from "node:fs";
import path from "node:path";
import { AvanzelError, idStamp, type CallCapture, type Transcriber } from "@avanzel/engine";
import type { CardAction } from "../shared/ipc.ts";
import type { Problem } from "../shared/problems.ts";
import type { CallApp } from "./call-apps.ts";
import { CallSession } from "./call-session.ts";
import type { TapEvent } from "./calltap.ts";

/** A call ends by itself after this long, as Stop ends it. A thought's `voice.maxRecordSeconds` does not apply. */
export const MAX_CALL_MS = 4 * 60 * 60 * 1000;

/** The native question asked before the first call (`CallHost.askConsent`): Take notes, or Not now, the default and the cancel. */
export const CALL_CONSENT_DIALOG = {
  type: "question" as const,
  title: "Take notes on a call?",
  message: "Take notes on a call?",
  detail: [
    "In many places everyone on a call must agree to it being recorded, and some workplaces forbid recording tools. Tell the people on the call.",
    "Avanzel hears both sides on this Mac and turns them into text here. It never joins the call.",
    "When the notes are filed, the text, including other people's words, goes to your agent.",
  ].join("\n\n"),
  buttons: ["Take notes", "Not now"],
  defaultId: 1,
  cancelId: 1,
};

/** The capture's first line when the call app's side was silent (`CallSession.finish`'s `themHeard`). */
export const THEM_NOT_HEARD = "The other side of this call wasn't heard. System Audio Recording may be off for Avanzel.";

const CANT_TAP: Problem = { title: "Avanzel can't hear calls on this Mac.", body: "Notes on a call need macOS 14.2 or later. Nothing was recorded." };
const TAP_LOST: Problem = { title: "The other side of the call stopped being heard.", body: "What was heard so far is safe on this Mac." };
const NOT_MADE: Problem = {
  title: "The call's notes couldn't be made.",
  body: "The recording is safe on this Mac and nothing was changed in your library.",
};
const NO_SPEECH: Problem = { title: "No speech was heard on this call.", body: "Nothing was saved." };

/** What CallNotes needs of avanzel-calltap (`CallTap`); tests stand one in. */
export interface Tap {
  start(): void;
  stop(): Promise<void>;
}

export interface CallHost {
  /** <userData>/calls: each call's folder is made in it. */
  readonly callsDir: string;
  /** How long Stop waits for the capsule's last block of the microphone before it finishes without it. */
  readonly audioTimeoutMs: number;
  /** How long a call may run (MAX_CALL_MS). */
  readonly maxCallMs: number;
  /** The call app's sound can be tapped (`CallTap.available`). */
  tapAvailable(): boolean;
  /** The person has said yes to the consent question (`AppSettings.callConsent`). */
  consented(): boolean;
  /** Asks the consent question (CALL_CONSENT_DIALOG); true on Take notes, which the host remembers. */
  askConsent(): Promise<boolean>;
  /** Library, speech model and microphone are ready, as for a thought; it says what is missing otherwise. */
  readyToListen(): Promise<boolean>;
  newTap(opts: { pids: number[]; outFile: string; onEvent(e: TapEvent): void }): Tap;
  transcriber(): Promise<Transcriber>;
  /** Writes the call's capture in the inbox (`Librarian.captureCall`) and gives its path. */
  captureCall(call: CallCapture): Promise<string>;
  /** The capsule's listening card for the call, which began at `startedAt` (Date.now()). */
  listening(startedAt: number): void;
  /** Starts or stops the capsule page's microphone for the call; once stopped, the page sends its last block (`audio`). */
  microphone(on: boolean): void;
  /** A thought, a screen comment or a question was asked for while the call runs: the capsule's notice says so (CALL_RUNNING_LINE). */
  refused(): void;
  /** The call's words are being made: the capsule's transcribing card. */
  finishing(): void;
  /** The capture is in the inbox: on as a thought's goes (`afterCapture`). `transcribedIn`: seconds its words took. */
  filed(capturePath: string, text: string, transcribedIn: number): void;
  /** The capsule's problem card, with its one fix. */
  failed(problem: Problem, action?: CardAction, actionLabel?: string): void;
  /** A call started or ended: the menu and the tray follow. */
  changed(): void;
}

interface ActiveCall {
  dir: string;
  session: CallSession;
  tap: Tap;
  maxTimer: NodeJS.Timeout;
  /** The end under way (`end`), once one is. */
  ending: Promise<void> | null;
  /** Resolves the wait for the microphone's last block. */
  lastBlock: (() => void) | null;
}

export class CallNotes {
  /** The call that runs: from its start until Stop, the helper's end, its four hours, or a quit. */
  private active: ActiveCall | null = null;
  /** The call whose microphone blocks are still taken: the active one, and an ending one until its last block. */
  private mic: ActiveCall | null = null;
  /** A start waits on the consent question or the microphone prompt: a second start meanwhile is refused. */
  private starting = false;
  /** The folder of a call whose notes weren't made, which Try again (or Finish the notes) finishes (`finishKept`). */
  private kept: string | null = null;
  private finishingDir: string | null = null;
  private work: Promise<void> = Promise.resolve();

  constructor(private readonly host: CallHost) {}

  /** A call runs (Stop has not been asked), or its microphone's last block is on its way. */
  get running(): boolean {
    return this.active !== null || this.mic !== null;
  }

  /**
   * Starts notes on a call in `app` (its pids are tapped) or in everything the Mac plays. Refused (false) while a call runs or one is
   * starting, when the Mac can't tap a call, on Not now, and when the microphone or the speech model isn't ready.
   */
  async start(app: CallApp | "everything"): Promise<boolean> {
    if (this.running || this.starting) return false;
    this.starting = true;
    try {
      const { host } = this;
      if (!host.tapAvailable()) {
        host.failed(CANT_TAP);
        return false;
      }
      if (!host.consented() && !(await host.askConsent())) return false;
      if (!(await host.readyToListen())) return false;
      const startedAt = new Date();
      const dir = path.join(host.callsDir, idStamp(startedAt));
      const session = new CallSession({ dir, app: app === "everything" ? null : app.name, startedAt });
      const call: ActiveCall = {
        dir,
        session,
        tap: { start: () => undefined, stop: async () => undefined },
        maxTimer: setTimeout(() => void this.end(call, "finish"), host.maxCallMs),
        ending: null,
        lastBlock: null,
      };
      call.maxTimer.unref?.();
      call.tap = host.newTap({ pids: app === "everything" ? [] : app.pids, outFile: session.themFile, onEvent: (e) => this.tapSaid(call, e) });
      this.active = call;
      this.mic = call;
      host.listening(startedAt.getTime());
      host.microphone(true);
      call.tap.start();
      host.changed();
      return true;
    } finally {
      this.starting = false;
    }
  }

  /** Stop: both sides end, and the call becomes its capture (`finishCallFolder`). Nothing while no call runs. */
  async stop(): Promise<void> {
    if (this.active) await this.end(this.active, "finish");
  }

  /** Avanzel quits: both sides end and the folder stays, for the next start to finish. */
  async leave(): Promise<void> {
    if (this.active) await this.end(this.active, "leave");
  }

  /** The call's microphone couldn't start: the call ends, nothing of it is kept, and `problem` says so. */
  async cancel(problem: Problem, action?: CardAction, actionLabel?: string): Promise<void> {
    const call = this.active;
    if (!call) return;
    await this.end(call, "leave");
    rmSync(call.dir, { recursive: true, force: true });
    this.host.failed(problem, action, actionLabel);
  }

  /** A block of the call's microphone from the capsule page; `last` once its microphone has stopped. */
  audio(samples: Float32Array, last: boolean): void {
    const call = this.mic;
    if (!call) return; // a late block of a call that ended without it
    if (samples.length > 0) call.session.appendYou(samples);
    if (last) {
      this.mic = null;
      call.lastBlock?.();
    }
  }

  /** The guard of a thought's start: true (and the notice shows) while a call runs, so that the thought doesn't start. */
  refuse(): boolean {
    if (!this.running) return false;
    this.host.refused();
    return true;
  }

  /** Try again (or Finish the notes) on the card of a call whose notes weren't made: its kept folder is finished again. */
  async finishKept(): Promise<void> {
    if (this.kept && this.finishingDir === null) await this.finishCallFolder(this.kept);
  }

  /** The end under way, if any: for the tests, and for whoever must wait for it. */
  settled(): Promise<void> {
    return this.work;
  }

  /**
   * The call in `dir` as its capture: both files transcribed and merged (`CallSession.finish`), the capture written, the folder removed,
   * and the capture on as a thought's goes (`filed`). When the other side was silent the capture says so first (THEM_NOT_HEARD). When
   * it fails the folder stays, and the card's Try again finishes it again (`finishKept`); a call with no speech in it is removed, as a
   * silent thought is. Stop, Finish the notes and Try again use it, and so can the finish of a call left over from a quit.
   */
  async finishCallFolder(dir: string): Promise<void> {
    const { host } = this;
    this.finishingDir = dir;
    host.finishing();
    try {
      const meta = CallSession.read(dir);
      if (!meta) throw new Error(`${dir} has no call.json`);
      const started = performance.now();
      const session = new CallSession({ dir, ...meta });
      const { transcript, seconds, themHeard } = await session.finish(await host.transcriber(), new Date());
      const text = themHeard ? transcript : `${THEM_NOT_HEARD}\n\n${transcript}`;
      const capturePath = await host.captureCall({ transcript: text, ...(meta.app ? { app: meta.app } : {}), startedAt: meta.startedAt, seconds });
      rmSync(dir, { recursive: true, force: true });
      if (this.kept === dir) this.kept = null;
      host.filed(capturePath, text, (performance.now() - started) / 1000);
    } catch (error) {
      if (error instanceof AvanzelError && error.message === NO_SPEECH.title) {
        rmSync(dir, { recursive: true, force: true });
        if (this.kept === dir) this.kept = null;
        return host.failed(NO_SPEECH);
      }
      console.error("call notes", error);
      this.kept = dir;
      host.failed(NOT_MADE, "finish-call", "Try again");
    } finally {
      this.finishingDir = null;
    }
  }

  private tapSaid(call: ActiveCall, e: TapEvent): void {
    if (this.active !== call) return; // a stop asked for, or a call that ended
    if (e.event === "stopped") void this.end(call, "finish"); // the app quit: the call ends with what was heard
    else if (e.event === "error") {
      console.error("calltap", e.message);
      void this.end(call, "lost");
    }
  }

  /**
   * Ends `call` once, however many ask: the microphone stops and its last block is waited for (audioTimeoutMs at most), the helper
   * stops, and then the call is finished (`finish`), kept for Finish the notes (`lost`: the helper failed), or left for later (`leave`).
   */
  private end(call: ActiveCall, how: "finish" | "lost" | "leave"): Promise<void> {
    if (call.ending) return call.ending;
    const { host } = this;
    clearTimeout(call.maxTimer);
    if (this.active === call) this.active = null;
    call.ending = (async () => {
      const lastBlock = new Promise<void>((resolve) => {
        call.lastBlock = resolve;
        setTimeout(resolve, host.audioTimeoutMs).unref?.();
      });
      host.microphone(false);
      await Promise.all([lastBlock, call.tap.stop()]);
      if (this.mic === call) this.mic = null; // its last block never came
      host.changed();
      if (how === "leave") return;
      if (how === "lost") {
        this.kept = call.dir;
        return host.failed(TAP_LOST, "finish-call", "Finish the notes");
      }
      await this.finishCallFolder(call.dir);
    })();
    this.work = call.ending;
    return call.ending;
  }
}
