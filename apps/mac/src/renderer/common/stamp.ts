// The day a stamp prints on a card of paper, for the windows that stamp one (setup's Hello and Filing steps, the capsule's results).
import { useState } from "react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** The day as a stamp prints it (in its own capitals): "21 Oct 2026". */
export function stampDate(day: Date): string {
  return `${day.getDate()} ${MONTHS[day.getMonth()]?.slice(0, 3)} ${day.getFullYear()}`;
}

/** The day a card came, as its stamp prints it: taken once, when the card is first drawn, so that a redraw never changes it or plays the stamp again. */
export function useStampDate(): string {
  const [day] = useState(() => stampDate(new Date()));
  return day;
}
