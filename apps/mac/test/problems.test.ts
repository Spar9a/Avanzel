import { describe, expect, it } from "vitest";
import {
  askProblem,
  avanzelFailure,
  correctedWordsProblem,
  downloadFailedProblem,
  duration,
  filingProblem,
  ownLine,
  resetPhrase,
  takeBackRefused,
  takeBackRefusedProblem,
  undoRefused,
  type AgentFailure,
  type FailureKind,
  type Problem,
} from "../src/shared/problems.ts";

/** Sunday 25 October 2026, 10:00 in this zone: the "now" of every case. */
const now = new Date(2026, 9, 25, 10, 0);
/** `days` after today at `hour`:`minute` in this zone, in epoch ms, as a failure's `resetsAt` is. */
const on = (days: number, hour: number, minute = 0) => new Date(2026, 9, 25 + days, hour, minute).getTime();

const claude = { agent: "Claude Code", command: "claude" };
const codex = { agent: "Codex", command: "codex" };
const opencode = { agent: "OpenCode", command: null };

const failure = (over: Partial<AgentFailure> = {}): AgentFailure => ({
  kind: "other",
  ...claude,
  resetsAt: null,
  seconds: 900,
  line: "Error: boom",
  ...over,
});

const SAFE = "Your note is safe in the inbox";
const LATER = "the evening review will try again.";
const KEPT = ".avanzel/logs/2026-10-25-100000-a-note.original.md";
const ASIDE = `Your words are kept in ${KEPT}, and the inbox holds the agent's version`;

describe("filingProblem: a usage limit", () => {
  it("with a known reset says when it resets, and that the note is filed then", () => {
    expect(filingProblem(failure({ kind: "limit", resetsAt: on(0, 15) }), now)).toEqual({
      title: "Claude Code has hit its usage limit.",
      body: `It resets at 15:00. ${SAFE} and will be filed then.`,
    });
    expect(filingProblem(failure({ kind: "limit", ...codex, resetsAt: on(1, 9) }), now)).toEqual({
      title: "Codex has hit its usage limit.",
      body: `It resets tomorrow at 09:00. ${SAFE} and will be filed then.`,
    });
  });

  it("with no reset promises only the evening review, or nothing while the review is off", () => {
    const limit = failure({ kind: "limit" });
    expect(filingProblem(limit, now)).toEqual({ title: "Claude Code has hit its usage limit.", body: `${SAFE}; ${LATER}` });
    expect(filingProblem(limit, now, { eveningReview: false }).body).toBe(`${SAFE}.`);
  });

  it("with a reset that has already passed reads as one with none: nothing waits for a moment that is gone", () => {
    const passed = failure({ kind: "limit", resetsAt: on(0, 8) });
    expect(filingProblem(passed, now)).toEqual(filingProblem(failure({ kind: "limit" }), now));
    expect(filingProblem(failure({ kind: "limit", resetsAt: now.getTime() }), now).body).toBe(`${SAFE}; ${LATER}`);
  });

  it("keeps the evening review out of a known reset: the app's own wait files the note", () => {
    const limit = failure({ kind: "limit", resetsAt: on(1, 9) });
    expect(filingProblem(limit, now, { eveningReview: false }).body).toBe(`It resets tomorrow at 09:00. ${SAFE} and will be filed then.`);
  });

  it("in setup (retry) says to try again after the reset, since setup waits for nothing", () => {
    expect(filingProblem(failure({ kind: "limit", resetsAt: on(0, 15) }), now, { after: "retry" })).toEqual({
      title: "Claude Code has hit its usage limit.",
      body: `It resets at 15:00. ${SAFE}; try again then.`,
    });
    // With no reset, setup says what the capsule says.
    expect(filingProblem(failure({ kind: "limit" }), now, { after: "retry" }).body).toBe(`${SAFE}; ${LATER}`);
  });
});

