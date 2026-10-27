// The five sounds, played into a fake AudioContext that writes down what is scheduled: nothing here is heard, and no audio device is
// needed. What the tests hold the sounds to is the spec's §4.6: each under 0.6 s and quiet, and each a stand-in whose last sample
// is where SOUND_MS says. They also hold the page to one AudioContext, and its record of what played (`__avanzelSounds`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioContextLike } from "../src/renderer/common/sounds.ts";
import type { SoundName } from "../src/shared/ipc.ts";

type Sounds = typeof import("../src/renderer/common/sounds.ts");

/** The module afresh: it keeps one AudioContext for the page, so each test is a new page. */
async function page(): Promise<Sounds> {
  vi.resetModules();
  return import("../src/renderer/common/sounds.ts");
}

class FakeParam {
  private current: number;
  /** What the code assigned to `.value`, in order. */
  readonly assigned: number[] = [];
  readonly events: { kind: "set" | "ramp"; value: number; time: number }[] = [];

  constructor(initial: number) {
    this.current = initial;
  }

  get value(): number {
    return this.current;
  }

  set value(value: number) {
    this.current = value;
    this.assigned.push(value);
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "set", value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "ramp", value, time });
    return this;
  }

  /** The highest level the parameter is told to take. Told nothing, it stays at its default, which for a gain is full. */
  peak(): number {
    const told = [...this.assigned, ...this.events.map((event) => event.value)];
    return told.length ? Math.max(...told) : this.current;
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];

  connect<Next extends FakeNode>(to: Next): Next {
    this.outputs.push(to);
    return to;
  }
}

class FakeOscillator extends FakeNode {
  type = "sine";
  readonly frequency = new FakeParam(440);
  startAt: number | null = null;
  stopAt: number | null = null;

  start(time: number): void {
    this.startAt = time;
  }

