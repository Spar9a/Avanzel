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
  // Each side has more than one segment, as the transcriber's segments give it; a far-off one on each side keeps the rule on.
  const them = [
    { start: 0, end: 3, text: "Morning, everyone." },
    { start: 10, end: 14, text: "We ship the beta on Friday." },
  ];
  const elsewhere = { start: 40, end: 42, text: "Talk to you later then." };
  const kept = (segment: { start: number; end: number; text: string }) => dropEcho([segment, elsewhere], them).includes(segment);

  it("drops a segment the other side covers by half and repeats in order", () => {
    const you = { start: 10.5, end: 13.5, text: "we ship the beta on friday" };
    expect(dropEcho([you, elsewhere], them)).toEqual([elsewhere]);
  });

  it("keeps a segment that overlaps but says something else", () => {
    expect(kept({ start: 10.5, end: 13.5, text: "Could we talk about pricing instead?" })).toBe(true);
  });

  it("keeps a segment that does not overlap", () => {
    expect(kept({ start: 20, end: 23, text: "We ship the beta on Friday." })).toBe(true);
  });

  it("keeps a segment the other side overlaps by less than half", () => {
    expect(kept({ start: 13, end: 17, text: "We ship the beta on Friday." })).toBe(true);
  });

  it("ignores case and punctuation when matching words", () => {
    expect(kept({ start: 10, end: 14, text: "WE, ship... the beta (maybe)" })).toBe(false);
  });

  it("keeps a segment with fewer than 60 % of its words in the covering one", () => {
    expect(kept({ start: 10, end: 14, text: "we ship pricing tomorrow okay" })).toBe(true);
  });

  it("keeps a segment whose words are in the covering one, but not in its order", () => {
    expect(kept({ start: 10, end: 14, text: "Friday on beta the ship we" })).toBe(true);
  });

  it("keeps a short agreement said inside a long segment of the other side", () => {
    const long = [
      { start: 0, end: 20, text: "Okay so the plan is this, it sounds good to me and I think we should go ahead with it" },
      { start: 30, end: 33, text: "Anything else?" },
    ];
    const you = { start: 5, end: 6.5, text: "Okay, sounds good." };
    expect(dropEcho([you, elsewhere], long)).toEqual([you, elsewhere]);
  });

  it("never takes a segment of fewer than three words for an echo", () => {
    const short = [
      { start: 0, end: 1, text: "Yes, okay." },
      { start: 30, end: 33, text: "Anything else?" },
    ];
    const you = { start: 0, end: 1, text: "Yes, okay." };
    expect(dropEcho([you, elsewhere], short)).toEqual([you, elsewhere]);
  });

  it("does nothing when either side is one whole-stream segment, as a transcriber without segments gives", () => {
    const whole = [{ start: 0, end: 60, text: "So we ship the beta on Friday and the deadline for the draft is Thursday" }];
    const you = [{ start: 0, end: 50, text: "We ship the beta on Friday, the draft is Thursday" }];
    expect(dropEcho(you, whole)).toEqual(you);
    const twoOfYours = [
      { start: 0, end: 25, text: "We ship the beta on Friday" },
      { start: 25, end: 50, text: "and the draft is Thursday" },
    ];
    expect(dropEcho(twoOfYours, whole)).toEqual(twoOfYours);
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
