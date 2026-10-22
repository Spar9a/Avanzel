import { describe, expect, it } from "vitest";
import { answeredLine, failureLines } from "../src/renderer/ask/copy.ts";

describe("ask copy", () => {
  it("answeredLine counts whole seconds and never says 0 s", () => {
    expect(answeredLine("fake", 0.2)).toBe("fake answered in 1 s");
    expect(answeredLine("Claude Code", 12.6)).toBe("Claude Code answered in 13 s");
  });

  it("failureLines splits what happened from what the agent said", () => {
    expect(failureLines("fake couldn't answer.\nagent crashed: not logged in")).toEqual({
      title: "fake couldn't answer.",
      body: "agent crashed: not logged in",
    });
    // Nothing ran: the message alone is the title.
    expect(failureLines('Ask a question, e.g. "what are my goals this year?"')).toEqual({
      title: 'Ask a question, e.g. "what are my goals this year?"',
      body: "",
    });
  });

  it("failureLines joins the agent's lines with spaces and skips the empty ones", () => {
    expect(failureLines("Codex couldn't answer.\n  echoed prompt line  \n\nERROR: the model is not supported\n")).toEqual({
      title: "Codex couldn't answer.",
      body: "echoed prompt line ERROR: the model is not supported",
    });
    expect(failureLines("")).toEqual({ title: "", body: "" });
  });
});