describe("filingProblem: not signed in", () => {
  it("for Claude Code names the command to run once, and says the note is filed straight away", () => {
    expect(filingProblem(failure({ kind: "signin" }), now)).toEqual({
      title: "Claude Code isn't signed in on this Mac.",
      body: "Run claude once in Terminal and sign in, and your note will be filed straight away.",
      command: "claude",
    });
  });

  it("for Codex names its login command", () => {
    expect(filingProblem(failure({ kind: "signin", ...codex }), now)).toEqual({
      title: "Codex isn't signed in on this Mac.",
      body: "Run codex login in Terminal, and your note will be filed straight away.",
      command: "codex login",
    });
  });

  it("for any other agent says to sign in, and promises only the evening review (or nothing while it is off)", () => {
    const signedOut = failure({ kind: "signin", ...opencode });
    const problem = filingProblem(signedOut, now);
    expect(problem).toEqual({
      title: "OpenCode isn't signed in on this Mac.",
      body: `Sign in to OpenCode in Terminal. ${SAFE}; ${LATER}`,
    });
    expect(problem.command).toBeUndefined();
    expect(filingProblem(signedOut, now, { eveningReview: false }).body).toBe(`Sign in to OpenCode in Terminal. ${SAFE}.`);
  });

  it("in setup (retry) says to try again, and that the note is safe", () => {
    const retry = { after: "retry" } as const;
    expect(filingProblem(failure({ kind: "signin" }), now, retry)).toEqual({
      title: "Claude Code isn't signed in on this Mac.",
      body: `Run claude once in Terminal and sign in, then try again. ${SAFE}.`,
      command: "claude",
    });
    expect(filingProblem(failure({ kind: "signin", ...codex }), now, retry)).toEqual({
      title: "Codex isn't signed in on this Mac.",
      body: `Run codex login in Terminal, then try again. ${SAFE}.`,
      command: "codex login",
    });
    expect(filingProblem(failure({ kind: "signin", ...opencode }), now, retry)).toEqual({
      title: "OpenCode isn't signed in on this Mac.",
      body: `Sign in to OpenCode in Terminal, then try again. ${SAFE}.`,
    });
  });

  it("sets a command only on the rows where the person types it", () => {
    const kinds: FailureKind[] = ["limit", "timeout", "gone", "missing", "other"];
    for (const kind of kinds) expect(filingProblem(failure({ kind, resetsAt: on(1, 9) }), now).command).toBeUndefined();
  });
});

describe("filingProblem: a note the app set up nothing for (review)", () => {
  // The capsule's words when no wait for the reset and no watch of the sign-in was armed: another library is open, the run
  // state couldn't be written, or the note was filed again and met the same thing. Only the evening review is promised.
  const review = { after: "review" } as const;

  it("a limit with a known reset still names it, then promises only the evening review, or nothing while it is off", () => {
    expect(filingProblem(failure({ kind: "limit", resetsAt: on(0, 15) }), now, review)).toEqual({
      title: "Claude Code has hit its usage limit.",
      body: `It resets at 15:00. ${SAFE}; ${LATER}`,
    });
    expect(filingProblem(failure({ kind: "limit", resetsAt: on(1, 9) }), now, { ...review, eveningReview: false }).body).toBe(
      `It resets tomorrow at 09:00. ${SAFE}.`,
    );
    // No reset to name, or one that has passed: the reset-unknown row, as when the app does wait.
    for (const resetsAt of [null, on(0, 8)]) {
      expect(filingProblem(failure({ kind: "limit", resetsAt }), now, review)).toEqual(filingProblem(failure({ kind: "limit" }), now));
    }
  });

  it("a sign-in says to sign in as for an agent signed in by hand: no command, and nothing filed straight away", () => {
    expect(filingProblem(failure({ kind: "signin" }), now, review)).toEqual({
      title: "Claude Code isn't signed in on this Mac.",
      body: `Sign in to Claude Code in Terminal. ${SAFE}; ${LATER}`,
    });
    expect(filingProblem(failure({ kind: "signin", ...codex }), now, { ...review, eveningReview: false })).toEqual({
      title: "Codex isn't signed in on this Mac.",
      body: `Sign in to Codex in Terminal. ${SAFE}.`,
    });
  });

  it("changes nothing for a failure whose words promise only the evening review anyway", () => {
    for (const kind of ["timeout", "gone", "missing", "other"] as const) {
      for (const eveningReview of [true, false]) {
        expect(filingProblem(failure({ kind }), now, { ...review, eveningReview })).toEqual(filingProblem(failure({ kind }), now, { eveningReview }));
      }
    }
  });

  it("keeps what the run left behind and where the owner's words are", () => {
    const limit = failure({ kind: "limit", resetsAt: on(0, 15) });
    expect(filingProblem(limit, now, { ...review, where: KEPT, partial: "uncommitted" }).body).toBe(
      `It resets at 15:00. ${ASIDE}; ${LATER} Its partial edits stay in the library, outside its history, so they can't be undone.`,
    );
  });
});

describe("filingProblem: a timeout", () => {
  it("says how long the run had, and promises the evening review only while it is on", () => {
    expect(filingProblem(failure({ kind: "timeout" }), now)).toEqual({
      title: "Claude Code took longer than 15 min and was stopped.",
      body: `${SAFE}; ${LATER}`,
    });
    expect(filingProblem(failure({ kind: "timeout", ...codex, seconds: 45 }), now, { eveningReview: false })).toEqual({
      title: "Codex took longer than 45 s and was stopped.",
      body: `${SAFE}.`,
    });
  });
});

describe("filingProblem: no agent to run", () => {
  it("a library whose own agent is gone names it, and points to Settings → Agents", () => {
    expect(filingProblem(failure({ kind: "gone" }), now)).toEqual({
      title: "Claude Code isn't installed on this Mac any more.",
      body: `${SAFE}. Settings → Agents can choose another agent, or has its install command.`,
    });
  });

  it("no agent at all says Avanzel needs one, and that Claude Code works best", () => {
    expect(filingProblem(failure({ kind: "missing", agent: "your agent" }), now)).toEqual({
      title: "Avanzel needs an AI agent to do the filing.",
      body: `${SAFE}. Claude Code works best, and Settings → Agents has its install command.`,
    });
  });

  it("promises no evening review, so the review being off changes neither", () => {
    for (const kind of ["gone", "missing"] as const) {
      expect(filingProblem(failure({ kind }), now, { eveningReview: false })).toEqual(filingProblem(failure({ kind }), now));
    }
  });
});

