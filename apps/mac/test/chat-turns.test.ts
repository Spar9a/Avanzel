import { describe, expect, it } from "vitest";
import { CHAT_TURN_CHARACTERS, CHAT_TURNS_TAKEN, chatTurns } from "../src/shared/ipc.ts";

describe("chatTurns", () => {
  it("keeps the turns of a chat as they were handed", () => {
    const turns = [
      { question: "What are my goals?", answer: "Run a marathon." },
      { question: "When?", answer: "In spring." },
    ];
    expect(chatTurns(turns)).toEqual(turns);
  });

  it("gives none for anything but a list, and drops turns that aren't a question and an answer of text", () => {
    for (const value of [undefined, null, "turns", 3, { question: "Q", answer: "A" }]) expect(chatTurns(value)).toEqual([]);
    const mixed = [null, "Q", { question: "Q" }, { question: 1, answer: "A" }, { question: "Q?", answer: "A.", extra: true }];
    expect(chatTurns(mixed)).toEqual([{ question: "Q?", answer: "A." }]);
  });

  it("keeps only the newest turns, each cut to size", () => {
    const many = Array.from({ length: CHAT_TURNS_TAKEN + 5 }, (_, i) => ({ question: `Q${i}`, answer: "a".repeat(CHAT_TURN_CHARACTERS + 10) }));
    const kept = chatTurns(many);
    expect(kept).toHaveLength(CHAT_TURNS_TAKEN);
    expect(kept[0]!.question).toBe("Q5");
    expect(kept[0]!.answer).toHaveLength(CHAT_TURN_CHARACTERS);
  });
});
