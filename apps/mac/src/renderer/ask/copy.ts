// The Ask window's words that are made from values: who answered and in how long, a failed answer as its Notice shows it, the line
// while the agent looks or saves, and what became of a save.
import { SHELF_NAMES } from "@avanzel/ui";
import type { AskResult, FiledPage } from "../../shared/ipc.ts";
import { askProblem, avanzelFailure, unsavedLine, type AskProblem, type PartialEdits } from "../../shared/problems.ts";
import { isShelf } from "../common/shelf.ts";
import { askingLine, SLOW_SECONDS } from "../setup/copy.ts";

/** The line that ends an answer: "Claude Code answered in 13 s", in whole seconds and never "0 s". */
export function answeredLine(agent: string, seconds: number): string {
  return `${agent} answered in ${Math.max(1, Math.round(seconds))} s`;
}

/**
 * A failed answer as its Notice shows it, in the words of the copy table's Ask rows (`askProblem`): what happened, that the
 * library hasn't changed (or how many files the run changed, which are left as they are) and what to do. An agent asked
 * read-only leaves no change, but one that doesn't keep to it may. A question that never reached an agent has no failure
 * (AskResult.failure): it is Avanzel's own, in the lines of the message that came back (AskResult.answer), joined by spaces
 * as setup shows an agent's line, with the empty ones skipped.
 */
export function failedAnswer(result: AskResult, now: Date): AskProblem {
  const message = result.answer
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return askProblem(result.failure ?? avanzelFailure(message), result.changedFiles, now);
}

/**
 * The line under the field before the first question: where answers come from; or, for a library whose six shelves hold no
 * pages (`pages` is 0), what to do first, since there is nothing to ask about yet. Until main has counted them (null) the
 * usual line stands, which is true of every library.
 */
export function emptyLine(pages: number | null): string {
  return pages === 0
    ? "Your shelves are empty. Say something first, then ask about it."
    : "Answers come from your library only, with links to the pages they use.";
}

/** What the waiting line says while the agent looks, before its seconds count: main's own words for it, too. */
export const LOOKING = "Looking through your library…";

/** What a wait says: `first` before its seconds count, and `counting` from 10 s on, with the whole seconds. */
export interface WaitLines {
  first: string;
  counting(seconds: number): string;
}

/** A question's wait, as setup's Ask step says it: "Looking through your library: 12 s". */
export const ASKING_LINES: WaitLines = { first: LOOKING, counting: askingLine };

/** The wait of a save of the answer as a page. */
export const SAVING_LINES: WaitLines = {
  first: "Saving the answer as a page…",
  counting: (seconds) => `Saving the answer as a page: ${Math.max(0, Math.floor(seconds))} s`,
};

/**
 * The waiting line, from what main last said the question or save is doing (`progress`, null before it has said anything) and
 * the seconds since: main's own words while it waits for the library, and while the agent looks `lines.first`, then from
 * 10 s on its whole seconds (`lines.counting`). `counting` says whether it counts, which changes the line at each tick.
 * A save's agent looks too, and main says so in the question's words: they are `lines.first` here, whichever wait it is.
 */
export function waitingLine(progress: string | null, seconds: number, lines: WaitLines = ASKING_LINES): { line: string; counting: boolean } {
  if (progress !== null && progress !== LOOKING) return { line: progress, counting: false };
  return seconds >= SLOW_SECONDS ? { line: lines.counting(seconds), counting: true } : { line: lines.first, counting: false };
}

/** What a save that wrote a page says: its title, and its shelf's name, or the folder it is in when that is none of the six shelves. */
export function savedLine(page: FiledPage): string {
  return `Saved as “${page.title}” in ${isShelf(page.shelf) ? SHELF_NAMES[page.shelf] : page.shelf}.`;
}

/** What a Stop says of a save: that it stopped, and what the save left in the library (`unsavedLine`). */
export function stoppedSaveLine(agent: string, partial: PartialEdits): string {
  return `Stopped. ${unsavedLine(agent, partial)}`;
}
