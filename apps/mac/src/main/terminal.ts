// Open Terminal, where a person signs an agent in: from setup (its Open Terminal) and from the capsule's card of a failed
// filing, which both leave through here.
import { shell } from "electron";

const TERMINAL = "/System/Applications/Utilities/Terminal.app";

/**
 * Opens Terminal. With AVANZEL_TEST=1 Terminal stays shut, and `opened` (what the controller's openedForTests reads) notes
 * "Terminal" instead.
 */
export function openTerminal(opened: string[]): void {
  if (process.env.AVANZEL_TEST === "1") opened.push("Terminal");
  else void shell.openPath(TERMINAL);
}
