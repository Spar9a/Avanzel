import { describe, expect, it } from "vitest";
import { callTranscript, dropEcho, mergeCall } from "../../src/core/calls.ts";

describe("mergeCall", () => {
  it("orders both sides by start, ties going to them, and keeps each speaker", () => {
    const you = [
      { start: 0, end: 2, text: "Hi Mark" },
      { start: 5, end: 6, text: "Sure" },
    ];
    const them = [
      { start: 5, end: 7, text: "Can you?" },
      { start: 2.4, end: 4, text: "Hello" },
    ];
    expect(mergeCall(you, them)).toEqual([
      { speaker: "you", start: 0, end: 2, text: "Hi Mark" },
      { speaker: "them", start: 2.4, end: 4, text: "Hello" },
      { speaker: "them", start: 5, end: 7, text: "Can you?" },
      { speaker: "you", start: 5, end: 6, text: "Sure" },
    ]);
  });
});

describe("dropEcho", () => {
  const them = [{ start: 10, end: 14, text: "We ship the beta on Friday." }];

  it("drops a segment the other side covers by half and mostly repeats", () => {
    const you = [{ start: 10.5, end: 13.5, text: "we ship the beta on friday" }];
    expect(dropEcho(you, them)).toEqual([]);
  });

  it("keeps a segment that overlaps but says something else", () => {
    const you = [{ start: 10.5, end: 13.5, text: "Could we talk about pricing instead?" }];
    expect(dropEcho(you, them)).toEqual(you);
  });

  it("keeps a segment that does not overlap", () => {
    const you = [{ start: 20, end: 23, text: "We ship the beta on Friday." }];
    expect(dropEcho(you, them)).toEqual(you);
  });

  it("keeps a segment the other side overlaps by less than half", () => {
    const you = [{ start: 13, end: 17, text: "We ship the beta on Friday." }];
    expect(dropEcho(you, them)).toEqual(you);
  });

  it("ignores case and punctuation when counting repeated words", () => {
    const you = [{ start: 10, end: 14, text: "WE, ship... the beta (maybe)" }];
    expect(dropEcho(you, them)).toEqual([]);
  });

  it("keeps a segment with fewer than 60 % of its words in the overlapping one", () => {
    const you = [{ start: 10, end: 14, text: "we ship pricing tomorrow okay" }];
    expect(dropEcho(you, them)).toEqual(you);
  });
});

describe("callTranscript", () => {
  it("writes one paragraph per line, led by a minute and second stamp", () => {
    expect(
      callTranscript([
        { speaker: "you", start: 0, end: 2, text: "Hi Mark" },
        { speaker: "them", start: 2.4, end: 5, text: "Hello" },
      ]),
    ).toBe("[00:00] You: Hi Mark\n\n[00:02] Them: Hello\n");
  });

  it("lets minutes pass 59 instead of adding hours", () => {
    expect(callTranscript([{ speaker: "them", start: 61 * 60 + 5, end: 3700, text: "Still here" }])).toBe(
      "[61:05] Them: Still here\n",
    );
  });
});
