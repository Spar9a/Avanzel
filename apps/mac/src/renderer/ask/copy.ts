// The Ask window's words that are made from values: who answered and in how long, and a failed answer as its Notice
// shows it.

/** The line that ends an answer: "Claude Code answered in 13 s", in whole seconds and never "0 s". */
export function answeredLine(agent: string, seconds: number): string {
  return `${agent} answered in ${Math.max(1, Math.round(seconds))} s`;
}

/**
 * A failed answer (AskResult.answer) as its Notice shows it: its first line is the title, what happened ("fake couldn't
 * answer."), and the other lines, joined by spaces, are the body, what the agent said last. A message with one line,
 * when nothing ran, is the title alone. Lines are trimmed, and empty ones skipped.
 */
export function failureLines(answer: string): { title: string; body: string } {
  const [title = "", ...rest] = answer
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { title, body: rest.join(" ") };
}