describe("filingProblem: any other failure", () => {
  it("keeps the agent's own line, as a sentence, then what is safe", () => {
    expect(filingProblem(failure({ line: "Error: usage count exceeded" }), now)).toEqual({
      title: "Claude Code couldn't file this note.",
      body: `Usage count exceeded. ${SAFE}; ${LATER}`,
    });
    expect(filingProblem(failure({ ...opencode, line: "agent crashed: cannot file this one" }), now, { eveningReview: false })).toEqual({
      title: "OpenCode couldn't file this note.",
      body: `Agent crashed: cannot file this one. ${SAFE}.`,
    });
  });

  it("with no agent to name says that Avanzel couldn't file it, and the line of what is wrong", () => {
    const line = "/Users/ana/Avanzel/.avanzel/config.toml: invalid TOML at line 2, column 17: incomplete key-value declaration";
    expect(filingProblem(failure({ agent: "Avanzel", command: null, line }), now)).toEqual({
      title: "Avanzel couldn't file this note.",
      body: `${line}. ${SAFE}; ${LATER}`,
    });
  });

  it("with no line to show says only what is safe", () => {
    expect(filingProblem(failure({ line: "" }), now).body).toBe(`${SAFE}; ${LATER}`);
    expect(filingProblem(failure({ line: "Error:" }), now).body).toBe(`${SAFE}; ${LATER}`);
  });
});

describe("filingProblem: a long line of the agent's, for the capsule's card", () => {
  // The engine's errorLine allows a line 300 characters long; the capsule's card shows about four lines of its body.
  const long = `Error: ${"the agent went on about what it could not do and why it could not do it, ".repeat(4)}and then it stopped`;
  const safe = `${SAFE}; ${LATER}`;
  /** The agent's line in a body that ends with `safe`: what comes before it. */
  const lineOf = (body: string) => body.slice(0, body.length - safe.length).trimEnd();

  it("is kept whole in the windows, which don't clip", () => {
    expect(long.length).toBeGreaterThan(300);
    const body = filingProblem(failure({ line: long.slice(0, 300) }), now).body;
    expect(lineOf(body).length).toBeGreaterThan(290);
    expect(body.endsWith(safe)).toBe(true);
  });

  it("is shortened to about the length asked, at a word, and ends in an ellipsis, so what is safe is still said", () => {
    const { title, body } = filingProblem(failure({ line: long.slice(0, 300) }), now, { lineMax: 100 });
    expect(title).toBe("Claude Code couldn't file this note.");
    expect(body.endsWith(safe)).toBe(true);
    const line = lineOf(body);
    expect(Array.from(line).length).toBeLessThanOrEqual(100);
    expect(Array.from(line).length).toBeGreaterThan(60);
    expect(line.endsWith("…")).toBe(true);
    expect(line).not.toMatch(/\s…$/); // no space left before the ellipsis
    expect(line.startsWith("The agent went on about what it could not do")).toBe(true);
    // At a word: the cut text is the start of the whole line's words.
    const whole = filingProblem(failure({ line: long.slice(0, 300) }), now).body;
    const words = line.slice(0, -1);
    expect(whole.startsWith(words)).toBe(true);
    expect(whole.charAt(words.length)).toMatch(/[\s,]/);
  });

  it("leaves a line that fits alone, with its full stop", () => {
    expect(filingProblem(failure({ line: "Error: boom" }), now, { lineMax: 100 }).body).toBe(`Boom. ${safe}`);
    const exact = "x".repeat(99);
    expect(lineOf(filingProblem(failure({ line: exact }), now, { lineMax: 100 }).body)).toBe(`X${"x".repeat(98)}.`);
  });

  it("cuts a line that is one long word at the character, and never splits a character in two", () => {
    const word = "💥".repeat(150);
    const line = lineOf(filingProblem(failure({ line: word }), now, { lineMax: 100 }).body);
    expect(Array.from(line)).toHaveLength(100);
    expect(line.endsWith("…")).toBe(true);
    expect(Array.from(line).slice(0, 99).every((char) => char === "💥")).toBe(true);
  });

  it("keeps the rest of the body: the partial edits, the owner's words kept aside, and the review being off", () => {
    const line = long.slice(0, 300);
    expect(filingProblem(failure({ line }), now, { lineMax: 100, partial: "commit" }).body).toMatch(
      new RegExp(`… ${SAFE}; ${LATER} Claude Code's partial edits are kept as their own commit in the library's history\\.$`),
    );
    expect(filingProblem(failure({ line }), now, { lineMax: 100, where: KEPT }).body).toMatch(new RegExp(`… ${ASIDE}; ${LATER}$`));
    expect(filingProblem(failure({ line }), now, { lineMax: 100, eveningReview: false }).body).toMatch(new RegExp(`… ${SAFE}\\.$`));
  });

  it("tells Avanzel's own line whole: it says what to mend, and it is not an agent going on", () => {
    // The library's settings file can't be read: the path comes first, and what is wrong comes after it.
    const line = "/Users/ana/Avanzel/.avanzel/config.toml: invalid TOML at line 2, column 17: incomplete key-value declaration, expected a value";
    expect(line.length).toBeGreaterThan(100);
    const own = failure({ agent: "Avanzel", command: null, line });
    expect(filingProblem(own, now, { lineMax: 100 })).toEqual(filingProblem(own, now));
    expect(filingProblem(own, now, { lineMax: 100 }).body).toBe(`${line}. ${safe}`);
  });

  it("changes nothing for a failure that has no line of the agent's to tell", () => {
    for (const kind of ["limit", "signin", "timeout", "gone", "missing"] as const) {
      const f = failure({ kind, line: long.slice(0, 300), resetsAt: on(0, 15) });
      expect(filingProblem(f, now, { lineMax: 100 }), kind).toEqual(filingProblem(f, now));
    }
  });
});

