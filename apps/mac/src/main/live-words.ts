// A recording's words while they are said, for the capsule to show. They are a preview and go nowhere else: the words that are pasted or
// filed come from the one recognition of the whole recording, when it ends, and may differ a little from these.

const SAMPLE_RATE = 16000;
/** 20 ms: long enough to span one wave of a voice, short enough to fit in the gap between two words. */
const FRAME = 320;
/** What has been said is settled once this much is waiting, so that each recognition stays short however long the dictation runs. */
const SETTLE_AT = 12 * SAMPLE_RATE;
/** The place to cut it is looked for in this much at the end of it... */
const LOOK_BACK = 4 * SAMPLE_RATE;
/** ...but not in this much at the very end, where a word may still be under way. */
const NOT_THE_LAST = SAMPLE_RATE / 2;

/** The middle of the quietest 20 ms of `samples` between `from` and `to`: most likely a gap between two words. `from` if no 20 ms fit. */
export function quietestPoint(samples: Float32Array, from: number, to: number): number {
  let quietest = from;
  let least = Infinity;
  for (let start = from; start + FRAME <= to; start += FRAME) {
    let energy = 0;
    for (let i = start; i < start + FRAME; i++) energy += samples[i]! * samples[i]!;
    if (energy < least) {
      least = energy;
      quietest = start + FRAME / 2;
    }
  }
  return quietest;
}

function joined(first: Float32Array, second: Float32Array): Float32Array {
  const all = new Float32Array(first.length + second.length);
  all.set(first);
  all.set(second, first.length);
  return all;
}

const sentence = (first: string, second: string): string => (first && second ? `${first} ${second}` : first || second);

export interface LiveWordsOptions {
  /** The words of these 16 kHz samples. */
  recognise(samples: Float32Array): Promise<string>;
  /** All the words so far, when they have changed; nothing (an empty string) once there will be no more, so that none stay up, stuck. */
  show(words: string): void;
}

/**
 * One recording's words as they come. Each block of audio starts a recognition of what is not yet settled, unless one is still running: the
 * next block starts the next, so a slow Mac shows the words less often and is not kept busy. Nothing is recognised until `allow`, as a
 * dictation may be going into a password field. A recognition that fails ends it quietly: the recording's own words are not affected.
 */
export class LiveWords {
  private audio: Float32Array = new Float32Array(0);
  /** The words of the audio that has been let go of. */
  private settled = "";
  private shown = "";
  private allowed = false;
  private stopped = false;
  private running = false;

  constructor(private readonly options: LiveWordsOptions) {}

  add(samples: Float32Array): void {
    if (this.stopped) return;
    this.audio = joined(this.audio, samples);
    this.listen();
  }

  allow(): void {
    this.allowed = true;
    this.listen();
  }

  /** The recording has ended, or the words may not show: nothing more is shown, not even from a recognition still running. */
  stop(): void {
    this.stopped = true;
    this.audio = new Float32Array(0);
  }

  private listen(): void {
    if (this.stopped || !this.allowed || this.running || this.audio.length === 0) return;
    this.running = true;
    void this.recognise()
      .catch((error: unknown) => {
        console.error("live words", error);
        const wereShowing = !this.stopped && this.shown !== "";
        this.stop();
        if (wereShowing) this.options.show("");
      })
      .finally(() => {
        this.running = false;
      });
  }

  private async recognise(): Promise<void> {
    if (this.audio.length >= SETTLE_AT) {
      const cut = quietestPoint(this.audio, this.audio.length - LOOK_BACK, this.audio.length - NOT_THE_LAST);
      const words = (await this.options.recognise(this.audio.subarray(0, cut))).trim();
      if (this.stopped) return;
      this.settled = sentence(this.settled, words);
      this.audio = this.audio.subarray(cut);
    }
    const words = sentence(this.settled, (await this.options.recognise(this.audio)).trim());
    if (this.stopped || !words || words === this.shown) return;
    this.shown = words;
    this.options.show(words);
  }
}
