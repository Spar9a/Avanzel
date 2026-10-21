// The setup window's words that are made from values: sizes, dates, what an agent's check found and how a filing went,
// as its copy table writes them, and which of those findings is a problem for the person to fix.
import { SHELVES, type ReceiptPage, type Shelf } from "@avanzel/ui";
import { NOTE_GONE, type AgentStatus, type FiledPage, type ModelStatus } from "../../shared/ipc.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** Whole megabytes, as macOS counts them (a million bytes each): 672,807,563 bytes are 673 MB. */
export function megabytes(bytes: number): number {
  return Math.round(bytes / 1e6);
}

/** The day as a card's corner says it: "Wednesday 21 October". */
export function cardDate(day: Date): string {
  return `${WEEKDAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`;
}

/** The day as a stamp prints it (in its own capitals): "21 Oct 2026". */
export function stampDate(day: Date): string {
  return `${day.getDate()} ${MONTHS[day.getMonth()]?.slice(0, 3)} ${day.getFullYear()}`;
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

/** What a check found that keeps an agent from filing until the person acts: Found's Notice for the chosen agent. */
export type AgentProblem = Extract<AgentStatus, { kind: "signed-out" | "timeout" | "failed" }>;

/** Whether `status` is such a problem, rather than an agent that works, one being checked, or one not checked yet. */
export const isAgentProblem = (status: AgentStatus | null | undefined): status is AgentProblem =>
  status?.kind === "signed-out" || status?.kind === "timeout" || status?.kind === "failed";

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
 * A line an agent printed, as a sentence: without the "Error:" label many CLIs put first, with a capital, and with a
 * full stop unless it ends a sentence already. Nothing stays nothing.
 */
export function ownLine(detail: string): string {
  const line = detail.trim().replace(/^error\s*:\s*/i, "");
  if (!line) return "";
  const sentence = line.charAt(0).toUpperCase() + line.slice(1);
  return /[.?…]$/.test(sentence) ? sentence : `${sentence}.`;
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

/** The line while the first spoken thought's words are made: from SLOW_SECONDS on, with its whole seconds so far. */
export function transcribingLine(seconds: number): string {
  const line = "Turning your voice into text on this Mac…";
  return seconds >= SLOW_SECONDS ? `${line} ${Math.floor(seconds)} s` : line;
}

/** About how long a first filing takes, in seconds: the working line counts towards it. */
export const ESTIMATE_SECONDS = 15;

/** The line under "Watch me file it.": the agent's whole seconds so far, "of about 15" until it gets there. */
export function workingLine(agent: string, seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return whole < ESTIMATE_SECONDS ? `${agent} is working: ${whole} s of about ${ESTIMATE_SECONDS}` : `${agent} is working: ${whole} s`;
}

/** The heading once the thought is filed, in whole seconds, and never "0 s". */
export function filedHeading(agent: string, seconds: number): string {
  return `All filed. ${agent} took ${Math.max(1, Math.round(seconds))} s.`;
}

/** What a cancelled filing says of the words and the library: `partial` when the stopped run's edits stay. */
export function cancelledLine(agent: string, partial: boolean): string {
  return partial
    ? `Your words are back in the inbox, untouched. ${agent}'s partial edits are kept as their own commit in the library's history.`
    : "Your words are back in the inbox, untouched, and nothing else changed.";
}

/**
 * The body of a failed filing's Notice when signing in isn't the fix: the agent's own line, then that the words are
 * safe. A note gone from the inbox says only that, since the words aren't there to be safe.
 */
export function failedLine(line: string): string {
  if (line === NOTE_GONE) return line;
  return `${ownLine(line)} Your words are safe in the inbox.`.trim();
}

const isShelf = (shelf: string): shelf is Shelf => (SHELVES as readonly string[]).includes(shelf);

/** A filing's pages as its receipt lists them: those on the six shelves, in order, and how many others it wrote. */
export function receiptPages(pages: readonly FiledPage[]): { pages: ReceiptPage[]; others: number } {
  const rows = pages.flatMap(({ title, shelf }) => (isShelf(shelf) ? [{ title, shelf }] : []));
  return { pages: rows, others: pages.length - rows.length };
}
