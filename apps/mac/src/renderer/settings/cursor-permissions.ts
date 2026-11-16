// What macOS has granted for dictating into any app, which the Dictation pane acts on and the Privacy pane lists.
import { useEffect, useRef, useState } from "react";
import type { CursorPermission, DictationPermissionState } from "../../shared/ipc.ts";

const api = window.avanzel.settings;

/** What macOS last said, in this window. */
let lastAnswer: DictationPermissionState | null = null;

/**
 * Null until the first answer, and a pane that comes back starts from the last one: asking the helper can take a second, and the window shouldn't
 * move again for what it was told a moment ago. It is asked again when the setting changes (the helper starts or stops) and when this window gets
 * the focus back, which is where the person is after granting a permission in System Settings. An answer that comes after a newer question was
 * asked is dropped, so the older one can't overwrite it.
 */
export function useCursorPermissions(enabled: boolean): { state: DictationPermissionState | null; ask(permission?: CursorPermission): Promise<void> } {
  const [state, setState] = useState<DictationPermissionState | null>(lastAnswer);
  const asked = useRef(0);
  const check = (question: () => Promise<DictationPermissionState>) => {
    const mine = ++asked.current;
    return question().then(
      (answer) => {
        if (mine !== asked.current) return;
        lastAnswer = answer;
        setState(answer);
      },
      // A question main couldn't answer leaves the line as it was.
      () => undefined,
    );
  };
  useEffect(() => {
    const again = () => void check(() => api.cursorPermissions());
    again();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [enabled]);
  return { state, ask: (permission) => check(() => api.askCursorPermissions(permission)) };
}
