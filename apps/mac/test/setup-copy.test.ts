import { describe, expect, it } from "vitest";
import {
  agentLine,
  agentProblemTitle,
  askingLine,
  cancelledLine,
  cardDate,
  earsLine,
  ESTIMATE_SECONDS,
  failedLine,
  filedHeading,
  isAgentProblem,
  megabytes,
  othersLine,
  ownLine,
  pagesLine,
  receiptPages,
  sourceTitle,
  stampDate,
  transcribingLine,
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

  it("pagesLine says what the filing wrote", () => {
    const where = "~/Avanzel";
    expect(pagesLine(1, 0, where)).toBe("1 new page, all plain Markdown in ~/Avanzel.");
    expect(pagesLine(3, 1, where)).toBe("3 new pages and 1 updated, all plain Markdown in ~/Avanzel.");
    expect(pagesLine(0, 1, where)).toBe("1 updated page, all plain Markdown in ~/Avanzel.");
    expect(pagesLine(0, 2, where)).toBe("2 updated pages, all plain Markdown in ~/Avanzel.");
    // No page at all: the log line says what the agent did instead, so this line claims nothing.
    expect(pagesLine(0, 0, where)).toBeNull();
  });

  it("othersLine counts the pages a filing wrote off the six shelves", () => {
    expect(othersLine(1)).toBe("1 more page in other folders.");
    expect(othersLine(2)).toBe("2 more pages in other folders.");
    expect(othersLine(0)).toBeNull();
  });

  it("the asking line counts the agent's whole seconds, from 0", () => {
    expect(askingLine(4.7)).toBe("Looking through your library: 4 s");
    expect(askingLine(0)).toBe("Looking through your library: 0 s");
    // The window's clock can read a moment before the start main stamped: never "-1 s".
    expect(askingLine(-0.2)).toBe("Looking through your library: 0 s");
  });

  it("a source's title fits its link: past 40 characters, its first 39 and an ellipsis", () => {
    expect(sourceTitle("Plant tulips in October")).toBe("Plant tulips in October");
    const forty = "Launch plan for the spring campaign, v2.";
    expect(Array.from(forty)).toHaveLength(40);
    expect(sourceTitle(forty)).toBe(forty); // 40 fit as they are
    expect(sourceTitle("Launch plan for the spring campaign with Mark and the whole team")).toBe("Launch plan for the spring campaign wit…");
    // Characters, not UTF-16 units: a flower past the 38th letter is kept whole, never cut in half.
    expect(sourceTitle(`${"a".repeat(38)}🌷🌷🌷`)).toBe(`${"a".repeat(38)}🌷…`);
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

  it("the transcribing line gives its whole seconds once the words have taken 10 s", () => {
    expect(transcribingLine(0)).toBe("Turning your voice into text on this Mac…");
    expect(transcribingLine(9.9)).toBe("Turning your voice into text on this Mac…");
    expect(transcribingLine(10)).toBe("Turning your voice into text on this Mac… 10 s");
    expect(transcribingLine(12.7)).toBe("Turning your voice into text on this Mac… 12 s");
  });

  it("a failed filing says what the agent said and that the words are safe, except of a note gone from the inbox", () => {
    expect(failedLine("Error: usage limit reached")).toBe("Usage limit reached. Your words are safe in the inbox.");
    expect(failedLine("")).toBe("Your words are safe in the inbox.");
    // The words aren't in the inbox then, so nothing says they are.
    expect(failedLine(NOTE_GONE)).toBe("The note isn't in the inbox any more.");
  });
});
