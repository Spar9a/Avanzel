// The day a stamp prints on a card of paper, for the windows that stamp one (setup's Hello and Filing steps, the capsule's results).
// Plain values, with no React in this file: setup's copy and the capsule import them, and node tests them. The capsule's hook for the
// day is use-stamp-date.ts.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** The day as a stamp prints it (in its own capitals): "21 Oct 2026". */
export function stampDate(day: Date): string {
  return `${day.getDate()} ${MONTHS[day.getMonth()]?.slice(0, 3)} ${day.getFullYear()}`;
}
