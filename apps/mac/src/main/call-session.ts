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

export class CallSession {
  readonly youFile: string;
  readonly themFile: string;

  /** Makes `dir` and writes its call.json: the app the call is in (null: everything the Mac plays) and when it began. */
  constructor(opts: { dir: string; app: string | null; startedAt: Date }) {
    mkdirSync(opts.dir, { recursive: true });
    writeFileSync(path.join(opts.dir, "call.json"), `${JSON.stringify({ app: opts.app, startedAt: opts.startedAt.toISOString() })}\n`);
    this.youFile = path.join(opts.dir, "you.pcm");
    this.themFile = path.join(opts.dir, "them.pcm");
  }

  /** What call.json in `dir` says, or null when it is missing or isn't one. */
  static read(dir: string): { app: string | null; startedAt: Date } | null {
    try {
      const raw: unknown = JSON.parse(readFileSync(path.join(dir, "call.json"), "utf8"));
      if (typeof raw !== "object" || raw === null) return null;
      const { app, startedAt } = raw as Record<string, unknown>;
      if (app !== null && typeof app !== "string") return null;
      const when = typeof startedAt === "string" ? new Date(startedAt) : null;
      if (!when || Number.isNaN(when.getTime())) return null;
      return { app, startedAt: when };
    } catch {
      return null;
    }
  }

  /** Adds a block of the microphone's samples (floats in [-1, 1]) to the "you" file as 16-bit PCM. */
  appendYou(samples: Float32Array): void {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const x = Math.max(-1, Math.min(1, samples[i]!));
      pcm[i] = Math.round(x < 0 ? x * 32768 : x * 32767);
    }
    appendFileSync(this.youFile, Buffer.from(pcm.buffer));
  }

  /**
   * The call as a transcript: both files read, each transcribed (one after the other, the model is big), the microphone's
   * pick-up of the call app's sound dropped, and the two sides merged by time. `seconds` is the longer stream's length.
   * Throws an AvanzelError when neither side has any speech. The files stay. `_now` is the controller's clock; the
   * transcript has no use for it.
   */
  async finish(t: Transcriber, _now: Date): Promise<{ transcript: string; seconds: number; themHeard: boolean }> {
    const you = readStream(this.youFile);
    const them = readStream(this.themFile);
    const youSegments = await segmentsOf(t, you.samples);
    const themSegments = await segmentsOf(t, them.samples);
    const lines = mergeCall(dropEcho(youSegments, themSegments), themSegments);
    if (lines.length === 0) throw new AvanzelError("No speech was heard on this call.");
    return {
      transcript: callTranscript(lines),
      seconds: Math.max(you.samples.length, them.samples.length) / SAMPLE_RATE,
      themHeard: them.peak >= HEARD_PEAK,
    };
  }
}
