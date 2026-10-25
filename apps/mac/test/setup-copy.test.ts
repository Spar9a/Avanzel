import { describe, expect, it } from "vitest";
import {
  agentLine,
  agentProblemTitle,
  askingLine,
  cancelledLine,
  earsLine,
  ESTIMATE_SECONDS,
  failedAnswer,
  failedFiling,
  filedHeading,
  isAgentProblem,
  megabytes,
  othersLine,
  ownLine,
  pagesLine,
  placeLine,
  receiptPages,
  recordingProblem,
  reviewLabel,
  slowSeconds,
  sourceTitle,
  stampDate,
  tooBroadLine,
  TRANSCRIBING,
  workingLine,
} from "../src/renderer/setup/copy.ts";
import { NOTE_GONE, type AgentStatus, type FiledPage, type SetupAnswer, type SetupFiling } from "../src/shared/ipc.ts";
import { ownLine as sharedOwnLine, type AgentFailure } from "../src/shared/problems.ts";

/** A page an agent filed, from its library path without ".md": "ideas/a" is "a" on Ideas. */
const filed = (rel: string): FiledPage => {
  const [shelf = "", title = ""] = rel.split("/");
  return { title, shelf, path: `${rel}.md` };
};

describe("setup copy", () => {
  it("dates read as the stamp prints them", () => {
    const day = new Date(2026, 9, 21);
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

  it("re-exports ownLine, which the main process shares, for the windows that import it from here", () => {
    expect(ownLine).toBe(sharedOwnLine); // its cases are problems.test.ts's
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
    expect(cancelledLine("Claude Code", false, 0)).toBe("Your words are back in the inbox, untouched, and nothing else changed.");
    expect(cancelledLine("Claude Code", true, 0)).toBe(
      "Your words are back in the inbox, untouched. Claude Code's partial edits are kept as their own commit in the library's history.",
    );
  });

  it("a cancelled filing that changed files nothing recorded (no git, or automatic commits off) says they stay as they are", () => {
    const stay = "Your words are back in the inbox. The agent's partial edits stay as they are, because nothing recorded them.";
    expect(cancelledLine("Claude Code", false, 2)).toBe(stay);
    expect(cancelledLine("Codex", false, 1)).toBe(stay); // one file reads the same: it doesn't count them
    // Edits that were committed are told as before, and a run that changed nothing keeps its line.
    expect(cancelledLine("Claude Code", true, 2)).toBe(cancelledLine("Claude Code", true, 0));
    expect(cancelledLine("Claude Code", false, 0)).not.toBe(stay);
  });

  it("Found's line under the library's place says this Mac has no git yet, in a new library and in a folder with files", () => {
    const withGit = {
      new: "A new library: Markdown files with git history.",
      files: "This folder has files already. I'll add the shelves, an AGENTS.md for your agent, and git history that keeps them.",
      library: "This folder is already an Avanzel library.",
    };
    expect(placeLine("missing", true)).toBe(withGit.new);
    expect(placeLine("empty", true)).toBe(withGit.new);
    expect(placeLine("has-files", true)).toBe(withGit.files);
    expect(placeLine("library", true)).toBe(withGit.library);
    expect(placeLine("missing", false)).toBe("A new library: Markdown files. This Mac has no git yet, so changes can't be undone.");
    expect(placeLine("empty", false)).toBe("A new library: Markdown files. This Mac has no git yet, so changes can't be undone.");
    expect(placeLine("has-files", false)).toBe(
      "This folder has files already. I'll add the shelves and an AGENTS.md for your agent. This Mac has no git yet, so changes can't be undone.",
    );
    // A library made already has its history, or has none, as it was made: its line says nothing of git.
    expect(placeLine("library", false)).toBe(withGit.library);
  });

  it("the too-broad line names the place as the row does", () => {
    expect(tooBroadLine("~/Documents")).toBe("~/Documents is too broad for a library. Choose or make a folder inside it.");
    expect(tooBroadLine("/Applications")).toBe("/Applications is too broad for a library. Choose or make a folder inside it.");
  });

  it("the first-thought step says why it can't hear yet, without promising to keep a recording", () => {
    const arriving = "My ears are still arriving. Type it instead, or talk to me once they land.";
    expect(earsLine({ kind: "missing", bytes: 672_807_563 })).toBe(arriving);
    expect(earsLine({ kind: "downloading", receivedBytes: 1, totalBytes: 2 })).toBe(arriving);
    expect(earsLine({ kind: "error", cause: "download", message: "fetch failed", resumable: true })).toBe(
      "The speech model didn't finish downloading, so I can't hear you yet. Type it instead, or try the download again.",
    );
    // Ready: it hears. [voice] settings it can't use: the copy has no line for them.
    expect(earsLine({ kind: "ready", dir: "/models" })).toBeNull();
    expect(earsLine({ kind: "error", cause: "settings", message: "bad", resumable: false })).toBeNull();
  });

  it("the transcribing line stays as it is, and its whole seconds show beside it once the words have taken 10 s", () => {
    expect(TRANSCRIBING).toBe("Turning your voice into text on this Mac…");
    expect(slowSeconds(0)).toBeNull();
    expect(slowSeconds(9.9)).toBeNull();
    expect(slowSeconds(10)).toBe("10 s");
    expect(slowSeconds(12.7)).toBe("12 s");
  });

  it("a recording problem says what happened, then only what is true of what is kept, and Try again or typing", () => {
    expect(recordingProblem("lost", false)).toEqual({ title: "Your recording didn't reach me.", body: "Nothing was saved. Try again, or type it instead." });
    expect(recordingProblem("microphone", false)).toEqual({ title: "The microphone didn't start.", body: "Nothing was recorded. Try again, or type it instead." });
    expect(recordingProblem("silence", false)).toEqual({
      title: "I didn't hear any words.",
      body: "Nothing was saved. Try again a little closer to the microphone, or type it instead.",
    });
    expect(recordingProblem("unheard", false)).toEqual({ title: "I couldn't turn your voice into words.", body: "Nothing was saved. Try again, or type it instead." });
    expect(recordingProblem("unheard", true).body).toBe("Your recording is kept in the library, under raw/audio. Try again, or type it instead.");
    expect(recordingProblem("unsaved", true)).toEqual({
      title: "I couldn't save your words.",
      body: "Your recording is kept in the library, under raw/audio. Try again, or type it instead.",
    });
    // None sends the person to Settings.
    const all = (["lost", "microphone", "silence", "unheard", "unsaved"] as const).flatMap((problem) => [true, false].map((kept) => recordingProblem(problem, kept)));
    expect(all.filter(({ title, body }) => /Settings/.test(`${title} ${body}`))).toEqual([]);
  });

  it("reviewLabel says when the review runs", () => {
    expect(reviewLabel("daily 21:00")).toBe("Review my inbox every day at 21:00");
    expect(reviewLabel("weekly sun 18:00")).toBe("Review my inbox every Sunday at 18:00");
    // Every weekday by its whole name, not only the first one of the week.
    expect(reviewLabel("weekly thu 07:30")).toBe("Review my inbox every Thursday at 07:30");
  });
});

// A failed filing in the setup window is told as the capsule tells it (filingProblem), except that setup starts no wait and no
// watch: it says to try again where the capsule says the note will be filed (after: "retry").
describe("a failed filing in setup", () => {
  type Failed = Extract<SetupFiling, { kind: "failed" }>;
  /** Sunday 25 October 2026, 10:00 in this zone, and `hour`:00 `days` later, in epoch ms, as a failure's reset is. */
  const now = new Date(2026, 9, 25, 10, 0);
  const at = (days: number, hour: number) => new Date(2026, 9, 25 + days, hour).getTime();
  const claude: AgentFailure = { kind: "other", agent: "Claude Code", command: "claude", resetsAt: null, seconds: 900, line: "Error: boom" };
  /** The setup window's failed filing for a failure, as main hands it over. */
  const failed = (failure: AgentFailure | null, over: Partial<Failed> = {}): Failed => ({
    kind: "failed",
    words: "Plant tulips in October",
    agent: failure?.agent ?? "Claude Code",
    line: failure ? failure.line : NOTE_GONE,
    failure,
    partial: null,
    ...over,
  });
  const SAFE = "Your note is safe in the inbox";

  it("a usage limit with a known reset says when, and to try again then", () => {
    expect(failedFiling(failed({ ...claude, kind: "limit", resetsAt: at(0, 15) }), now, true)).toEqual({
      title: "Claude Code has hit its usage limit.",
      body: `It resets at 15:00. ${SAFE}; try again then.`,
    });
    expect(failedFiling(failed({ ...claude, kind: "limit", resetsAt: at(1, 9) }), now, false).body).toBe(`It resets tomorrow at 09:00. ${SAFE}; try again then.`);
  });

  it("a usage limit with no reset promises the evening review while it is on, and nothing while it is off", () => {
    const limit = failed({ ...claude, kind: "limit" });
    expect(failedFiling(limit, now, true)).toEqual({ title: "Claude Code has hit its usage limit.", body: `${SAFE}; the evening review will try again.` });
    expect(failedFiling(limit, now, false).body).toBe(`${SAFE}.`);
  });

  it("a sign-in says what to run, then to try again, and what is safe; the command is what the window sets as code", () => {
    expect(failedFiling(failed({ ...claude, kind: "signin", line: "Error: not logged in" }), now, true)).toEqual({
      title: "Claude Code isn't signed in on this Mac.",
      body: `Run claude once in Terminal and sign in, then try again. ${SAFE}.`,
      command: "claude",
    });
    expect(failedFiling(failed({ ...claude, kind: "signin", agent: "Codex", command: "codex" }), now, true)).toEqual({
      title: "Codex isn't signed in on this Mac.",
      body: `Run codex login in Terminal, then try again. ${SAFE}.`,
      command: "codex login",
    });
    const other = failedFiling(failed({ ...claude, kind: "signin", agent: "OpenCode", command: null }), now, true);
    expect(other).toEqual({ title: "OpenCode isn't signed in on this Mac.", body: `Sign in to OpenCode in Terminal, then try again. ${SAFE}.` });
    expect(other.command).toBeUndefined();
  });

  it("a sign-in's words don't depend on the evening review: setup asks for a try, not for a wait", () => {
    const signedOut = failed({ ...claude, kind: "signin" });
    expect(failedFiling(signedOut, now, false)).toEqual(failedFiling(signedOut, now, true));
  });

  it("any other failure keeps the agent's line, as a sentence, then what is safe", () => {
    expect(failedFiling(failed(claude), now, true)).toEqual({
      title: "Claude Code couldn't file this note.",
      body: `Boom. ${SAFE}; the evening review will try again.`,
    });
    expect(failedFiling(failed({ ...claude, line: "" }), now, false).body).toBe(`${SAFE}.`);
  });

  it("a timeout, and an agent that isn't there, are told as the capsule tells them", () => {
    expect(failedFiling(failed({ ...claude, kind: "timeout" }), now, true)).toEqual({
      title: "Claude Code took longer than 15 min and was stopped.",
      body: `${SAFE}; the evening review will try again.`,
    });
    expect(failedFiling(failed({ ...claude, kind: "gone" }), now, true).title).toBe("Claude Code isn't installed on this Mac any more.");
    expect(failedFiling(failed({ ...claude, kind: "missing", agent: "Avanzel", command: null }), now, true).title).toBe("Avanzel needs an AI agent to do the filing.");
  });

  it("partial edits are told after what is safe: kept as a commit, or left outside the history", () => {
    expect(failedFiling(failed(claude, { partial: "commit" }), now, true).body).toBe(
      `Boom. ${SAFE}; the evening review will try again. Claude Code's partial edits are kept as their own commit in the library's history.`,
    );
    expect(failedFiling(failed({ ...claude, kind: "limit", resetsAt: at(0, 15) }, { partial: "uncommitted" }), now, true).body).toBe(
      `It resets at 15:00. ${SAFE}; try again then. Its partial edits stay in the library, outside its history, so they can't be undone.`,
    );
  });

  it("a note gone from the inbox before any run keeps its own title and line: no agent failed, and the words aren't there to be safe", () => {
    expect(failedFiling(failed(null, { agent: "Claude Code" }), now, true)).toEqual({ title: "Claude Code couldn't file it.", body: NOTE_GONE });
    expect(failedFiling(failed(null), now, false)).toEqual({ title: "Claude Code couldn't file it.", body: "The note isn't in the inbox any more." });
  });
});

// A failed answer on the Ask step is told as the Ask window tells it (askProblem).
describe("a failed answer in setup", () => {
  type Failed = Extract<SetupAnswer, { kind: "failed" }>;
  const now = new Date(2026, 9, 25, 10, 0);
  const claude: AgentFailure = { kind: "other", agent: "Claude Code", command: "claude", resetsAt: null, seconds: 900, line: "Error: boom" };
  const failed = (failure: AgentFailure | null, over: Partial<Failed> = {}): Failed => ({
    kind: "failed",
    question: "Where are the bulbs?",
    agent: "Claude Code",
    line: failure?.line ?? "",
    failure,
    changedFiles: 0,
    ...over,
  });

  it("says what happened, that the library hasn't changed, and the agent's line", () => {
    expect(failedAnswer(failed(claude), now)).toEqual({
      title: "Claude Code couldn't answer.",
      body: "Your library hasn't changed. Boom.",
      terminal: false,
      settings: false,
    });
  });

  it("a usage limit names its reset, and a sign-in what to run", () => {
    expect(failedAnswer(failed({ ...claude, kind: "limit", resetsAt: new Date(2026, 9, 26, 9).getTime() }), now)).toMatchObject({
      title: "Claude Code has hit its usage limit.",
      body: "Your library hasn't changed. It resets tomorrow at 09:00.",
    });
    expect(failedAnswer(failed({ ...claude, kind: "signin" }), now)).toMatchObject({
      title: "Claude Code isn't signed in on this Mac.",
      body: "Your library hasn't changed. Run claude once in Terminal and sign in, then ask again.",
      command: "claude",
      terminal: true,
    });
  });

  it("says what a run changed, as the Ask window does", () => {
    expect(failedAnswer(failed(claude, { changedFiles: 1 }), now).body).toBe("Claude Code changed 1 file while answering; it's left as it is. Boom.");
    expect(failedAnswer(failed(claude, { changedFiles: 3 }), now).body).toBe("Claude Code changed 3 files while answering; they're left as they are. Boom.");
  });

  it("an answer that failed before any agent was asked is Avanzel's own, in the line of what went wrong", () => {
    expect(failedAnswer(failed(null, { line: "Set up your library first: Avanzel Settings → General." }), now)).toEqual({
      title: "Avanzel couldn't answer.",
      body: "Your library hasn't changed. Set up your library first: Avanzel Settings → General.",
      terminal: false,
      settings: false,
    });
  });
});
