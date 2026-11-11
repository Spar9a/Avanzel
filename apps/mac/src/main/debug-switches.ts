/**
 * The command-line switches that would open a debugger into Avanzel: Chromium's DevTools port or pipe, which run code in any of
 * its pages, and Node's inspector. A release refuses to start with one (index.ts). Avanzel's pages hold the microphone, and macOS
 * grants it to Avanzel's signature, so any program on this Mac could otherwise listen through that port. The release's fuses turn
 * the inspector off already; no fuse covers the DevTools port. Review builds and tests keep both, since Playwright drives them.
 */
export const DEBUG_SWITCHES = [
  "remote-debugging-port",
  "remote-debugging-pipe",
  "remote-debugging-address",
  "inspect",
  "inspect-brk",
  "inspect-port",
] as const;

/** The first debugger switch Avanzel was started with, or null. */
export function debugSwitch(hasSwitch: (name: string) => boolean): string | null {
  return DEBUG_SWITCHES.find((name) => hasSwitch(name)) ?? null;
}
