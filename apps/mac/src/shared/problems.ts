// What a person is told when something goes wrong, in one place: the capsule's card and the notifications (the main
// process) and setup's and Ask's windows (their renderers) all use these functions, so one problem reads the same wherever
// it shows. A problem is three parts: the title says what happened, the body says what is safe and anything else the
// person needs to know, and the window offers one fix.

/**
 * Why a filing didn't happen, as far as a person needs to tell: the agent hit its usage limit (`limit`), wants a sign-in
 * (`signin`), ran out of time (`timeout`), is not installed any more (`gone`: the library's own agent), or none is
 * (`missing`); or it failed some other way (`other`).
 */
export type FailureKind = "limit" | "signin" | "timeout" | "gone" | "missing" | "other";

/** What went wrong with an agent's run, ready to be told. */
export interface AgentFailure {
  kind: FailureKind;
  /** The agent's display name: "Claude Code". "Avanzel" when no agent can be named: the library's settings can't be read, say. */
  agent: string;
  /** What signs the agent in when typed in Terminal: "claude" or "codex"; null for any other agent. */
  command: string | null;
  /** When a usage limit resets, in epoch ms, if the agent said. */
  resetsAt: number | null;
  /** The run's time limit in seconds: what a timeout says it had. */
  seconds: number;
  /** The agent's own line about why the run failed, as the engine's errorLine gives it. */
  line: string;
}

/** A problem as a window tells it: the title, the body, and the part of the body the person types, if any. */
export interface Problem {
  title: string;
  body: string;
  /** The part of `body` the person types in Terminal. Windows set it in code font; the capsule and notifications take strings, and show it plain. */
  command?: string;
}

/**
 * A line an agent printed, as a sentence: without the "Error:" label many CLIs put first, with a capital, and with a
 * full stop unless it ends a sentence already. Nothing stays nothing.
 */
export function ownLine(detail: string): string {
  const line = detail.trim().replace(/^error\s*:\s*/i, "");
  if (!line) return "";
  const sentence = line.charAt(0).toUpperCase() + line.slice(1);
  return /[.?…]$/.test(sentence) ? sentence : `${sentence}.`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const DAY_MS = 86_400_000;
const two = (n: number) => String(n).padStart(2, "0");

/**
 * When a limit resets, as the cards say it, on the 24-hour clock of this Mac: "at 15:00" on the same day, "tomorrow at
 * 09:00", "on Monday at 09:00" two to six days ahead, and from a week ahead the date, "on 3 November at 09:00".
 */
export function resetPhrase(resetsAt: number, now: Date): string {
  const reset = new Date(resetsAt);
  const time = `${two(reset.getHours())}:${two(reset.getMinutes())}`;
  // Whole calendar days apart, counted on the dates themselves, so a day of 23 or 25 hours doesn't move the count.
  const days = Math.round(
    (Date.UTC(reset.getFullYear(), reset.getMonth(), reset.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS,
  );
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return `on ${WEEKDAYS[reset.getDay()]} at ${time}`;
  return `on ${reset.getDate()} ${MONTHS[reset.getMonth()]} at ${time}`;
}

/** A time limit as the cards say it: seconds under a minute ("45 s"), else whole minutes ("15 min"); never "0 s". */
export function duration(seconds: number): string {
  const whole = Math.round(seconds);
  return whole < 60 ? `${Math.max(1, whole)} s` : `${Math.round(whole / 60)} min`;
}

export interface FilingProblemOptions {
  /**
   * Where the engine kept the owner's words aside, as a library path, when it couldn't put them back in the inbox: the
   * body then says where they are, and that the inbox holds the agent's version.
   */
  where?: string;
  /** What the run left behind: its edits are kept as their own commit, or stay in the library with no history to undo them from. */
  partial?: "commit" | "uncommitted" | null;
  /**
   * What the body promises of a note that waits. "wait" (the default): the capsule and the notifications, which promise the
   * wait or the watch. "retry": setup, which starts neither, says to try again.
   */
  after?: "wait" | "retry";
  /** Whether the library's evening review is on. Off, a body that would end with its promise ends at "Your note is safe in the inbox." */
  eveningReview?: boolean;
}

/** What a failed filing says, in the words of the copy table: the title, the body and, for a sign-in, the command to run. */
export function filingProblem(f: AgentFailure, now: Date, o: FilingProblemOptions = {}): Problem {
  const { where, partial = null, after = "wait", eveningReview = true } = o;
  const safe = where ? `Your words are kept in ${where}, and the inbox holds the agent's version` : "Your note is safe in the inbox";
  // The sentence that says what is safe, ending with the evening review's promise while the library's review is on.
  const reassure = eveningReview ? `${safe}; the evening review will try again.` : `${safe}.`;
  const left =
    partial === "commit"
      ? ` ${f.agent}'s partial edits are kept as their own commit in the library's history.`
      : partial === "uncommitted"
        ? " Its partial edits stay in the library, outside its history, so they can't be undone."
        : "";
  const done = (title: string, body: string, command?: string): Problem => ({ title, body: `${body}${left}`, ...(command ? { command } : {}) });

  switch (f.kind) {
    case "limit": {
      // A reset that has passed is no moment to wait for: it reads as one the agent didn't give.
      const resets = f.resetsAt !== null && f.resetsAt > now.getTime() ? resetPhrase(f.resetsAt, now) : null;
      const title = `${f.agent} has hit its usage limit.`;
      if (resets === null) return done(title, reassure);
      return done(title, `It resets ${resets}. ${safe}${after === "retry" ? "; try again then." : " and will be filed then."}`);
    }
    case "signin": {
      const title = `${f.agent} isn't signed in on this Mac.`;
      const command = f.command === "claude" ? "claude" : f.command === "codex" ? "codex login" : null;
      if (command === null) {
        return done(title, after === "retry" ? `Sign in to ${f.agent} in Terminal, then try again. ${safe}.` : `Sign in to ${f.agent} in Terminal. ${reassure}`);
      }
      const run = command === "claude" ? "Run claude once in Terminal and sign in" : "Run codex login in Terminal";
      return done(title, after === "retry" ? `${run}, then try again. ${safe}.` : `${run}, and your note will be filed straight away.`, command);
    }
    case "timeout":
      return done(`${f.agent} took longer than ${duration(f.seconds)} and was stopped.`, reassure);
    case "gone":
      return done(`${f.agent} isn't installed on this Mac any more.`, `${safe}. Settings → Agents can choose another agent, or has its install command.`);
    case "missing":
      return done("Avanzel needs an AI agent to do the filing.", `${safe}. Claude Code works best, and Settings → Agents has its install command.`);
    case "other":
      return done(`${f.agent} couldn't file this note.`, [ownLine(f.line), reassure].filter(Boolean).join(" "));
  }
}

/**
 * The corrected words (File after Edit) couldn't be written to the inbox yet. Not an agent's failure: nothing ran. `lines` is
 * the error's last lines; the words are kept in memory and saved to the inbox when Avanzel quits, and `originalKept` says the
 * note they correct is still there.
 */
export function correctedWordsProblem(lines: string, originalKept: boolean): Problem {
  const original = originalKept ? "; the original note is still there" : "";
  return {
    title: "Your corrected words weren't saved yet.",
    body: `${lines}\nYour corrected words are saved to your inbox when you quit${original}.`,
  };
}
