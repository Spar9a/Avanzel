// One call on disk: the microphone's sound ("you") and the call app's ("them") as two raw 16 kHz mono s16le files in a
// folder of their own, until the controller has the capture written. The files are never held whole in memory until
// `finish`, and `finish` deletes nothing: a failed one is tried again on the same files.
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AvanzelError, callTranscript, dropEcho, mergeCall, type TimedText, type Transcriber } from "@avanzel/engine";

const SAMPLE_RATE = 16_000;
/** The other side counts as heard when its loudest sample reaches this share of full scale. */
const HEARD_PEAK = 0.002;
const READ_BLOCK = 1 << 20;

/** `finish` found no speech on either side: its own class, so that no one tells it apart by its words. */
export class NoSpeechError extends AvanzelError {
  constructor() {
    super("No speech was heard on this call.");
    this.name = "NoSpeechError";
  }
}

/** What call.json says of a call. */
export interface CallMeta {
  /** The call app's process name, or null: everything the Mac played. */
  app: string | null;
  startedAt: Date;
  /**
   * How many seconds after the microphone's first sample the call app's first one came (the helper's wait, then its start): the
   * "them" side is shifted by it before the two are merged. 0 when it isn't known.
   */
  themOffsetSeconds: number;
}

interface Stream {
  samples: Float32Array;
  peak: number;
}

/** A raw s16le file as samples in [-1, 1]; a missing or empty file is no samples. */
function readStream(file: string): Stream {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return { samples: new Float32Array(0), peak: 0 };
  }
  const samples = new Float32Array(Math.floor(size / 2));
  const fd = openSync(file, "r");
  let peak = 0;
  try {
    const block = Buffer.alloc(READ_BLOCK);
    let at = 0;
    while (at < samples.length) {
      const wanted = Math.min(block.length, (samples.length - at) * 2);
      const got = readSync(fd, block, 0, wanted, at * 2);
      if (got < 2) break;
      for (let i = 0; i + 1 < got; i += 2, at++) {
        const value = block.readInt16LE(i) / 32768;
        samples[at] = value;
        if (Math.abs(value) > peak) peak = Math.abs(value);
      }
    }
  } finally {
    closeSync(fd);
  }
  return { samples, peak };
}

/** What one stream says: the transcriber's segments, or, for one that can't give them, the whole stream as one. */
async function segmentsOf(t: Transcriber, samples: Float32Array): Promise<TimedText[]> {
  if (samples.length === 0) return [];
  if (t.transcribeSegments) return (await t.transcribeSegments(samples, SAMPLE_RATE)).filter((s) => s.text.trim());
  const { text } = await t.transcribe(samples, SAMPLE_RATE);
  return text.trim() ? [{ start: 0, end: samples.length / SAMPLE_RATE, text: text.trim() }] : [];
}

/** An offset as call.json keeps it: never below 0, to a tenth of a second. */
const tenths = (seconds: number): number => Math.max(0, Math.round(seconds * 10) / 10);

export class CallSession {
  readonly dir: string;
  readonly youFile: string;
  readonly themFile: string;
  private meta: CallMeta;

  /**
   * A new call's folder, `id` in `callsDir`, made afresh: when a folder of that name is there already (two calls in one second), the
   * next free one of `<id>-2`, `<id>-3`… is used, so that no call ever writes into another's.
   */
  static create(opts: { callsDir: string; id: string; app: string | null; startedAt: Date }): CallSession {
    mkdirSync(opts.callsDir, { recursive: true });
    for (let n = 1; ; n++) {
      const dir = path.join(opts.callsDir, n === 1 ? opts.id : `${opts.id}-${n}`);
      try {
        mkdirSync(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
      return new CallSession({ dir, app: opts.app, startedAt: opts.startedAt });
    }
  }

  /** Makes `dir` if need be and writes its call.json: the app the call is in (null: everything the Mac plays), when it began, and the offset. */
  constructor(opts: { dir: string; app: string | null; startedAt: Date; themOffsetSeconds?: number }) {
    mkdirSync(opts.dir, { recursive: true });
    this.dir = opts.dir;
    this.meta = { app: opts.app, startedAt: opts.startedAt, themOffsetSeconds: tenths(opts.themOffsetSeconds ?? 0) };
    this.writeMeta();
    this.youFile = path.join(opts.dir, "you.pcm");
    this.themFile = path.join(opts.dir, "them.pcm");
  }

  /** What call.json in `dir` says, or null when it is missing or isn't one. A call.json from before the offset was kept has 0. */
  static read(dir: string): CallMeta | null {
    try {
      const raw: unknown = JSON.parse(readFileSync(path.join(dir, "call.json"), "utf8"));
      if (typeof raw !== "object" || raw === null) return null;
      const { app, startedAt, themOffsetSeconds } = raw as Record<string, unknown>;
      if (app !== null && typeof app !== "string") return null;
      const when = typeof startedAt === "string" ? new Date(startedAt) : null;
      if (!when || Number.isNaN(when.getTime())) return null;
      const offset = typeof themOffsetSeconds === "number" && Number.isFinite(themOffsetSeconds) ? tenths(themOffsetSeconds) : 0;
      return { app, startedAt: when, themOffsetSeconds: offset };
    } catch {
      return null;
    }
  }

  /** Keeps in call.json how far the call app's side starts after the microphone's (`CallMeta.themOffsetSeconds`). */
  setThemOffset(seconds: number): void {
    this.meta = { ...this.meta, themOffsetSeconds: tenths(seconds) };
    this.writeMeta();
  }

  private writeMeta(): void {
    const { app, startedAt, themOffsetSeconds } = this.meta;
    writeFileSync(path.join(this.dir, "call.json"), `${JSON.stringify({ app, startedAt: startedAt.toISOString(), themOffsetSeconds })}\n`);
  }

  /** Adds a block of the microphone's samples (floats in [-1, 1]) to the "you" file as 16-bit PCM. Throws when it can't be written. */
  appendYou(samples: Float32Array): void {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const x = Math.max(-1, Math.min(1, samples[i]!));
      pcm[i] = Math.round(x < 0 ? x * 32768 : x * 32767);
    }
    appendFileSync(this.youFile, Buffer.from(pcm.buffer));
  }

  /**
   * The call as a transcript: each file read and transcribed in turn ("you" first, and let go of before "them" is read: the model
   * is big, and so is a long call), the "them" side shifted by its offset, the microphone's pick-up of the call app's sound dropped,
   * and the two sides merged by time. `seconds` is the longer stream's length. Throws a NoSpeechError when neither side has any
   * speech. The files stay. `_now` is the controller's clock; the transcript has no use for it.
   */
  async finish(t: Transcriber, _now: Date): Promise<{ transcript: string; seconds: number; themHeard: boolean }> {
    const offset = this.meta.themOffsetSeconds;
    let you: Stream | null = readStream(this.youFile);
    const youSeconds = you.samples.length / SAMPLE_RATE;
    const youSegments = await segmentsOf(t, you.samples);
    you = null; // its samples can go before the other side's are read
    const them = readStream(this.themFile);
    const themSegments = (await segmentsOf(t, them.samples)).map((s) => ({ ...s, start: s.start + offset, end: s.end + offset }));
    const lines = mergeCall(dropEcho(youSegments, themSegments), themSegments);
    if (lines.length === 0) throw new NoSpeechError();
    const themSeconds = them.samples.length > 0 ? them.samples.length / SAMPLE_RATE + offset : 0;
    return {
      transcript: callTranscript(lines),
      seconds: Math.max(youSeconds, themSeconds),
      themHeard: them.peak >= HEARD_PEAK,
    };
  }
}
