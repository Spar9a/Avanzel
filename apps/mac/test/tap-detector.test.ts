import { describe, expect, it } from "vitest";
import { TapDetector } from "../src/main/tap-detector.ts";

const down = { event: "modifier", down: true } as const;
const up = { event: "modifier", down: false } as const;
const key = { event: "key" } as const;

/** Pushes the events in order and gives what each one said. */
function run(...events: Parameters<TapDetector["push"]>[0][]): boolean[] {
  const detector = new TapDetector();
  return events.map((event) => detector.push(event));
}

describe("TapDetector", () => {
  it("counts a press and release of the key as a tap, at the release", () => {
    expect(run(down, up)).toEqual([false, true]);
  });

  it("does not count the key used in a shortcut: another key between press and release breaks the tap", () => {
    expect(run(down, key, up)).toEqual([false, false, false]);
  });

  it("counts a release the helper repeated as one tap", () => {
    expect(run(down, up, up)).toEqual([false, true, false]);
  });

  it("ignores a key or a click with no press of the watched key", () => {
    expect(run(key, key)).toEqual([false, false]);
  });

  it("counts a press the helper repeated as one tap", () => {
    expect(run(down, down, up)).toEqual([false, false, true]);
  });

  it("counts a second tap after the first as another", () => {
    expect(run(down, up, down, up)).toEqual([false, true, false, true]);
  });

  it("does not let a broken tap spoil the next one", () => {
    expect(run(down, key, up, down, up)).toEqual([false, false, false, false, true]);
  });

  it("does not let a key typed before a press break the tap that follows", () => {
    expect(run(key, down, up)).toEqual([false, false, true]);
  });
});