  stop(time: number): void {
    this.stopAt = time;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeFilter extends FakeNode {
  type = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
}

class FakeBuffer {
  private readonly samples: Float32Array;

  constructor(
    readonly channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.samples = new Float32Array(length);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(): Float32Array {
    return this.samples;
  }
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  startAt: number | null = null;

  start(time: number): void {
    this.startAt = time;
  }
}

class FakeContext {
  state = "running";
  /** Not zero, so a sound that schedules from zero instead of from now is caught. */
  currentTime = 10;
  readonly sampleRate = 48000;
  readonly destination = new FakeNode();
  resumed = 0;
  /** How many times the page closed it, and whether closing fails (a real context rejects if the device has gone, or it is closed already). */
  closed = 0;
  closeFails = false;
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly buffers: FakeBuffer[] = [];
  readonly sources: FakeSource[] = [];

  async resume(): Promise<void> {
    this.resumed += 1;
    this.state = "running";
  }

  async close(): Promise<void> {
    this.closed += 1;
    if (this.closeFails) throw new Error("The audio device has gone.");
    this.state = "closed";
  }

  createOscillator(): FakeOscillator {
    const made = new FakeOscillator();
    this.oscillators.push(made);
    return made;
  }

  createGain(): FakeGain {
    const made = new FakeGain();
    this.gains.push(made);
    return made;
  }

  createBiquadFilter(): FakeFilter {
    const made = new FakeFilter();
    this.filters.push(made);
    return made;
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    const made = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(made);
    return made;
  }

  createBufferSource(): FakeSource {
    const made = new FakeSource();
    this.sources.push(made);
    return made;
  }

  /** The context as `playSound` is given it. */
  get asAudio(): AudioContextLike {
    return this as unknown as AudioContextLike;
  }

  /** Milliseconds after the play that the last sample sounds: an oscillator's stop, or a buffer's end. A sound that never stops is infinite. */
  lastSampleMs(): number {
    const ends = [
      ...this.oscillators.map((oscillator) => oscillator.stopAt ?? Number.POSITIVE_INFINITY),
      ...this.sources.map((source) => (source.startAt === null ? Number.POSITIVE_INFINITY : source.startAt + (source.buffer?.duration ?? 0))),
    ];
    return (Math.max(...ends) - this.currentTime) * 1000;
  }

  /** Every sound source this play made. */
  allSources(): (FakeOscillator | FakeSource)[] {
    return [...this.oscillators, ...this.sources];
  }

  /** The gains a source passes on its way to the speakers; null if it never gets there. */
  gainsOnTheWay(from: FakeNode): FakeGain[] | null {
    if (from === this.destination) return [];
    for (const next of from.outputs) {
      const rest = this.gainsOnTheWay(next);
      if (rest) return from instanceof FakeGain ? [from, ...rest] : rest;
    }
    return null;
  }

  /** How loud each source can be: the product of the peaks of the gains it passes. Its own samples never pass 1, and nor does a band-pass. */
  levels(): number[] {
    return this.allSources().map((source) => {
      const gains = this.gainsOnTheWay(source);
      expect(gains, "every source reaches the speakers").not.toBeNull();
      return gains!.reduce((level, gain) => level * gain.gain.peak(), 1);
    });
  }
}

const NAMES: SoundName[] = ["tick", "tock", "stamp", "drawer", "letter"];

type Played = { name: string; at: number }[];
const played = () => (globalThis as { __avanzelSounds?: Played }).__avanzelSounds;

beforeEach(() => {
  delete (globalThis as { __avanzelSounds?: Played }).__avanzelSounds;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SOUND_MS", () => {
  it("is the time of each sound's last sample, and none is over 0.6 s", async () => {
    const { SOUND_MS } = await page();
    expect(SOUND_MS).toEqual({ tick: 80, tock: 90, stamp: 200, drawer: 220, letter: 570 });
    for (const name of NAMES) expect(SOUND_MS[name], name).toBeLessThanOrEqual(600);
  });
});

describe("the five sounds", () => {
  it.each(NAMES)("%s ends where SOUND_MS says, and within 0.6 s", async (name) => {
    const { playSound, SOUND_MS } = await page();
    const context = new FakeContext();
    playSound(name, () => context.asAudio);
    expect(context.lastSampleMs()).toBeLessThanOrEqual(600);
    expect(context.lastSampleMs()).toBeLessThanOrEqual(SOUND_MS[name] + 1e-6);
    expect(context.lastSampleMs()).toBeGreaterThanOrEqual(SOUND_MS[name] - 0.1); // and the table is no looser than the sound
  });

  it.each(NAMES)("%s starts now or later, never before it was played, and every source reaches the speakers", async (name) => {
    const { playSound } = await page();
    const context = new FakeContext();
    playSound(name, () => context.asAudio);
    for (const source of context.allSources()) {
      expect(source.startAt, "a source that starts").not.toBeNull();
      expect(source.startAt!).toBeGreaterThanOrEqual(context.currentTime);
    }
    expect(context.levels().length).toBeGreaterThan(0);
  });

  it.each(NAMES)("%s is quiet: no gain peaks over 0.35, and its layers together stay under 0.5", async (name) => {
    const { playSound } = await page();
    const context = new FakeContext();
    playSound(name, () => context.asAudio);
    for (const gain of context.gains) expect(gain.gain.peak()).toBeLessThanOrEqual(0.35);
    const together = context.levels().reduce((sum, level) => sum + level, 0);
    expect(together).toBeLessThanOrEqual(0.5);
  });

  it("the Stamp is two layers, a thud and a click, whose peaks sum to 0.5 at most", async () => {
    const { playSound } = await page();
    const context = new FakeContext();
    playSound("stamp", () => context.asAudio);
    expect(context.oscillators).toHaveLength(1);
    expect(context.sources).toHaveLength(1);
    expect(context.gains).toHaveLength(2);
    const [thud, click] = context.gains.map((gain) => gain.gain.peak());
    expect(thud! + click!).toBeLessThanOrEqual(0.5);
    expect(thud!).toBeGreaterThan(click!); // the thud is the stamp, and the click rides on it
  });

  it("the Tick and the Tock are one short sine each, the Tock lower than the Tick", async () => {
    const tick = new FakeContext();
    (await page()).playSound("tick", () => tick.asAudio);
    const tock = new FakeContext();
    (await page()).playSound("tock", () => tock.asAudio);
    for (const context of [tick, tock]) {
      expect(context.oscillators).toHaveLength(1);
      expect(context.oscillators[0]!.type).toBe("sine");
      expect(context.sources).toHaveLength(0);
    }
    expect(tock.oscillators[0]!.frequency.events[0]!.value).toBeLessThan(tick.oscillators[0]!.frequency.events[0]!.value);
  });

  it("the Drawer is a filtered rush of noise that opens upward, and the noise is audible and never over full scale", async () => {
    const { playSound } = await page();
    const context = new FakeContext();
    playSound("drawer", () => context.asAudio);
    expect(context.oscillators).toHaveLength(0);
    expect(context.sources).toHaveLength(1);
    const [filter] = context.filters;
    expect(filter!.type).toBe("bandpass");
    const sweep = filter!.frequency.events.map((event) => event.value);
    expect(sweep[sweep.length - 1]!).toBeGreaterThan(sweep[0]!);
    const noise = context.buffers[0]!.getChannelData();
    expect(noise.some((sample) => sample !== 0)).toBe(true);
    expect(Math.max(...noise.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it("the Letter is two soft bell notes, the second a fifth above the first and a tenth of a second behind it", async () => {
    const { playSound } = await page();
    const context = new FakeContext();
    playSound("letter", () => context.asAudio);
    expect(context.oscillators).toHaveLength(2);
    const [first, second] = context.oscillators;
    expect((second!.startAt! - first!.startAt!) * 1000).toBeCloseTo(100, 6);
    expect(second!.frequency.events[0]!.value / first!.frequency.events[0]!.value).toBeCloseTo(1.5, 1);
    expect(context.sources).toHaveLength(0);
  });
});

describe("the page's AudioContext", () => {
  it("is made at the first play, by the make it is given, and serves every play after", async () => {
    const { playSound } = await page();
    const context = new FakeContext();
    const make = vi.fn(() => context.asAudio);
    for (const name of NAMES) playSound(name, make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(context.oscillators.length).toBeGreaterThanOrEqual(5); // all five played into it
    const another = vi.fn(() => new FakeContext().asAudio);
    playSound("tick", another);
    expect(another).not.toHaveBeenCalled();
  });

  it("is not made by loading the module, and is a real AudioContext when no make is given", async () => {
    const context = new FakeContext();
    const Audio = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("AudioContext", Audio);
    const { playSound } = await page();
    expect(Audio).not.toHaveBeenCalled();
    playSound("tick");
    playSound("tock");
    expect(Audio).toHaveBeenCalledTimes(1);
    expect(context.oscillators).toHaveLength(2);
  });

  it("is resumed when it is suspended, and left be when it runs", async () => {
    const { playSound } = await page();
    const suspended = new FakeContext();
    suspended.state = "suspended";
    playSound("tick", () => suspended.asAudio);
    expect(suspended.resumed).toBe(1);
    playSound("tock", () => suspended.asAudio); // running now: not resumed again
    expect(suspended.resumed).toBe(1);

    const other = await page();
    const running = new FakeContext();
    other.playSound("tick", () => running.asAudio);
    expect(running.resumed).toBe(0);
  });
});

// Main tells the capsule's page when sounds go on and off (`capsule:sounds-setting`), and the page gets its AudioContext ready then:
// opening the audio device takes a tenth of a second, and it should not be the Tick's, which comes ahead of the listening card.
describe("getting the page's AudioContext ready, and letting go of it", () => {
  it("prepareSounds makes the context and plays nothing, and the first sound after it is played on that context", async () => {
    const { playSound, prepareSounds } = await page();
    const context = new FakeContext();
    const make = vi.fn(() => context.asAudio);
    prepareSounds(make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(context.allSources()).toHaveLength(0);
    expect(played() ?? []).toEqual([]); // a context made is not a sound played
    const another = vi.fn(() => new FakeContext().asAudio);
    playSound("tick", another);
    expect(another).not.toHaveBeenCalled();
    expect(context.oscillators).toHaveLength(1);
    expect(played()?.map((entry) => entry.name)).toEqual(["tick"]);
  });

  it("makes one context however often it is prepared, and a sound before it has made it", async () => {
    const { playSound, prepareSounds } = await page();
    const context = new FakeContext();
    const make = vi.fn(() => context.asAudio);
    prepareSounds(make);
    prepareSounds(make);
    playSound("stamp", make);
    prepareSounds(make);
    expect(make).toHaveBeenCalledTimes(1);

    const first = await page(); // and the other way about: a context a sound made is the one prepare keeps
    const made = new FakeContext();
    const makeLate = vi.fn(() => made.asAudio);
    first.playSound("tock", makeLate);
    first.prepareSounds(makeLate);
    expect(makeLate).toHaveBeenCalledTimes(1);
  });

  it("wakes a context that is suspended as it is prepared, and leaves one that runs", async () => {
    const { prepareSounds } = await page();
    const suspended = new FakeContext();
    suspended.state = "suspended";
    prepareSounds(() => suspended.asAudio);
    expect(suspended.resumed).toBe(1);
    prepareSounds(() => suspended.asAudio); // running now
    expect(suspended.resumed).toBe(1);

    const other = await page();
    const running = new FakeContext();
    other.prepareSounds(() => running.asAudio);
    expect(running.resumed).toBe(0);
  });

  it("is a real AudioContext when no make is given, made when it is prepared and not before", async () => {
    const context = new FakeContext();
    const Audio = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("AudioContext", Audio);
    const { prepareSounds } = await page();
    expect(Audio).not.toHaveBeenCalled();
    prepareSounds();
    expect(Audio).toHaveBeenCalledTimes(1);
  });

  it("never throws for a page without audio: nothing is made, and the next prepare, or the next sound, tries again", async () => {
    const { playSound, prepareSounds } = await page();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() =>
      prepareSounds(() => {
        throw new Error("no audio output");
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    const context = new FakeContext();
    const make = vi.fn(() => context.asAudio);
    prepareSounds(make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(played() ?? []).toEqual([]);
    playSound("tick", make);
    expect(make).toHaveBeenCalledTimes(1);

    const other = await page(); // a sound after a failed prepare makes the context itself
    other.prepareSounds(() => {
      throw new Error("no audio output");
    });
    const late = new FakeContext();
    other.playSound("tock", () => late.asAudio);
    expect(late.oscillators).toHaveLength(1);
  });

  it("releaseSounds closes the context and lets go of it, so that the next sound makes another", async () => {
    const { playSound, prepareSounds, releaseSounds } = await page();
    const first = new FakeContext();
    prepareSounds(() => first.asAudio);
    releaseSounds();
    expect(first.closed).toBe(1);
    expect(first.state).toBe("closed");
    const second = new FakeContext();
    const make = vi.fn(() => second.asAudio);
    playSound("tick", make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(second.oscillators).toHaveLength(1);
    expect(first.allSources()).toHaveLength(0); // nothing went to the one that was closed
    releaseSounds();
    expect(second.closed).toBe(1);
    expect(first.closed).toBe(1); // and the first is not closed again
  });

  it("lets go of a context that a sound made, as well as one that was prepared", async () => {
    const { playSound, releaseSounds } = await page();
    const context = new FakeContext();
    playSound("stamp", () => context.asAudio);
    releaseSounds();
    expect(context.closed).toBe(1);
  });

  it("releaseSounds for a page with no context does nothing, however often, and a context made after it is not closed by it", async () => {
    const { prepareSounds, releaseSounds } = await page();
    expect(() => {
      releaseSounds();
      releaseSounds();
    }).not.toThrow();
    const context = new FakeContext();
    prepareSounds(() => context.asAudio);
    expect(context.closed).toBe(0);
    expect(context.state).toBe("running");
  });

  it("lets go of a context that will not close all the same, without an error", async () => {
    const { playSound, releaseSounds } = await page();
    const stuck = new FakeContext();
    stuck.closeFails = true;
    playSound("tick", () => stuck.asAudio);
    expect(() => releaseSounds()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0)); // a rejection nobody caught would fail the run here
    expect(stuck.closed).toBe(1);
    const fresh = new FakeContext();
    playSound("tock", () => fresh.asAudio);
    expect(fresh.oscillators).toHaveLength(1);
  });

  it("is made again by a prepare after a release, as when sounds go on, off and on", async () => {
    const { prepareSounds, releaseSounds } = await page();
    const first = new FakeContext();
    const second = new FakeContext();
    const makeSecond = vi.fn(() => second.asAudio);
    prepareSounds(() => first.asAudio);
    releaseSounds();
    prepareSounds(makeSecond);
    expect(makeSecond).toHaveBeenCalledTimes(1); // the context that was closed is not the one kept
    expect([first.closed, second.closed]).toEqual([1, 0]);
    expect(second.state).toBe("running");
  });
});

// A window's own sounds: Preview sounds, in setup and in Settings, and the Stamp that says sounds are switched on. They play outside main's
// gate for the capsule (controller.ts, `sound`), which keeps everything but a recording's own Tick and Tock out of a recording: the recorder
// keeps no echo cancellation, so a sound would be heard in the words. So each of them asks main right before it plays (`may`, the bridge's
// `mayPlaySounds`), and plays only if main says it may, which it does not while a recording runs.
describe("Preview sounds", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const names = () => (played() ?? []).map((entry) => entry.name);
  const yes = () => Promise.resolve(true);

  it("plays the Tick at once, the Stamp 260 ms after it, the Drawer at 520 and the Letter at 800", async () => {
    vi.useFakeTimers();
    const { previewSounds } = await page();
    const context = new FakeContext();
    previewSounds(yes, () => context.asAudio);
    await vi.advanceTimersByTimeAsync(0);
    expect(names()).toEqual(["tick"]);
    await vi.advanceTimersByTimeAsync(259);
    expect(names()).toEqual(["tick"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(names()).toEqual(["tick", "stamp"]);
    await vi.advanceTimersByTimeAsync(259);
    expect(names()).toEqual(["tick", "stamp"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(names()).toEqual(["tick", "stamp", "drawer"]);
    await vi.advanceTimersByTimeAsync(279);
    expect(names()).toEqual(["tick", "stamp", "drawer"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(names()).toEqual(["tick", "stamp", "drawer", "letter"]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(names()).toEqual(["tick", "stamp", "drawer", "letter"]); // once each
    const [tick, stamp, drawer, letter] = played()!;
    expect([stamp!.at - tick!.at, drawer!.at - tick!.at, letter!.at - tick!.at]).toEqual([260, 520, 800]);
  });

  it("counts from the Tick: a first sound that takes its time to open the audio device moves the others with it, and the spacing holds", async () => {
    vi.useFakeTimers();
    const { previewSounds } = await page();
    const context = new FakeContext();
    // Opening the audio device blocks the page's thread for about a tenth of a second, the first time.
    const slow = () => {
      vi.advanceTimersByTime(100);
      return context.asAudio;
    };
    previewSounds(yes, slow);
    await vi.advanceTimersByTimeAsync(2_000);
    const [tick, stamp, drawer, letter] = played()!;
    expect(names()).toEqual(["tick", "stamp", "drawer", "letter"]);
    expect([stamp!.at - tick!.at, drawer!.at - tick!.at, letter!.at - tick!.at]).toEqual([260, 520, 800]);
  });

  it("leaves each sound room to end before the next begins, by the length each has (SOUND_MS)", async () => {
    vi.useFakeTimers();
    const { previewSounds, SOUND_MS } = await page();
    previewSounds(yes, () => new FakeContext().asAudio);
    await vi.advanceTimersByTimeAsync(2_000);
    const heard = played()!;
    expect(heard.map((entry) => entry.name)).toEqual(["tick", "stamp", "drawer", "letter"]);
    for (let i = 1; i < heard.length; i += 1) {
      const before = heard[i - 1]!;
      expect(heard[i]!.at - before.at, `${heard[i]!.name} begins after ${before.name} has ended`).toBeGreaterThanOrEqual(SOUND_MS[before.name as SoundName]);
    }
  });

  it("asks main right before each of the four sounds, and plays only the ones it says may be", async () => {
    vi.useFakeTimers();
    const { previewSounds } = await page();
    const context = new FakeContext();
    // A recording starts during the Preview: main says yes to the Tick and the Stamp, and no to what is left.
    const answers = [true, true, false, false];
    const may = vi.fn(() => Promise.resolve(answers.shift()!));
    previewSounds(may, () => context.asAudio);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(may).toHaveBeenCalledTimes(4);
    expect(names()).toEqual(["tick", "stamp"]);
  });

  it("plays nothing, and makes no audio context, while main says a recording runs", async () => {
    vi.useFakeTimers();
    const { previewSounds } = await page();
    const make = vi.fn(() => new FakeContext().asAudio);
    const may = vi.fn(() => Promise.resolve(false));
    previewSounds(may, make);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(names()).toEqual([]);
    expect(make).not.toHaveBeenCalled();
    expect(may).toHaveBeenCalledTimes(1); // the first answer was no, so it is not asked about the rest
  });

  it("plays nothing when main can't be asked, and throws nothing: quiet is the safe side", async () => {
    vi.useFakeTimers();
    const { previewSounds } = await page();
    const make = vi.fn(() => new FakeContext().asAudio);
    previewSounds(() => Promise.reject(new Error("The window is closing.")), make);
    await vi.advanceTimersByTimeAsync(2_000); // a rejection nobody caught would fail the run here
    expect(names()).toEqual([]);
    expect(make).not.toHaveBeenCalled();
  });

  it("makes the page's one context, and plays all four into it", async () => {
    vi.useFakeTimers();
    const { previewSounds } = await page();
    const context = new FakeContext();
    const make = vi.fn(() => context.asAudio);
    previewSounds(yes, make);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(make).toHaveBeenCalledTimes(1);
    expect(context.oscillators.length).toBeGreaterThanOrEqual(4); // the Tick, the Stamp's thud, the Letter's two notes
    expect(context.sources).toHaveLength(2); // and the Stamp's click and the Drawer's rush
  });

  it("is a real AudioContext when no make is given", async () => {
    vi.useFakeTimers();
    const context = new FakeContext();
    const Audio = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("AudioContext", Audio);
    const { previewSounds } = await page();
    previewSounds(yes);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(Audio).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(["tick", "stamp", "drawer", "letter"]);
  });
});

// What a window does when its Play sounds switch changes, once the change is saved.
describe("Switching sounds on or off in a window", () => {
  const names = () => (played() ?? []).map((entry) => entry.name);
  const yes = () => Promise.resolve(true);

  it("plays the Stamp when they are switched on, if main says it may", async () => {
    const { soundsSwitched } = await page();
    const context = new FakeContext();
    const may = vi.fn(yes);
    soundsSwitched(true, may, () => context.asAudio);
    await Promise.resolve();
    await Promise.resolve();
    expect(may).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(["stamp"]);
  });

  it("plays nothing, and makes no audio context, while main says a recording runs", async () => {
    const { soundsSwitched } = await page();
    const make = vi.fn(() => new FakeContext().asAudio);
    soundsSwitched(true, () => Promise.resolve(false), make);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(names()).toEqual([]);
    expect(make).not.toHaveBeenCalled();
  });

  it("plays nothing when main can't be asked, and throws nothing", async () => {
    const { soundsSwitched } = await page();
    const make = vi.fn(() => new FakeContext().asAudio);
    expect(() => soundsSwitched(true, () => Promise.reject(new Error("The window is closing.")), make)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0)); // a rejection nobody caught would fail the run here
    expect(names()).toEqual([]);
    expect(make).not.toHaveBeenCalled();
  });

  it("lets go of the window's audio device when they are switched off, without asking main and without a sound", async () => {
    const { prepareSounds, soundsSwitched } = await page();
    const context = new FakeContext();
    prepareSounds(() => context.asAudio);
    const may = vi.fn(yes);
    soundsSwitched(false, may);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.closed).toBe(1);
    expect(may).not.toHaveBeenCalled();
    expect(names()).toEqual([]);
  });

  it("does nothing for a window that has no audio context to let go of", async () => {
    const { soundsSwitched } = await page();
    expect(() => soundsSwitched(false, () => Promise.resolve(true))).not.toThrow();
  });
});

describe("what played", () => {
  it("is noted as { name, at } in globalThis.__avanzelSounds, at performance.now()", async () => {
    const { playSound } = await page();
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 5));
    const context = new FakeContext();
    playSound("tick", () => context.asAudio);
    playSound("stamp", () => context.asAudio);
    expect(played()).toEqual([
      { name: "tick", at: 1005 },
      { name: "stamp", at: 1010 },
    ]);
  });

  it("keeps the last 20, oldest dropped", async () => {
    const { playSound } = await page();
    const context = new FakeContext();
    for (let i = 0; i < 27; i += 1) playSound(NAMES[i % NAMES.length]!, () => context.asAudio);
    const log = played()!;
    expect(log).toHaveLength(20);
    expect(log.map((entry) => entry.name)).toEqual(Array.from({ length: 20 }, (_, i) => NAMES[(i + 7) % NAMES.length]));
    expect(log.map((entry) => entry.at)).toEqual([...log.map((entry) => entry.at)].sort((a, b) => a - b));
  });

  it("is not noted for a sound that could not play, and playing never throws: a page without audio is a page without sounds", async () => {
    const { playSound } = await page();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() =>
      playSound("tick", () => {
        throw new Error("no audio output");
      }),
    ).not.toThrow();
    expect(played() ?? []).toEqual([]);
    // The next play tries again, and works.
    const context = new FakeContext();
    playSound("tock", () => context.asAudio);
    expect(played()?.map((entry) => entry.name)).toEqual(["tock"]);
  });
});
