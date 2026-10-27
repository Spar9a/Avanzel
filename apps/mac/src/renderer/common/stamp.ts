// The day a stamp prints on a card of paper, for the windows that stamp one (setup's Hello and Filing steps, the capsule's results), and
// when a stamp that is drawn coming down lands. Plain values, with no React in this file: setup's copy and the capsule import them, and
// node tests them. The capsule's hook for the day is use-stamp-date.ts.

/**
 * When a filed card's stamp lands, in milliseconds after the card is drawn: 60% of `--av-duration-card` (380 ms), where `av-stamp-in`
 * has the stamp touch the paper (packages/ui's stamp.css). The capsule plays the Stamp then (`playStamp`): it is the thud of that moment.
 * A unit test holds it to the token and the keyframes (sounds.test.ts).
 */
export const STAMP_LANDS_MS = 228;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** The day as a stamp prints it (in its own capitals): "21 Oct 2026". */
export function stampDate(day: Date): string {
  return `${day.getDate()} ${MONTHS[day.getMonth()]?.slice(0, 3)} ${day.getFullYear()}`;
}
