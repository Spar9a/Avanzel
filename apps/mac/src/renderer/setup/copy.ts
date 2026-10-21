// The setup window's words that are made from values: sizes, dates and what an agent's check found, as its copy
// table writes them.
import type { AgentStatus } from "../../shared/ipc.ts";

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
