// The capsule once something has gone wrong: a notice, in the words the windows tell the same problem in (shared/problems.ts).
import { Actions, Button, CapsuleNotice } from "@avanzel/ui";
import { problemBody } from "../common/problem.tsx";
import { api, type StateOf } from "./api.ts";

/**
 * Zel looks worried, never alarmed (`CapsuleNotice`). The title says what happened, and the body, a line for each "\n" of the state's
 * `detail`, what is safe; a command the person types in Terminal is set in the code face, as the windows set it (`problemBody`). The
 * buttons are Hide, which puts the card away, and the fix when the state names one (`action`), last, the moment's one primary. A
 * problem with no fix has Hide alone. It stays until it is handled: it hides by no timer.
 */
export function ProblemNotice({ state }: { state: StateOf<"error"> }) {
  const { message, detail, command, action, actionLabel } = state;
  const lines = detail?.split("\n").filter(Boolean) ?? [];
  return (
    <div className="slot">
      <CapsuleNotice
        title={message}
        actions={
          <Actions align="start">
            <Button size="small" variant="quiet" onClick={() => api.dismiss()}>Hide</Button>
            {action && (
              <Button size="small" variant="primary" onClick={() => api.openSettingsFor(action)}>
                {actionLabel ?? "Open Settings"}
              </Button>
            )}
          </Actions>
        }
      >
        {lines.length > 0 ? lines.map((line, i) => <p key={i}>{problemBody({ title: message, body: line, ...(command ? { command } : {}) })}</p>) : undefined}
      </CapsuleNotice>
    </div>
  );
}
