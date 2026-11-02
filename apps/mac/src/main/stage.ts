import { app, type BrowserWindow } from "electron";

/**
 * Where every window comes forward. In a real run a window takes the keyboard and panels float over every Space. A test
 * run sets AVANZEL_QUIET_STAGE=1: windows show without focus and stay on their own Space, so a run never pops anything
 * over what the owner is doing. The decision lives here, not at each place a window is shown.
 */
function quiet(): boolean {
  return process.env.AVANZEL_QUIET_STAGE === "1";
}

/** Brings Avanzel to the front before a dialog, so the question doesn't come up behind other apps. */
export function stealFocus(): void {
  if (!quiet()) app.focus({ steal: true });
}

/** Shows a window and gives it the keyboard; in the quiet stage it only shows. */
export function bringForward(win: BrowserWindow): void {
  if (quiet()) {
    win.showInactive();
    return;
  }
  app.focus({ steal: true });
  win.show();
  win.focus();
}

/** Window options for a panel: on top of other windows, except in the quiet stage. */
export function panelOptions(): { alwaysOnTop?: true } {
  return quiet() ? {} : { alwaysOnTop: true };
}

/** Raises a panel to the floating level above other windows, except in the quiet stage. */
export function floatAbove(win: BrowserWindow): void {
  if (!quiet()) win.setAlwaysOnTop(true, "floating");
}

/** Makes a panel follow the owner across Spaces and over full-screen apps, except in the quiet stage. */
export function floatOverSpaces(win: BrowserWindow): void {
  if (!quiet()) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}
