// The setup window's words that are made from values: sizes and dates, as its copy table writes them.

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
