import { describe, expect, it } from "vitest";
import { saysNothingHeard } from "../src/main/silence.ts";

const seconds = (s: number, level: number) => new Float32Array(Math.round(s * 16000)).fill(level);

describe("saysNothingHeard", () => {
  it("says so when the microphone gave no input at all, however short", () => {
    expect(saysNothingHeard(new Float32Array(0))).toBe(true);
    expect(saysNothingHeard(seconds(0.1, 0))).toBe(true);
    expect(saysNothingHeard(seconds(2, 0))).toBe(true);
  });

  it("goes quietly after a short press with sound in it", () => {
    expect(saysNothingHeard(seconds(0.2, 0.01))).toBe(false);
    expect(saysNothingHeard(seconds(4.9, 0.001))).toBe(false);
  });

  it("says so once a recording with sound runs past five seconds", () => {
    expect(saysNothingHeard(seconds(5.1, 0.01))).toBe(true);
  });
});
