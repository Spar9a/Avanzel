// The capsule while the words of a recording are made: a bar, and above it, for a screen comment, the screenshot it listened with.
import { Button } from "@avanzel/ui";
import { transcribingLine } from "../../shared/transcribing.ts";
import { api, type StateOf } from "./api.ts";
import type { Scene } from "./scene.tsx";
import { ScreenshotCard } from "./screenshot.tsx";

/**
 * The line says where, once, and changes once if it takes long (`slow`): then Stop keeps the recording in the inbox for the
 * evening review. A screen comment's and setup's first spoken thought's are never slow. A screen comment keeps its screenshot's card
 * (`thumbnail`, which the state carries for it), the same card it listened with, so that it is not drawn away for the words to be made
 * and drawn again, smaller, once they are saved.
 */
export function transcribingScene(state: StateOf<"transcribing">): Scene {
  return {
    card: state.mode === "comment" && state.thumbnail ? <ScreenshotCard thumbnail={state.thumbnail} context={state.context} /> : undefined,
    bar: {
      mood: "thinking",
      line: state.slow ? "Still transcribing…" : transcribingLine(state.onThisMac),
      actions: state.slow && <Button size="small" onClick={() => api.stopTranscribing()}>Stop</Button>,
    },
  };
}
