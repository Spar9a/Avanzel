import { describe, expect, it } from "vitest";
import {
  agentLine,
  agentProblemTitle,
  cancelledLine,
  cardDate,
  earsLine,
  ESTIMATE_SECONDS,
  failedLine,
  filedHeading,
  isAgentProblem,
  megabytes,
  ownLine,
  receiptPages,
  stampDate,
  workingLine,
} from "../src/renderer/setup/copy.ts";
import { NOTE_GONE, type AgentStatus, type FiledPage } from "../src/shared/ipc.ts";

/** A page an agent filed, from its library path without ".md": "ideas/a" is "a" on Ideas. */
const filed = (rel: string): FiledPage => {
  const [shelf = "", title = ""] = rel.split("/");
  return { title, shelf, path: `${rel}.md` };
};

describe("setup copy", () => {
  it("dates read as the card and the stamp print them", () => {
    const day = new Date(2026, 9, 21);
    expect(cardDate(day)).toBe("Wednesday 21 October");
    expect(stampDate(day)).toBe("21 Oct 2026");
    expect(megabytes(672_807_563)).toBe(673);
  });

  it("each status reads as Found says it", () => {
    expect(agentLine(null)).toBe("Installed");
    expect(agentLine({ kind: "checking" })).toBe("Checking…");
    expect(agentLine({ kind: "signed-in", seconds: 0.4 })).toBe("Signed in");
    expect(agentLine({ kind: "replied", seconds: 1.63 })).toBe("Replied in 1.6 s");
    expect(agentLine({ kind: "signed-out", detail: "" })).toBe("Not signed in");
    expect(agentLine({ kind: "timeout" })).toBe("Didn't reply within 15 s.");
    expect(agentLine({ kind: "failed", detail: "Error: boom" })).toBe("Boom.");
    expect(agentLine({ kind: "failed", detail: "" })).toBe("Didn't reply.");
    expect(agentLine({ kind: "failed", detail: "Error:" })).toBe("Didn't reply."); // a label with nothing after it says nothing
  });

  it("a problem the chosen agent's Notice names: signed out, no reply in time, or a failure", () => {
    const statuses: (AgentStatus | null)[] = [
      { kind: "signed-out", detail: "" }, { kind: "timeout" }, { kind: "failed", detail: "boom" },
      { kind: "signed-in", seconds: 0.4 }, { kind: "replied", seconds: 1.6 }, { kind: "checking" }, null,
    ];
    expect(statuses.map(isAgentProblem)).toEqual([true, true, true, false, false, false, false]);
    expect(agentProblemTitle("Claude Code", { kind: "signed-out", detail: "" })).toBe("Claude Code isn't signed in on this Mac.");
    expect(agentProblemTitle("OpenCode", { kind: "timeout" })).toBe("OpenCode didn't reply within 15 s.");
    expect(agentProblemTitle("Codex", { kind: "failed", detail: "Error: boom" })).toBe("Codex didn't work.");
  });

  it("ownLine", () => {
    expect(ownLine("Error: usage limit reached")).toBe("Usage limit reached.");
    expect(ownLine("agent crashed: not logged in")).toBe("Agent crashed: not logged in.");
    expect(ownLine("Is it on?")).toBe("Is it on?");
    expect(ownLine("ERROR: the model is not supported with this account")).toBe("The model is not supported with this account.");
    expect(ownLine("Still starting…")).toBe("Still starting…");
    expect(ownLine("")).toBe("");
  });

  it("the working line counts up to the estimate, then only counts", () => {
    expect(ESTIMATE_SECONDS).toBe(15);
    expect(workingLine("Claude Code", 6.9)).toBe("Claude Code is working: 6 s of about 15");
    expect(workingLine("Claude Code", 15)).toBe("Claude Code is working: 15 s");
    expect(workingLine("Codex", 22.4)).toBe("Codex is working: 22 s");
  });

  it("receiptPages keeps the shelves and counts the rest", () => {
    expect(receiptPages([filed("ideas/a"), filed("projects/b"), filed("people/c")])).toEqual({
      pages: [
        { title: "a", shelf: "ideas" },
        { title: "c", shelf: "people" },
      ],
      others: 1,
    });
    expect(receiptPages([])).toEqual({ pages: [], others: 0 });
  });

  it("the filed heading says how long the agent took, in whole seconds", () => {
    expect(filedHeading("Claude Code", 11.6)).toBe("All filed. Claude Code took 12 s.");
    expect(filedHeading("Codex", 0.3)).toBe("All filed. Codex took 1 s."); // never "took 0 s"
  });

  it("a cancelled filing says what stayed, and names the agent whose partial edits did", () => {
    expect(cancelledLine("Claude Code", false)).toBe("Your words are back in the inbox, untouched, and nothing else changed.");
    expect(cancelledLine("Claude Code", true)).toBe(
      "Your words are back in the inbox, untouched. Claude Code's partial edits are kept as their own commit in the library's history.",
    );
  });

  it("the first-thought step says why it can't hear yet, without promising to keep a recording", () => {
    const arriving = "My ears are still arriving. Type it instead, or talk to me once they land.";
    expect(earsLine({ kind: "missing", bytes: 672_807_563 })).toBe(arriving);
    expect(earsLine({ kind: "downloading", receivedBytes: 1, totalBytes: 2 })).toBe(arriving);
    expect(earsLine({ kind: "error", cause: "download", message: "fetch failed" })).toBe(
      "The speech model didn't finish downloading, so I can't hear you yet. Type it instead, or try the download again.",
    );
    // Ready: it hears. [voice] settings it can't use: the copy has no line for them.
    expect(earsLine({ kind: "ready", dir: "/models" })).toBeNull();
    expect(earsLine({ kind: "error", cause: "settings", message: "bad" })).toBeNull();
  });

  it("a failed filing says what the agent said and that the words are safe, except of a note gone from the inbox", () => {
    expect(failedLine("Error: usage limit reached")).toBe("Usage limit reached. Your words are safe in the inbox.");
    expect(failedLine("")).toBe("Your words are safe in the inbox.");
    // The words aren't in the inbox then, so nothing says they are.
    expect(failedLine(NOTE_GONE)).toBe("The note isn't in the inbox any more.");
  });
});
