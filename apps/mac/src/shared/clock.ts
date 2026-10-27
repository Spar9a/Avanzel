// How long something has run, as the capsule's bar and the menu bar's title both write it: one function, so that the card and the
// menu bar can't count differently. The main process and the capsule's page share it.

/**
 * `ms` as minutes and seconds, "0:07", "1:05" or "12:03": whole seconds, rounded down, never negative, and "0:00" for anything
 * that isn't a time. It goes on in minutes past the hour ("60:00").
 */
export function clock(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
