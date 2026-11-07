// The capsule while the words of a recording are made: the same panel it listened in, with the words said so far still on it, and above it,
// for a screen comment, the screenshot it listened with.
import { Button } from "@avanzel/ui";
import { transcribingLine } from "../../shared/transcribing.ts";
import { api, type StateOf } from "./api.ts";
import { appOf, type Scene } from "./scene.tsx";
import { ScreenshotCard } from "./screenshot.tsx";

/**
 * The line says where, once, in the voice's place, and changes once if it takes long (`slow`): then Stop keeps the recording in the inbox
 * for the evening review, or, for a question said into Ask, keeps nothing and drops its words. A screen comment's and setup's first spoken
 * thought's are never slow. A screen comment keeps its screenshot's card (`thumbnail`, which the state carries for it), the same card it
 * listened with, so that it is not drawn away for the words to be made and drawn again, smaller, once they are saved. With no Stop there
 * is nothing to press, and the pointer goes through, as it does while listening.
 */
export function transcribingScene(state: StateOf<"transcribing">): Scene {
  const comment = state.mode === "comment" && state.thumbnail;
  return {
    card: comment ? <ScreenshotCard thumbnail={state.thumbnail!} context={state.context} /> : undefined,
    through: !state.slow,
    bar: {
      mood: "thinking",
      line: state.slow ? "Still transcribing…" : transcribingLine(state.onThisMac),
      centred: true,
      words: state.words,
      wordLines: comment ? 2 : 3,
      app: appOf(state.dictation),
      actions: state.slow && <Button size="small" onClick={() => api.stopTranscribing()}>Stop</Button>,
    },
  };
}
