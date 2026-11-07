// The setup window's words that are made from values: sizes, dates, what an agent's check found, what went wrong with a
// recording and how a filing went, as its copy table writes them, and which of those findings is a problem for the
// person to fix.
import type { ReceiptPage } from "@avanzel/ui";
import {
  NOTE_GONE,
  type AgentProblem,
  type AgentStatus,
  type FiledPage,
  type LibraryFolder,
  type ModelStatus,
  type RecordingProblem,
  type SetupAnswer,
  type SetupFiling,
} from "../../shared/ipc.ts";
import {
  askProblem,
  avanzelFailure,
  cancelledLine,
  filingProblem,
  NO_GIT_LINE,
  ownLine,
  tooBroadLine,
  type AskProblem,
  type Problem,
} from "../../shared/problems.ts";
import { isShelf } from "../common/shelf.ts";
import { stampDate } from "../common/stamp.ts";

// An agent's own line as a sentence, the line under a place too broad for a library, and what a Stopped filing says of the words and
// the library are shared with the main process (its cards, notifications and refusals say them too); the stamp's day and which folders
// are shelves are shared with the capsule (renderer/common). The windows that import them from here keep doing so.
export { cancelledLine, isShelf, ownLine, stampDate, tooBroadLine };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Whole megabytes, as macOS counts them (a million bytes each): 672,807,563 bytes are 673 MB. */
export function megabytes(bytes: number): number {
  return Math.round(bytes / 1e6);
}

/**
 * Found's line under the library's place, for what is there (`folder`) and whether this Mac has a usable git. A new library
 * and a folder with files say what the library will be made of: with git, its history; without, that changes can't be undone
 * (Install git is the way out). A library made already says nothing of git: it has its history, or has none, as it was made.
 */
export function placeLine(folder: LibraryFolder, gitUsable: boolean): string {
  switch (folder) {
    case "missing":
    case "empty":
      return gitUsable ? "A new library: Markdown files with git history." : `A new library: Markdown files. ${NO_GIT_LINE}`;
    case "has-files":
      return gitUsable
        ? "This folder has files already. I'll add the shelves, an AGENTS.md for your agent, and git history that keeps them."
        : `This folder has files already. I'll add the shelves and an AGENTS.md for your agent. ${NO_GIT_LINE}`;
    case "library":
      return "This folder is already an Avanzel library.";
  }
}

/** An agent's row on Found, under its name: "Installed" until a check says more, then what it found. */
export function agentLine(status: AgentStatus | null): string {
  if (!status) return "Installed";
  switch (status.kind) {
    case "checking":
      return "Checking…";
    case "signed-in":
      return "Signed in";
    case "replied":
      return `Replied in ${status.seconds.toFixed(1)} s`;
    case "signed-out":
      return "Not signed in";
    case "timeout": // 15 s is the engine's default for a check, which the controller keeps
      return "Didn't reply within 15 s.";
    case "failed":
      // An agent that fails without printing anything has no line to show.
      return ownLine(status.detail) || "Didn't reply.";
  }
}

// What keeps an agent from filing until the person acts: Found's Notice for the chosen agent.
export { isAgentProblem, type AgentProblem } from "../../shared/ipc.ts";

/** The title of that Notice, for the agent `label` ("Claude Code"). */
export function agentProblemTitle(label: string, problem: AgentProblem): string {
  switch (problem.kind) {
    case "signed-out":
      return `${label} isn't signed in on this Mac.`;
    case "timeout": // the engine's 15 s for a check, as agentLine says
      return `${label} didn't reply within 15 s.`;
    case "failed":
      return `${label} didn't work.`;
  }
}

/**
 * Why the first-thought step can't hear yet, while the speech model is on its way or its download failed: typing is the
 * way meanwhile. It promises nothing about keeping a recording, since nothing records. Null once it hears, and for
 * [voice] settings that can't be used, which have no line of their own.
 */
export function earsLine(model: ModelStatus): string | null {
  if (model.kind === "missing" || model.kind === "downloading") return "My ears are still arriving. Type it instead, or talk to me once they land.";
  if (model.kind === "error" && model.cause === "download") {
    return "The speech model didn't finish downloading, so I can't hear you yet. Type it instead, or try the download again.";
  }
  return null;
}

/** From how many seconds a wait gives its size: DESIGN.md's "past 10 seconds". */
export const SLOW_SECONDS = 10;

/**
 * What the first-thought step says while the spoken thought's words are made, and where only when that is on this Mac
 * (`onThisMac`): the command in a library's [voice] settings can run anywhere.
 */
export function transcribingLine(onThisMac: boolean): string {
  return onThisMac ? "Turning your voice into text on this Mac…" : "Turning your voice into text…";
}

/** The whole seconds the words have taken so far, from SLOW_SECONDS on, beside the transcribing line: "12 s". Null before. */
export function slowSeconds(seconds: number): string | null {
  return seconds >= SLOW_SECONDS ? `${Math.floor(seconds)} s` : null;
}

/**
 * A problem with the first spoken thought, in setup's own words: what happened, then what is safe and the way on, Try
 * again or type it instead. Each says only what is true of that problem: nothing is kept but a recording that is
 * (`kept`), which only words that couldn't be made or saved leave.
 */
