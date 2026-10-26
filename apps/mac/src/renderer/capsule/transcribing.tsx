// The capsule while the words of a recording are made: a bar and nothing above it.
import { Button, CapsuleBar } from "@avanzel/ui";
import { transcribingLine } from "../../shared/transcribing.ts";
import { api, type StateOf } from "./api.ts";

/**
 * The line says where, once, and changes once if it takes long (`slow`): then Stop keeps the recording in the inbox for the
 * evening review. A screen comment's and setup's first spoken thought's are never slow.
 */
export function Transcribing({ state }: { state: StateOf<"transcribing"> }) {
  return (
    <div className="stack">
      <CapsuleBar
        mood="thinking"
        actions={state.slow && <Button size="small" onClick={() => api.stopTranscribing()}>Stop</Button>}
      >
        {state.slow ? "Still transcribing…" : transcribingLine(state.onThisMac)}
      </CapsuleBar>
    </div>
  );
}
