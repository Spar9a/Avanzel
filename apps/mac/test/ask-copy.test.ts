import { describe, expect, it } from "vitest";
import { answeredLine, failureLines, LOOKING, waitingLine } from "../src/renderer/ask/copy.ts";

describe("ask copy", () => {
  it("answeredLine counts whole seconds and never says 0 s", () => {
    expect(answeredLine("fake", 0.2)).toBe("fake answered in 1 s");
    expect(answeredLine("Claude Code", 12.6)).toBe("Claude Code answered in 13 s");
  });

  it("failureLines splits what happened from what is safe, then what the agent said", () => {
    // The run changed nothing in the library. The agent's line is as setup shows one: a capital, and a full stop.
    expect(failureLines("fake couldn't answer.\nagent crashed: not logged in", false)).toEqual({
      title: "fake couldn't answer.",
      body: "Your library hasn't changed. Agent crashed: not logged in.",
    });
    // Nothing ran: the message alone is the title, and the body says only what is safe.
    expect(failureLines('Ask a question, e.g. "what are my goals this year?"', false)).toEqual({
      title: 'Ask a question, e.g. "what are my goals this year?"',
      body: "Your library hasn't changed.",
    });
  });

  it("failureLines says the library hasn't changed only when the run changed nothing in it", () => {
    // The run left a change, as an agent that doesn't keep to read-only may: the body is the agent's line alone.
    expect(failureLines("OpenCode couldn't answer.\nagent crashed: not logged in", true)).toEqual({
      title: "OpenCode couldn't answer.",
      body: "Agent crashed: not logged in.",
    });
    expect(failureLines("OpenCode couldn't answer.", true)).toEqual({ title: "OpenCode couldn't answer.", body: "" });
  });

  it("failureLines joins the agent's lines with spaces, skips the empty ones, and drops a first Error label", () => {
    expect(failureLines("Codex couldn't answer.\n  echoed prompt line  \n\nERROR: the model is not supported\n", false)).toEqual({
      title: "Codex couldn't answer.",
      body: "Your library hasn't changed. Echoed prompt line ERROR: the model is not supported.",
    });
    expect(failureLines("Claude Code couldn't answer.\nError: usage limit reached", false)).toEqual({
      title: "Claude Code couldn't answer.",
      body: "Your library hasn't changed. Usage limit reached.",
    });
    expect(failureLines("", false)).toEqual({ title: "", body: "Your library hasn't changed." });
  });

  it("waitingLine says the agent looks, and counts its whole seconds only from 10 s on", () => {
    expect(LOOKING).toBe("Looking through your library…");
    // Before main has said anything, and once it says the agent looks.
    for (const progress of [null, LOOKING]) {
      expect(waitingLine(progress, 0)).toEqual({ line: LOOKING, counting: false });
      expect(waitingLine(progress, 9.9)).toEqual({ line: LOOKING, counting: false });
      expect(waitingLine(progress, 10)).toEqual({ line: "Looking through your library: 10 s", counting: true });
      expect(waitingLine(progress, 12.7)).toEqual({ line: "Looking through your library: 12 s", counting: true });
    }
    // While it waits for the library, the line is main's own, and doesn't count.
    const waiting = "Waiting for Avanzel to finish with your library…";
    expect(waitingLine(waiting, 3)).toEqual({ line: waiting, counting: false });
    expect(waitingLine(waiting, 42)).toEqual({ line: waiting, counting: false });
  });
});
