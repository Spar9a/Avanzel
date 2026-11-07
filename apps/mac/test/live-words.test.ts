import { describe, expect, it, vi } from "vitest";
import { LiveWords, quietestPoint } from "../src/main/live-words.ts";

const RATE = 16000;

/** `seconds` of steady sound, loud enough that any quiet stretch laid over it is the quietest place. */
const sound = (seconds: number, level = 0.5): Float32Array => new Float32Array(Math.round(seconds * RATE)).fill(level);

/** A LiveWords whose recognitions wait until the test answers them, oldest first, and what it showed. */
function harness() {
  const asked: Float32Array[] = [];
  const answers: { resolve: (words: string) => void; reject: (error: Error) => void }[] = [];
  const shown: string[] = [];
  const live = new LiveWords({
    recognise: (samples) =>
      new Promise<string>((resolve, reject) => {
        asked.push(samples);
        answers.push({ resolve, reject });
      }),
    show: (words) => shown.push(words),
  });
  /** Answers the oldest recognition still waiting, and lets what follows it run. */
  const answer = async (words: string) => {
    answers.shift()!.resolve(words);
    await flush();
  };
  const fail = async () => {
    answers.shift()!.reject(new Error("no model"));
    await flush();
  };
  return { live, asked, shown, answer, fail, waiting: () => answers.length };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("quietestPoint", () => {
  it("is the middle of the quietest 20 ms between the two places", () => {
    const samples = sound(4);
    samples.fill(0, RATE * 2, RATE * 2 + 320);
    expect(quietestPoint(samples, RATE, RATE * 3)).toBe(RATE * 2 + 160);
  });

  it("looks only between the two places", () => {
    const samples = sound(4);
    samples.fill(0, 0, 320); // quieter, but before where it looks
    samples.fill(0.1, RATE * 2, RATE * 2 + 320);
    expect(quietestPoint(samples, RATE, RATE * 3)).toBe(RATE * 2 + 160);
  });

  it("takes the first of places just as quiet", () => {
    expect(quietestPoint(new Float32Array(RATE), 0, RATE)).toBe(160);
  });

  it("is the start when there is less than a frame to look at", () => {
    expect(quietestPoint(sound(1), 100, 200)).toBe(100);
  });
});

describe("LiveWords", () => {
  it("hears nothing until it is allowed to show, then starts from all the audio so far", async () => {
    const { live, asked, shown, answer } = harness();
    live.add(sound(1));
    live.add(sound(1));
    expect(asked).toEqual([]);
    live.allow();
    expect(asked.map((samples) => samples.length)).toEqual([RATE * 2]);
    await answer("hello there");
    expect(shown).toEqual(["hello there"]);
  });

  it("asks nothing when it is allowed before any audio has come", () => {
    const { live, asked } = harness();
    live.allow();
    expect(asked).toEqual([]);
  });

  it("shows the words of everything said so far, each time audio comes", async () => {
    const { live, asked, shown, answer } = harness();
    live.allow();
    live.add(sound(1));
    await answer("hello");
    live.add(sound(1));
    expect(asked.map((samples) => samples.length)).toEqual([RATE, RATE * 2]);
    await answer("hello there");
    expect(shown).toEqual(["hello", "hello there"]);
  });

  it("recognises one at a time: audio that comes meanwhile waits for the next block", async () => {
    const { live, asked, answer, waiting } = harness();
    live.allow();
    live.add(sound(1));
    live.add(sound(1));
    live.add(sound(1));
    expect(waiting()).toBe(1);
    await answer("hello");
    expect(waiting()).toBe(0); // a slow Mac is not kept busy: the next block starts the next one
    live.add(sound(1));
    expect(asked.map((samples) => samples.length)).toEqual([RATE, RATE * 4]);
  });

  it("shows nothing for words that are empty or the same as the last", async () => {
    const { live, shown, answer } = harness();
    live.allow();
    live.add(sound(1));
    await answer("  ");
    live.add(sound(1));
    await answer("hello");
    live.add(sound(1));
    await answer("hello");
    expect(shown).toEqual(["hello"]);
  });

  it("settles what has been said once it has 12 s, at the quietest place of the last 4 s, and hears only the rest from then on", async () => {
    const { live, asked, shown, answer } = harness();
    live.allow();
    const long = sound(12);
    const quiet = RATE * 10;
    long.fill(0, quiet, quiet + 320);
    live.add(long);
    expect(asked[0]!.length).toBe(quiet + 160); // what comes before the quiet place, on its own
    await answer("the first part");
    expect(asked[1]!.length).toBe(RATE * 12 - quiet - 160); // then what comes after it
    await answer("and the rest");
    expect(shown).toEqual(["the first part and the rest"]);

    live.add(sound(1));
    expect(asked[2]!.length).toBe(RATE * 13 - quiet - 160);
    await answer("and the rest of it");
    expect(shown.at(-1)).toBe("the first part and the rest of it");
  });

  it("settles again and again, so a long dictation never asks more than the last 12 s", async () => {
    const { live, asked, shown, answer, waiting } = harness();
    live.allow();
    for (let second = 0; second < 40; second++) {
      live.add(sound(1));
      for (let i = 0; waiting() > 0; i++) await answer(`part${asked.length}`);
    }
    expect(Math.max(...asked.map((samples) => samples.length))).toBeLessThanOrEqual(RATE * 13);
    expect(shown.at(-1)!.split(" ").length).toBeGreaterThan(2); // the parts it settled are all still there
  });

  it("keeps what it settled when what follows has no words", async () => {
    const { live, shown, answer } = harness();
    live.allow();
    live.add(sound(12));
    await answer("the first part");
    await answer("");
    expect(shown).toEqual(["the first part"]);
  });

  it("shows nothing once stopped: not the recognition still running, and nothing for audio that comes late", async () => {
    const { live, asked, shown, answer } = harness();
    live.allow();
    live.add(sound(1));
    live.stop();
    await answer("too late");
    live.add(sound(1));
    live.allow();
    expect(shown).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it("stops between the two parts of settling when it is stopped", async () => {
    const { live, asked, shown, answer } = harness();
    live.allow();
    live.add(sound(12));
    live.stop();
    await answer("the first part");
    expect(asked).toHaveLength(1);
    expect(shown).toEqual([]);
  });

  it("gives up quietly when a recognition fails: the words that are pasted come from their own recognition", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { live, asked, shown, fail } = harness();
    live.allow();
    live.add(sound(1));
    await fail();
    live.add(sound(1));
    expect(asked).toHaveLength(1);
    expect(shown).toEqual([]);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("takes its words off the card when a recognition fails after some have shown, as they would never change again", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { live, shown, answer, fail } = harness();
    live.allow();
    live.add(sound(1));
    await answer("hello");
    live.add(sound(1));
    await fail();
    expect(shown).toEqual(["hello", ""]);
    logged.mockRestore();
  });

  it("holds no audio once stopped", () => {
    const { live, asked } = harness();
    live.add(sound(1));
    live.stop();
    live.allow();
    expect(asked).toEqual([]);
  });
});