describe("filingProblem: partial edits and the owner's words", () => {
  it("a commit holds the partial edits: the agent is named, and the history keeps them", () => {
    expect(filingProblem(failure(), now, { partial: "commit" }).body).toBe(
      `Boom. ${SAFE}; ${LATER} Claude Code's partial edits are kept as their own commit in the library's history.`,
    );
    expect(filingProblem(failure({ ...codex, kind: "timeout" }), now, { partial: "commit" }).body).toBe(
      `${SAFE}; ${LATER} Codex's partial edits are kept as their own commit in the library's history.`,
    );
  });

  it("with no commit the partial edits stay, and can't be undone", () => {
    expect(filingProblem(failure(), now, { partial: "uncommitted" }).body).toBe(
      `Boom. ${SAFE}; ${LATER} Its partial edits stay in the library, outside its history, so they can't be undone.`,
    );
    expect(filingProblem(failure(), now, { partial: null }).body).toBe(`Boom. ${SAFE}; ${LATER}`);
  });

  it("words kept aside replace the note being safe in the inbox", () => {
    expect(filingProblem(failure({ line: "The agent changed the note." }), now, { where: KEPT })).toEqual({
      title: "Claude Code couldn't file this note.",
      body: `The agent changed the note. ${ASIDE}; ${LATER}`,
    });
    expect(filingProblem(failure({ line: "The agent changed the note." }), now, { where: KEPT, eveningReview: false }).body).toBe(
      `The agent changed the note. ${ASIDE}.`,
    );
    expect(filingProblem(failure({ kind: "timeout" }), now, { where: KEPT, partial: "uncommitted" }).body).toBe(
      `${ASIDE}; ${LATER} Its partial edits stay in the library, outside its history, so they can't be undone.`,
    );
    expect(filingProblem(failure({ kind: "gone" }), now, { where: KEPT }).body).toBe(
      `${ASIDE}. Settings → Agents can choose another agent, or has its install command.`,
    );
    expect(filingProblem(failure({ kind: "limit", resetsAt: on(0, 15) }), now, { where: KEPT, after: "retry" }).body).toBe(
      `It resets at 15:00. ${ASIDE}; try again then.`,
    );
  });
});

describe("correctedWordsProblem", () => {
  it("says the corrected words weren't saved yet, with the error's lines and what keeps them", () => {
    expect(correctedWordsProblem("EACCES: permission denied, open 'inbox/a.md'", true)).toEqual({
      title: "Your corrected words weren't saved yet.",
      body: "EACCES: permission denied, open 'inbox/a.md'\nYour corrected words are saved to your inbox when you quit; the original note is still there.",
    });
  });

  it("leaves out the original note's clause once the note is gone", () => {
    expect(correctedWordsProblem("EACCES: permission denied", false).body).toBe(
      "EACCES: permission denied\nYour corrected words are saved to your inbox when you quit.",
    );
  });

  it("shortens a long error line when asked, for a card that clips, so what keeps the words is still said", () => {
    const lines =
      "EACCES: permission denied, rename '/Users/ana/Avanzel/inbox/2026-10-26-032519-misheard-words.md' -> '/Users/ana/Avanzel/inbox/.2026-10-26-032519-misheard-words.md.editing'";
    const kept = "Your corrected words are saved to your inbox when you quit; the original note is still there.";
    const [first, ...rest] = correctedWordsProblem(lines, true, 100).body.split("\n");
    expect(Array.from(first!).length).toBeLessThanOrEqual(100);
    expect(Array.from(first!).length).toBeGreaterThan(60);
    expect(first!.endsWith("…")).toBe(true);
    expect(first!.startsWith("EACCES: permission denied, rename '/Users/ana/Avanzel/inbox/")).toBe(true);
    expect(rest).toEqual([kept]);
    // The windows keep it whole, as does a card with a line that fits.
    expect(correctedWordsProblem(lines, true).body).toBe(`${lines}\n${kept}`);
    expect(correctedWordsProblem("EACCES: permission denied", true, 100).body).toBe(`EACCES: permission denied\n${kept}`);
  });
});

