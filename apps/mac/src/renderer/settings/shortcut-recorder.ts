// Recording a shortcut in Settings, for every field that takes one (Shortcuts, and the Dictation pane's own shortcut): while one records,
// the next whole shortcut pressed anywhere in the window is handed over, and Avanzel's own shortcuts are let go meanwhile.
import { useLayoutEffect, useRef } from "react";
import { passesThrough, refusedShortcut, toAccelerator } from "./accelerator.ts";

const api = window.avanzel.settings;

export interface RecorderEvents {
  /** A whole shortcut it takes: one with ⌃ or ⌥, or a bare F-key (`toAccelerator`). The recording is over. */
  onShortcut(accelerator: string): void;
  /** Esc: the recording is over, and nothing changed. */
  onCancel(): void;
  /** A whole shortcut it won't take (no ⌃ or ⌥), as the keys to try instead. It keeps listening. */
  onRefused(instead: string): void;
  /** The window lost the focus: the recording is over, and nothing changed. */
  onStop(): void;
}

/**
 * Listens while `recording`. A layout effect, so the listening stops in the same commit that ends the recording or takes the field away: a
 * key pressed on the next pane, even at once, is never taken for this one. Tab passes, so the focus may leave the row (which the row ends);
 * a ⌘ key it never takes goes on to the app, so ⌘Q still quits while it listens. While it records, Avanzel's own shortcuts are let go:
 * macOS would hand a key Avanzel holds to it, and the page would never see it.
 */
export function useShortcutRecorder(recording: boolean, events: RecorderEvents): void {
  // The latest handlers, so a parent that renders again while it records doesn't start the listening over.
  const latest = useRef(events);
  latest.current = events;
  useLayoutEffect(() => {
    if (!recording) return;
    const listen = (event: KeyboardEvent) => {
      if (event.key === "Tab") return;
      const instead = refusedShortcut(event);
      if (instead) latest.current.onRefused(instead);
      if (passesThrough(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return latest.current.onCancel();
      const accelerator = toAccelerator(event);
      if (!accelerator) return; // only modifiers so far, or a key apps use themselves: keep listening
      latest.current.onShortcut(accelerator);
    };
    const stop = () => latest.current.onStop();
    window.addEventListener("keydown", listen, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", listen, true);
      window.removeEventListener("blur", stop);
    };
  }, [recording]);
  useLayoutEffect(() => {
    if (!recording) return;
    api.recordingShortcut(true);
    return () => api.recordingShortcut(false);
  }, [recording]);
}
