import { describe, expect, it } from "vitest";
import { answeredLine, emptyLine, failedAnswer, LOOKING, savedLine, SAVING_LINES, stoppedSaveLine, undoneLine, waitingLine } from "../src/renderer/ask/copy.ts";
import type { AskResult } from "../src/shared/ipc.ts";
import type { AgentFailure } from "../src/shared/problems.ts";

/** Sunday 25 October 2026, 10:00 in this zone. */
const now = new Date(2026, 9, 25, 10, 0);
const claude: AgentFailure = { kind: "other", agent: "Claude Code", command: "claude", resetsAt: null, seconds: 900, line: "Error: boom" };
/** An answer that failed, as main hands it to the Ask window: a failed run of Claude Code unless `over` says otherwise. */
const failed = (over: Partial<AskResult> = {}): AskResult => ({
  ok: false,
  answer: "Claude Code couldn't answer.\nError: boom",
  agent: "Claude Code",
  seconds: 3,
  paragraphs: [],
  sources: [],
  changedFiles: 0,
  failure: claude,
  library: null,
  ...over,
});

describe("ask copy", () => {
  it("answeredLine counts whole seconds and never says 0 s", () => {
    expect(answeredLine("fake", 0.2)).toBe("fake answered in 1 s");
    expect(answeredLine("Claude Code", 12.6)).toBe("Claude Code answered in 13 s");
  });

  it("a failed run is told as the Ask rows tell it: what happened, that the library hasn't changed, and the agent's line", () => {
    expect(failedAnswer(failed(), now)).toEqual({
      title: "Claude Code couldn't answer.",
      body: "Your library hasn't changed. Boom.",
      terminal: false,
      settings: false,
    });
  });

  it("a usage limit says when it resets, and the answer can be asked again", () => {
    expect(failedAnswer(failed({ failure: { ...claude, kind: "limit", resetsAt: new Date(2026, 9, 26, 9).getTime() } }), now)).toEqual({
      title: "Claude Code has hit its usage limit.",
      body: "Your library hasn't changed. It resets tomorrow at 09:00.",
      terminal: false,
      settings: false,
    });
  });

  it("a sign-in names what to run, as code, and offers Terminal", () => {
    expect(failedAnswer(failed({ failure: { ...claude, kind: "signin" } }), now)).toEqual({
      title: "Claude Code isn't signed in on this Mac.",
      body: "Your library hasn't changed. Run claude once in Terminal and sign in, then ask again.",
      command: "claude",
      terminal: true,
      settings: false,
    });
  });

  it("an agent that isn't there offers Settings, and says nothing of the library when none is installed", () => {
    expect(failedAnswer(failed({ failure: { ...claude, kind: "gone" } }), now)).toMatchObject({
      title: "Claude Code isn't installed on this Mac any more.",
      body: "Your library hasn't changed. Settings → Agents can choose another agent, or has its install command.",
      settings: true,
    });
    expect(failedAnswer(failed({ failure: { ...claude, kind: "missing", agent: "Avanzel", command: null } }), now)).toMatchObject({
      title: "Avanzel needs an AI agent to answer.",
      body: "Claude Code works best, and Settings → Agents has its install command.",
      settings: true,
    });
  });

  it("says what the run changed, by the number of files, and leaves the title be", () => {
    expect(failedAnswer(failed({ changedFiles: 1 }), now)).toMatchObject({
      title: "Claude Code couldn't answer.",
      body: "Claude Code changed 1 file while answering; it's left as it is. Boom.",
    });
    expect(failedAnswer(failed({ changedFiles: 3 }), now).body).toBe("Claude Code changed 3 files while answering; they're left as they are. Boom.");
  });

  it("a question that never reached an agent is Avanzel's own failure, in the message's words", () => {
    // Nothing ran: no library, settings it can't read, a question the engine refuses. The message alone is the answer, and no agent failed.
    expect(failedAnswer(failed({ answer: "Set up your library first: Avanzel Settings → General.", failure: null }), now)).toEqual({
      title: "Avanzel couldn't answer.",
      body: "Your library hasn't changed. Set up your library first: Avanzel Settings → General.",
      terminal: false,
      settings: false,
    });
    // A message of several lines is told in one, as setup shows an agent's line.
    expect(failedAnswer(failed({ answer: "\nThe settings can't be read:\n config.toml: invalid TOML at line 2 \n\n", failure: null }), now).body).toBe(
      "Your library hasn't changed. The settings can't be read: config.toml: invalid TOML at line 2.",
    );
  });

  it("emptyLine says where answers come from, or for a library with no pages what to do first", () => {
    expect(emptyLine(0)).toBe("Your shelves are empty. Say something first, then ask about it.");
    expect(emptyLine(1)).toBe("Answers come from your library only, with links to the pages they use.");
    expect(emptyLine(42)).toBe("Answers come from your library only, with links to the pages they use.");
    // Before main has counted the pages, the usual line stands: it is true of every library.
    expect(emptyLine(null)).toBe("Answers come from your library only, with links to the pages they use.");
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

  it("waitingLine, with the save's lines, says the save, main's own words while it waits, and counts from 10 s", () => {
    const saving = "Saving the answer as a page…";
    // Before main has said anything, and once it says the agent looks: a save's agent looks too, and the line says the save.
    expect(waitingLine(null, 3, SAVING_LINES)).toEqual({ line: saving, counting: false });
    expect(waitingLine(LOOKING, 3, SAVING_LINES)).toEqual({ line: saving, counting: false });
    expect(waitingLine(null, 9.9, SAVING_LINES)).toEqual({ line: saving, counting: false });
    expect(waitingLine(null, 10, SAVING_LINES)).toEqual({ line: "Saving the answer as a page: 10 s", counting: true });
    expect(waitingLine(null, 12.7, SAVING_LINES)).toEqual({ line: "Saving the answer as a page: 12 s", counting: true });
    // While it waits for the library, the line is main's own, as a question's is.
    const waiting = "Waiting for Avanzel to finish with your library…";
    expect(waitingLine(waiting, 30, SAVING_LINES)).toEqual({ line: waiting, counting: false });
  });

  it("savedLine names the page and its shelf, or its folder", () => {
    expect(savedLine({ title: "Answer", shelf: "topics", path: "topics/answer.md" })).toBe("Saved as “Answer” in Topics.");
    expect(savedLine({ title: "Trip", shelf: "projects", path: "projects/trip.md" })).toBe("Saved as “Trip” in projects.");
  });

  it("stoppedSaveLine says what the stopped save left", () => {
    expect(stoppedSaveLine("Claude Code", null)).toBe("Stopped. Your library hasn't changed.");
    expect(stoppedSaveLine("Claude Code", "commit")).toBe("Stopped. Claude Code's partial edits are kept as their own commit in the library's history.");
    expect(stoppedSaveLine("Claude Code", "uncommitted")).toBe("Stopped. Claude Code's partial edits stay as they are, because nothing recorded them.");
  });

  it("undoneLine says the page is no longer in the library when the save made it", () => {
    expect(undoneLine({ title: "Answer", shelf: "topics", path: "topics/answer.md", created: true })).toBe("Undone. “Answer” is no longer in your library.");
    expect(undoneLine({ title: "Trip", shelf: "projects", path: "projects/trip.md", created: true })).toBe("Undone. “Trip” is no longer in your library.");
    // A page that says nothing of how it came (`FiledPage.created` is only set by a filing's own pages) is read as made.
    expect(undoneLine({ title: "Answer", shelf: "topics", path: "topics/answer.md" })).toBe("Undone. “Answer” is no longer in your library.");
  });

  it("undoneLine says the page is back as it was when the save only changed it", () => {
    // Undo puts a changed page back as it was; the page is still in the library, so it is not said to be gone.
    expect(undoneLine({ title: "Answer", shelf: "topics", path: "topics/answer.md", created: false })).toBe("Undone. “Answer” is back as it was.");
    expect(undoneLine({ title: "Trip", shelf: "projects", path: "projects/trip.md", created: false })).toBe("Undone. “Trip” is back as it was.");
  });

  it("the save's words are written as the design rules ask", () => {
    const lines = [
      SAVING_LINES.first,
      SAVING_LINES.counting(12),
      savedLine({ title: "Answer", shelf: "topics", path: "topics/answer.md" }),
      savedLine({ title: "Trip", shelf: "projects", path: "projects/trip.md" }),
      undoneLine({ title: "Answer", shelf: "topics", path: "topics/answer.md", created: true }),
      undoneLine({ title: "Answer", shelf: "topics", path: "topics/answer.md", created: false }),
      stoppedSaveLine("Claude Code", null),
      stoppedSaveLine("Claude Code", "commit"),
      stoppedSaveLine("Claude Code", "uncommitted"),
    ];
    for (const line of lines) {
      expect(line, line).toMatch(/^\p{Lu}/u);
      expect(line, line).not.toContain("!");
      expect(line, line).not.toContain("...");
      expect(line, line).not.toMatch(/\p{Emoji_Presentation}/u);
      expect(line, line).not.toMatch(/(^|[^\p{L}'’])I(?=$|[^\p{L}'’])/u);
    }
  });
});