// A question asked of the library (the Ask window and setup's Ask step): nothing it asks may change the library, so a failed
// answer says first that the library hasn't, or what the run changed.
const UNCHANGED = "Your library hasn't changed.";

describe("askProblem: a usage limit", () => {
  it("with a known reset says that the library hasn't changed, and when it resets", () => {
    expect(askProblem(failure({ kind: "limit", resetsAt: on(0, 15) }), 0, now)).toEqual({
      title: "Claude Code has hit its usage limit.",
      body: `${UNCHANGED} It resets at 15:00.`,
      terminal: false,
      settings: false,
    });
    expect(askProblem(failure({ kind: "limit", ...codex, resetsAt: on(1, 9) }), 0, now)).toEqual({
      title: "Codex has hit its usage limit.",
      body: `${UNCHANGED} It resets tomorrow at 09:00.`,
      terminal: false,
      settings: false,
    });
    expect(askProblem(failure({ kind: "limit", resetsAt: on(3, 9) }), 0, now).body).toBe(`${UNCHANGED} It resets on Wednesday at 09:00.`);
  });

  it("with no reset, or one that has passed, says only that the library hasn't changed", () => {
    expect(askProblem(failure({ kind: "limit" }), 0, now)).toEqual({
      title: "Claude Code has hit its usage limit.",
      body: UNCHANGED,
      terminal: false,
      settings: false,
    });
    expect(askProblem(failure({ kind: "limit", resetsAt: on(0, 8) }), 0, now).body).toBe(UNCHANGED);
    expect(askProblem(failure({ kind: "limit", resetsAt: now.getTime() }), 0, now).body).toBe(UNCHANGED);
  });
});

describe("askProblem: not signed in", () => {
  it("for Claude Code names the command to run once, then to ask again, and offers Terminal", () => {
    expect(askProblem(failure({ kind: "signin" }), 0, now)).toEqual({
      title: "Claude Code isn't signed in on this Mac.",
      body: `${UNCHANGED} Run claude once in Terminal and sign in, then ask again.`,
      command: "claude",
      terminal: true,
      settings: false,
    });
  });

  it("for Codex names its login command", () => {
    expect(askProblem(failure({ kind: "signin", ...codex }), 0, now)).toEqual({
      title: "Codex isn't signed in on this Mac.",
      body: `${UNCHANGED} Run codex login in Terminal, then ask again.`,
      command: "codex login",
      terminal: true,
      settings: false,
    });
  });

  it("for any other agent says to sign in, with no command to show, and still offers Terminal", () => {
    const problem = askProblem(failure({ kind: "signin", ...opencode }), 0, now);
    expect(problem).toEqual({
      title: "OpenCode isn't signed in on this Mac.",
      body: `${UNCHANGED} Sign in to OpenCode in Terminal, then ask again.`,
      terminal: true,
      settings: false,
    });
    expect(problem.command).toBeUndefined();
  });
});

describe("askProblem: a timeout", () => {
  it("says how long the run had, and that the library hasn't changed", () => {
    expect(askProblem(failure({ kind: "timeout" }), 0, now)).toEqual({
      title: "Claude Code took longer than 15 min and was stopped.",
      body: UNCHANGED,
      terminal: false,
      settings: false,
    });
    expect(askProblem(failure({ kind: "timeout", ...codex, seconds: 45 }), 0, now).title).toBe("Codex took longer than 45 s and was stopped.");
  });
});

describe("askProblem: no agent to run", () => {
  it("a library whose own agent is gone names it, and points to Settings → Agents, which is its fix", () => {
    expect(askProblem(failure({ kind: "gone" }), 0, now)).toEqual({
      title: "Claude Code isn't installed on this Mac any more.",
      body: `${UNCHANGED} Settings → Agents can choose another agent, or has its install command.`,
      terminal: false,
      settings: true,
    });
  });

  it("no agent at all says Avanzel needs one to answer, and says nothing of the library: nothing ran", () => {
    expect(askProblem(failure({ kind: "missing", agent: "Avanzel" }), 0, now)).toEqual({
      title: "Avanzel needs an AI agent to answer.",
      body: "Claude Code works best, and Settings → Agents has its install command.",
      terminal: false,
      settings: true,
    });
  });
});

