// The Ask window's words that are made from values: who answered and in how long, a failed answer as its Notice
// shows it, and the line while the agent looks.
import { askingLine, ownLine, SLOW_SECONDS } from "../setup/copy.ts";

/** The line that ends an answer: "Claude Code answered in 13 s", in whole seconds and never "0 s". */
export function answeredLine(agent: string, seconds: number): string {
  return `${agent} answered in ${Math.max(1, Math.round(seconds))} s`;
}

/** What Ask says can't have changed when a question fails: the agent answers read-only (`save: false`). */
const SAFE = "Your library hasn't changed.";

/**
 * A failed answer (AskResult.answer) as its Notice shows it: its first line is the title, what happened ("fake couldn't
 * answer."), and the body says what is safe, then what the agent said last: the other lines, joined by spaces, as setup
 * shows an agent's line (ownLine). A message with one line, when nothing ran, is the title alone. Lines are trimmed,
 * and empty ones skipped.
 */
export function failureLines(answer: string): { title: string; body: string } {
  const [title = "", ...rest] = answer
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { title, body: `${SAFE} ${ownLine(rest.join(" "))}`.trim() };
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
