// The Ask window's words that are made from values: who answered and in how long, a failed answer as its Notice
// shows it, and the line while the agent looks.
import type { AskResult } from "../../shared/ipc.ts";
import { askProblem, avanzelFailure, type AskProblem } from "../../shared/problems.ts";
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

/**
 * The waiting line, from what main last said the question is doing (`progress`, null before it has said anything) and
 * the seconds since: main's own words while it waits for the library, and while the agent looks LOOKING, then from
 * 10 s on its whole seconds, as setup's Ask step counts them ("Looking through your library: 12 s"). `counting` says
 * whether it counts, which changes the line at each tick.
 */
export function waitingLine(progress: string | null, seconds: number): { line: string; counting: boolean } {
  if (progress !== null && progress !== LOOKING) return { line: progress, counting: false };
  return seconds >= SLOW_SECONDS ? { line: askingLine(seconds), counting: true } : { line: LOOKING, counting: false };
}