describe("askProblem: any other failure", () => {
  it("keeps the agent's own line, as a sentence, after what is safe", () => {
    expect(askProblem(failure({ line: "ERROR: the model is not supported with this account" }), 0, now)).toEqual({
      title: "Claude Code couldn't answer.",
      body: `${UNCHANGED} The model is not supported with this account.`,
      terminal: false,
      settings: false,
    });
  });

  it("with no line to show says only what is safe", () => {
    expect(askProblem(failure({ line: "" }), 0, now).body).toBe(UNCHANGED);
    expect(askProblem(failure({ line: "Error:" }), 0, now).body).toBe(UNCHANGED);
  });

  it("with no agent to name says that Avanzel couldn't answer, in the words of what is wrong", () => {
    const line = "/Users/ana/Avanzel/.avanzel/config.toml: invalid TOML at line 2, column 17: incomplete key-value declaration";
    expect(askProblem(avanzelFailure(line), 0, now)).toEqual({
      title: "Avanzel couldn't answer.",
      body: `${UNCHANGED} ${line}.`,
      terminal: false,
      settings: false,
    });
  });
});

describe("askProblem: a run that changed files", () => {
  it("one file is left as it is, and the agent is named", () => {
    expect(askProblem(failure({ line: "Error: boom" }), 1, now)).toEqual({
      title: "Claude Code couldn't answer.",
      body: "Claude Code changed 1 file while answering; it's left as it is. Boom.",
      terminal: false,
      settings: false,
    });
  });

  it("several files are left as they are", () => {
    expect(askProblem(failure({ line: "Error: boom" }), 3, now).body).toBe("Claude Code changed 3 files while answering; they're left as they are. Boom.");
    expect(askProblem(failure({ ...codex, line: "" }), 2, now).body).toBe("Codex changed 2 files while answering; they're left as they are.");
  });

  it("takes the place of “Your library hasn't changed.” in every row that says it", () => {
    const left = "Claude Code changed 1 file while answering; it's left as it is.";
    expect(askProblem(failure({ kind: "limit", resetsAt: on(0, 15) }), 1, now).body).toBe(`${left} It resets at 15:00.`);
    expect(askProblem(failure({ kind: "limit" }), 1, now).body).toBe(left);
    expect(askProblem(failure({ kind: "signin" }), 1, now).body).toBe(`${left} Run claude once in Terminal and sign in, then ask again.`);
    expect(askProblem(failure({ kind: "signin", ...opencode }), 1, now).body).toBe(
      "OpenCode changed 1 file while answering; it's left as it is. Sign in to OpenCode in Terminal, then ask again.",
    );
    expect(askProblem(failure({ kind: "timeout" }), 1, now).body).toBe(left);
    expect(askProblem(failure({ kind: "gone" }), 1, now).body).toBe(`${left} Settings → Agents can choose another agent, or has its install command.`);
  });

  it("changes neither the title nor what the Notice offers", () => {
    for (const kind of ["limit", "signin", "timeout", "gone", "missing", "other"] as const) {
      const [none, some] = [0, 4].map((changed) => askProblem(failure({ kind }), changed, now));
      expect(some?.title, kind).toBe(none?.title);
      expect(some?.terminal, kind).toBe(none?.terminal);
      expect(some?.settings, kind).toBe(none?.settings);
    }
  });
});

describe("askProblem: what the Notice offers", () => {
  it("Terminal only for a sign-in, and Settings only where the agent isn't there", () => {
    const offers = (kind: FailureKind) => {
      const { terminal, settings } = askProblem(failure({ kind }), 0, now);
      return { terminal, settings };
    };
    expect(offers("limit")).toEqual({ terminal: false, settings: false });
    expect(offers("timeout")).toEqual({ terminal: false, settings: false });
    expect(offers("other")).toEqual({ terminal: false, settings: false });
    expect(offers("signin")).toEqual({ terminal: true, settings: false });
    expect(offers("gone")).toEqual({ terminal: false, settings: true });
    expect(offers("missing")).toEqual({ terminal: false, settings: true });
  });

  it("sets a command only where the person types it", () => {
    for (const kind of ["limit", "timeout", "gone", "missing", "other"] as const) {
      expect(askProblem(failure({ kind, resetsAt: on(1, 9) }), 0, now).command, kind).toBeUndefined();
    }
  });
});

describe("avanzelFailure", () => {
  it("is another failure of Avanzel's own, with the message's line and nothing to wait for", () => {
    expect(avanzelFailure("Set up your library first: Avanzel Settings → General.")).toEqual({
      kind: "other",
      agent: "Avanzel",
      command: null,
      resetsAt: null,
      seconds: 0,
      line: "Set up your library first: Avanzel Settings → General.",
    });
  });
});

describe("a refused undo", () => {
  const WHY = "Usually a later change touched the same lines. The library's history keeps both versions.";

  it("says it can't be undone automatically, and why, and that the history keeps both versions", () => {
    expect(undoRefused).toEqual({ title: "This one can't be undone automatically.", body: WHY });
  });

  it("after Edit says the agent's first try can't be taken back, in the same body", () => {
    expect(takeBackRefused).toEqual({ title: "The agent's first try can't be taken back automatically.", body: WHY });
  });

  it("after Edit adds where the note waits while it is in the inbox, and the evening review only while that is on", () => {
    expect(takeBackRefusedProblem(true, true)).toEqual({ title: takeBackRefused.title, body: `${WHY} The note waits in your inbox for the evening review.` });
    // With the review off nothing is promised: the note is only safe.
    expect(takeBackRefusedProblem(true, false)).toEqual({ title: takeBackRefused.title, body: `${WHY} Your note is safe in the inbox.` });
    // A note that is no longer in the inbox (filed meanwhile) isn't said to wait there.
    expect(takeBackRefusedProblem(false, true)).toEqual(takeBackRefused);
    expect(takeBackRefusedProblem(false, false)).toEqual(takeBackRefused);
  });

  it("neither starts with “your agent”", () => {
    expect(undoRefused.title.toLowerCase().startsWith("your agent")).toBe(false);
    expect(takeBackRefused.title.toLowerCase().startsWith("your agent")).toBe(false);
  });
});

