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
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly buffers: FakeBuffer[] = [];
  readonly sources: FakeSource[] = [];

  async resume(): Promise<void> {
    this.resumed += 1;
    this.state = "running";
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