export function recordingProblem(problem: RecordingProblem, kept: boolean): { title: string; body: string } {
  const safe = kept ? "Your recording is kept in the library, under raw/audio." : "Nothing was saved.";
  switch (problem) {
    case "lost":
      return { title: "Your recording didn't reach me.", body: "Nothing was saved. Try again, or type it instead." };
    case "microphone":
      return { title: "The microphone didn't start.", body: "Nothing was recorded. Try again, or type it instead." };
    case "silence":
      return { title: "I didn't hear any words.", body: "Nothing was saved. Try again a little closer to the microphone, or type it instead." };
    case "unheard":
      return { title: "I couldn't turn your voice into words.", body: `${safe} Try again, or type it instead.` };
    case "unsaved":
      return { title: "I couldn't save your words.", body: `${safe} Try again, or type it instead.` };
  }
}

/** About how long a first filing takes, in seconds: the working line counts towards it. */
export const ESTIMATE_SECONDS = 15;

/** The line under "Watch me file it.": the agent's whole seconds so far, "of about 15" until it gets there. */
export function workingLine(agent: string, seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return whole < ESTIMATE_SECONDS ? `${agent} is working: ${whole} s of about ${ESTIMATE_SECONDS}` : `${agent} is working: ${whole} s`;
}

/** The line while the Ask step's question is answered: the agent's whole seconds so far. */
export function askingLine(seconds: number): string {
  return `Looking through your library: ${Math.max(0, Math.floor(seconds))} s`;
}

/**
 * The evening review's switch on the last step, from its schedule as Settings writes it: "daily 21:00" runs "every day
 * at 21:00", and "weekly sun 18:00" names its day in full, "every Sunday at 18:00".
 */
export function reviewLabel(schedule: string): string {
  const [every = "", ...rest] = schedule.trim().split(/\s+/);
  const time = rest.at(-1) ?? "";
  if (every !== "weekly") return `Review my inbox every day at ${time}`;
  const short = rest[0] ?? "";
  const day = WEEKDAYS.find((name) => name.slice(0, 3).toLowerCase() === short) ?? short;
  return `Review my inbox every ${day} at ${time}`;
}

/** The most characters of a page's title its link under "Pages I used:" shows: the step is about 340 px wide. */
const SOURCE_CHARS = 40;

/**
 * A page's title as its link under "Pages I used:" shows it: one longer than 40 characters is its first 39 and "…", so
 * the link fits the step, as the engine shortens a question for its log. Characters are code points, so none is cut in
 * half.
 */
export function sourceTitle(title: string): string {
  const chars = Array.from(title);
  return chars.length > SOURCE_CHARS ? `${chars.slice(0, SOURCE_CHARS - 1).join("")}…` : title;
}

/** The heading once the thought is filed, in whole seconds, and never "0 s". */
export function filedHeading(agent: string, seconds: number): string {
  return `All filed. ${agent} took ${Math.max(1, Math.round(seconds))} s.`;
}

/**
 * A failed filing's Notice in the setup window: what happened, what is safe, and for a sign-in the command to run, as the
 * capsule tells the same failure (`filingProblem`) except that setup starts neither a wait nor a watch, so it says to try
 * again (`after: "retry"`). The evening review is promised only while the library's is on (`eveningReview`). A note gone
 * from the inbox before any run has no failure to tell: it has its own title and line, since its words aren't there to be safe.
 */
export function failedFiling(filing: Extract<SetupFiling, { kind: "failed" }>, now: Date, eveningReview: boolean): Problem {
  if (filing.failure === null) return { title: `${filing.agent} couldn't file it.`, body: NOTE_GONE };
  return filingProblem(filing.failure, now, { after: "retry", eveningReview, partial: filing.partial });
}

/**
 * A failed answer's Notice on the Ask step: what happened, that the library hasn't changed (or what the run changed), and what
 * to do, as the Ask window tells it (`askProblem`). A question that never reached an agent has no failure: it is Avanzel's
 * own, in the line of what went wrong.
 */
export function failedAnswer(answer: Extract<SetupAnswer, { kind: "failed" }>, now: Date): AskProblem {
  return askProblem(answer.failure ?? avanzelFailure(answer.line), answer.changedFiles, now);
}

/** `count` pages of a `kind`, in words: "1 new note", "2 updated notes". */
const counted = (count: number, kind: string) => `${count} ${kind} ${count === 1 ? "note" : "notes"}`;

/**
 * What a filing wrote on the six shelves, under its heading: how many pages are new and how many updated, and where.
 * Null when it wrote none there, so the line never claims a page that isn't on them.
 */
export function pagesLine(created: number, updated: number, where: string): string | null {
  let what: string;
  if (created && updated) what = `${counted(created, "new")} and ${updated} updated`;
  else if (created) what = counted(created, "new");
  else if (updated) what = counted(updated, "updated");
  else return null;
  return `${what}, all plain Markdown in ${where}.`;
}

/** The pages a filing wrote off the six shelves, which its receipt doesn't list; null when there are none. */
export function othersLine(count: number): string | null {
  return count ? `${counted(count, "more")} in other folders.` : null;
}

/** A filing's pages as its receipt lists them: those on the six shelves, in order, and how many others it wrote. */
export function receiptPages(pages: readonly FiledPage[]): { pages: ReceiptPage[]; others: number } {
  const rows = pages.flatMap(({ title, shelf }) => (isShelf(shelf) ? [{ title, shelf }] : []));
  return { pages: rows, others: pages.length - rows.length };
}