describe("the copy rules, for every problem a filing can have", () => {
  const places = [undefined, KEPT];
  const lines = ["Error: boom", "", "cannot reach the model: connection refused"];
  const reaches = [null, on(0, 15), on(1, 9), on(3, 9), on(10, 9)];
  const problems: Problem[] = [];
  for (const kind of ["limit", "signin", "timeout", "gone", "missing", "other"] as const) {
    for (const who of [claude, codex, opencode, { agent: "Avanzel", command: null }]) {
      for (const resetsAt of reaches) {
        for (const line of lines) {
          for (const after of ["wait", "retry", "review"] as const) {
            for (const eveningReview of [true, false]) {
              for (const partial of [null, "commit", "uncommitted"] as const) {
                for (const where of places) {
                  problems.push(filingProblem(failure({ kind, ...who, resetsAt, line }), now, { after, eveningReview, partial, ...(where ? { where } : {}) }));
                }
              }
            }
          }
        }
      }
      // A question asked of the library tells a failure by the same rules, whatever the run changed.
      for (const resetsAt of reaches) {
        for (const line of lines) {
          for (const changedFiles of [0, 1, 2, 12]) problems.push(askProblem(failure({ kind, ...who, resetsAt, line }), changedFiles, now));
        }
      }
    }
  }
  // The capsule's card shortens an agent's long line, and tells the rest by the same rules.
  const longLine = `Error: ${"the agent went on about what it could not do and why it could not do it, ".repeat(4)}and then it stopped`;
  for (const lineMax of [40, 100]) {
    for (const partial of [null, "commit", "uncommitted"] as const) {
      problems.push(filingProblem(failure({ line: longLine }), now, { lineMax, partial }), filingProblem(failure({ line: longLine }), now, { lineMax, where: KEPT, eveningReview: false }));
    }
  }
  // The corrected words' card is a problem of its own, and tells itself by the same rules, as do the refused undos.
  problems.push(correctedWordsProblem("EACCES: permission denied, open 'inbox/a.md'", true), correctedWordsProblem("EACCES: permission denied", false));
  problems.push(undoRefused, takeBackRefused, ...[true, false].flatMap((inInbox) => [true, false].map((review) => takeBackRefusedProblem(inInbox, review))));
  // A speech-model download that didn't finish is told by the same rules, with a reason of any shape, and kept part or none.
  for (const reason of ["Could not download silero_vad.onnx: the server answered HTTP 404 Not Found", "Error: could not download vocab.txt: terminated (other side closed)", ""]) {
    problems.push(downloadFailedProblem(reason, true), downloadFailedProblem(reason, false));
  }
  const everyText = (check: (text: string, problem: Problem) => void) => {
    for (const problem of problems) {
      check(problem.title, problem);
      check(problem.body, problem);
    }
  };

  it("a title is one sentence in sentence case, and no title starts with “your agent”", () => {
    for (const { title } of problems) {
      expect(title, title).toMatch(/^\p{Lu}[^.]*\.$/u);
      expect(title.toLowerCase().startsWith("your agent"), title).toBe(false);
    }
  });

  it("a body is whole sentences, each starting with a capital, ending in a full stop", () => {
    for (const { body } of problems) {
      expect(body, body).toMatch(/^\p{Lu}/u);
      expect(body, body).toMatch(/[.?…]$/);
      for (const sentence of body.split(/(?<=[.?…])\s+/)) expect(sentence, body).toMatch(/^\p{Lu}/u);
    }
  });

  it("says no “!”, no apology or filler, no emoji, no three dots, and no gendered pronoun", () => {
    everyText((text) => {
      expect(text).not.toContain("!");
      expect(text).not.toContain("...");
      expect(text).not.toMatch(/\b(oops|whoops|uh[- ]oh|sorry|something went wrong|an error (has )?occurred|successfully|awesome|yay)\b/i);
      expect(text).not.toMatch(/\p{Emoji_Presentation}/u);
      expect(text).not.toMatch(/\b(he|she|him|his|hers|himself|herself|her)\b/i);
    });
  });

  it("writes times on the 24-hour clock and units as “15 min” and “45 s”", () => {
    everyText((text) => {
      expect(text).not.toMatch(/\b(am|pm)\b/i);
      expect(text).not.toMatch(/\d\s?(minutes?|mins|seconds?|secs|hours?)\b/i);
    });
    for (const { body } of problems) for (const [time] of body.matchAll(/\b\d{1,2}:\d{2}\b/g)) expect(time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("shows a command plain in the body (windows set it in code font), and only where the person types it", () => {
    for (const problem of problems) {
      expect(problem.body).not.toContain("`");
      if (problem.command) {
        // "Run claude once…": a window sets what follows "Run " in code font. A question's body says first that the library is as it was.
        expect(problem.body).toContain(`Run ${problem.command}`);
        expect(problem.body).toMatch(/(^|\. )Run /);
      }
    }
    expect(problems.filter((problem) => problem.command).map((problem) => problem.command).sort()).toEqual(
      expect.arrayContaining(["claude", "codex login"]),
    );
  });
});

describe("downloadFailedProblem", () => {
  const REASON = "Could not download silero_vad.onnx: only 1.2 of 2.3 MB arrived";
  const TITLE = "The speech model didn't finish downloading.";

  it("says why, and that Try again continues where it stopped, when part of it was kept", () => {
    expect(downloadFailedProblem(REASON, true)).toEqual({
      title: TITLE,
      body: `${REASON}. Typing works meanwhile, and Try again continues where it stopped.`,
    });
  });

  it("says that Try again downloads it again when nothing was kept", () => {
    expect(downloadFailedProblem("Could not download vocab.txt: the server answered HTTP 404 Not Found", false)).toEqual({
      title: TITLE,
      body: "Could not download vocab.txt: the server answered HTTP 404 Not Found. Typing works meanwhile, and Try again downloads it again.",
    });
  });

  it("tells the reason as a sentence, as an agent's line is told", () => {
    expect(downloadFailedProblem("Error: terminated (other side closed)", true).body).toBe(
      "Terminated (other side closed). Typing works meanwhile, and Try again continues where it stopped.",
    );
  });

  it("promises to continue only when a part was kept", () => {
    for (const reason of [REASON, "Could not download vocab.txt: the server answered HTTP 404 Not Found", ""]) {
      expect(downloadFailedProblem(reason, true).body).toMatch(/Try again continues where it stopped\.$/);
      expect(downloadFailedProblem(reason, false).body).toMatch(/Try again downloads it again\.$/);
      expect(downloadFailedProblem(reason, false).body).not.toContain("continues");
    }
  });

  it("with no reason says only what is true meanwhile and what Try again does", () => {
    expect(downloadFailedProblem("", false).body).toBe("Typing works meanwhile, and Try again downloads it again.");
    expect(downloadFailedProblem("  ", true).body).toBe("Typing works meanwhile, and Try again continues where it stopped.");
  });
});

describe("resetPhrase", () => {
  it("is the time alone later today", () => {
    expect(resetPhrase(on(0, 15), now)).toBe("at 15:00");
    expect(resetPhrase(on(0, 23, 59), now)).toBe("at 23:59");
  });

  it("says tomorrow for the next calendar day, even when it is hours away", () => {
    expect(resetPhrase(on(1, 9), now)).toBe("tomorrow at 09:00");
    expect(resetPhrase(on(1, 0, 5), new Date(2026, 9, 25, 23, 50))).toBe("tomorrow at 00:05");
  });

  it("names the weekday two to six days ahead", () => {
    expect(resetPhrase(on(2, 9), now)).toBe("on Tuesday at 09:00");
    expect(resetPhrase(on(3, 9), now)).toBe("on Wednesday at 09:00");
    expect(resetPhrase(on(6, 9), now)).toBe("on Saturday at 09:00");
  });

  it("gives the date from a week ahead", () => {
    expect(resetPhrase(on(7, 9), now)).toBe("on 1 November at 09:00");
    expect(resetPhrase(on(10, 9), now)).toBe("on 4 November at 09:00");
    expect(resetPhrase(on(40, 7, 5), now)).toBe("on 4 December at 07:05");
  });
});

describe("duration", () => {
  it("is seconds under a minute and minutes from it", () => {
    expect(duration(45)).toBe("45 s");
    expect(duration(2)).toBe("2 s");
    expect(duration(900)).toBe("15 min");
    expect(duration(60)).toBe("1 min");
    expect(duration(90)).toBe("2 min");
    expect(duration(3600)).toBe("60 min");
  });

  it("is never “0 s”", () => {
    expect(duration(0)).toBe("1 s");
    expect(duration(0.4)).toBe("1 s");
  });
});

describe("ownLine", () => {
  it("is an agent's line as a sentence", () => {
    expect(ownLine("Error: usage limit reached")).toBe("Usage limit reached.");
    expect(ownLine("agent crashed: not logged in")).toBe("Agent crashed: not logged in.");
    expect(ownLine("Is it on?")).toBe("Is it on?");
    expect(ownLine("ERROR: the model is not supported with this account")).toBe("The model is not supported with this account.");
    expect(ownLine("Still starting…")).toBe("Still starting…");
    expect(ownLine("")).toBe("");
  });
});
