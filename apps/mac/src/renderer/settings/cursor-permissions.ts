// What macOS has granted for dictating into any app, which the Dictation pane acts on and the Privacy pane lists.
import { useEffect, useRef, useState } from "react";
import type { CursorPermission, CursorPermissionState } from "../../shared/ipc.ts";

const api = window.avanzel.settings;

/**
 * Null until the first answer. It is asked again when the setting changes (the helper starts or stops) and when this window gets the focus
 * back, which is where the person is after granting a permission in System Settings. An answer that comes after a newer question was asked is
 * dropped, so the older one can't overwrite it.
 */
export function useCursorPermissions(enabled: boolean): { state: CursorPermissionState | null; ask(permission?: CursorPermission): Promise<void> } {
  const [state, setState] = useState<CursorPermissionState | null>(null);
  const asked = useRef(0);
  const check = (question: () => Promise<CursorPermissionState>) => {
    const mine = ++asked.current;
    return question().then(
      (answer) => {
        if (mine === asked.current) setState(answer);
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
