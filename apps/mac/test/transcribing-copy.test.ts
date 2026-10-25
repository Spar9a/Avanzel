import { describe, expect, it } from "vitest";
import { transcribedLine, transcribingLine } from "../src/shared/transcribing.ts";

// The capsule's words about turning a recording into text. The engine's own model runs on this Mac; the command in a library's
// [voice] settings can run anywhere, so for it the words don't say where.

describe("the capsule's words about turning a recording into text", () => {
  it("while the words are made, say where only when it is on this Mac", () => {
    expect(transcribingLine(true)).toBe("Transcribing on this Mac…");
    expect(transcribingLine(false)).toBe("Transcribing…");
  });

  it("once they are made, say how long they took, in seconds with one decimal, and where only when it is on this Mac", () => {
    expect(transcribedLine(1.4, true)).toBe("Transcribed on this Mac in 1.4 seconds");
    expect(transcribedLine(1.4, false)).toBe("Transcribed in 1.4 seconds");
    expect(transcribedLine(0, false)).toBe("Transcribed in 0.0 seconds");
    expect(transcribedLine(12.34, true)).toBe("Transcribed on this Mac in 12.3 seconds");
  });

  it("claim nothing about this Mac for a command", () => {
    for (const line of [transcribingLine(false), transcribedLine(2, false)]) expect(line).not.toMatch(/this Mac|locally|offline/i);
  });

  it("are written as the design rules ask: sentence case, the one-character ellipsis, no “!”", () => {
    for (const on of [true, false]) {
      for (const line of [transcribingLine(on), transcribedLine(3.2, on)]) {
        expect(line).toMatch(/^\p{Lu}/u);
        expect(line).not.toContain("!");
        expect(line).not.toContain("...");
      }
    }
  });
});
