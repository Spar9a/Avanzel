// The capsule while a recording listens: one panel of glass, with the words as they are said above a row of Zel or the app, the voice and the
// time. The row is a live region and has no line while listening, so a screen reader says nothing while the person speaks, but for what its
// one button says when pressed. A card of paper goes above the panel only for a screen comment's screenshot: paper is for what is kept,
// and these words are still in the air.
import { Button, Kbd } from "@avanzel/ui";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import { CALL_LISTENING_LINE, fileModeLabel } from "../../shared/transcribing.ts";
import { api, type StateOf } from "./api.ts";
import { appOf, type Scene } from "./scene.tsx";
import { ScreenshotCard } from "./screenshot.tsx";

/**
 * The row's one button is this capture's file mode, which a press switches between now and the evening review, worded from the review
 * (`fileModeLabel`); a screen comment, a dictation and setup's first spoken thought have none to switch (`fileMode` is null), and a panel
 * with nothing to press lets the pointer through to the app below. Above the row, the words as they are said, the newest in view; before
 * there are any, for the first recordings, the keys that finish and give up a recording (owner item 1). A dictation never has those: the
 * owner took out its line on how it ends, as it only took room, and Settings → Voice says. A screen comment's card leaves room for two
 * lines of words. The time is the recording's own, counted from when it began (`startedAt`), whatever is pressed.
 */
export function listeningScene(state: StateOf<"listening">, levels: readonly number[]): Scene {
  if (state.mode === "call") return callScene(state, levels);
  const comment = state.mode === "comment" && state.thumbnail;
  return {
    card: comment ? <ScreenshotCard thumbnail={state.thumbnail!} context={state.context} /> : undefined,
    through: !state.fileMode,
    bar: {
      mood: "listening",
      levels,
      startedAt: state.startedAt,
      centred: true,
      words: state.words,
      wordLines: comment ? 2 : 3,
      app: appOf(state.dictation),
      hint: state.hint ? (
        <>
          <Kbd>{prettyAccelerator(state.hint)}</Kbd> to finish, <Kbd>Esc</Kbd> to cancel
        </>
      ) : undefined,
      actions: state.fileMode && (
        <Button size="small" onClick={() => api.toggleFileMode()}>
          {fileModeLabel(state.fileMode, state.review)}
        </Button>
      ),
    },
  };
}

/**
 * Notes on a call: the row alone, with its line (the same for the whole call, so the live region says it once), the voice, the call's
 * time and Stop, which ends the call and makes its notes. No card, no hint and no file-mode switch: a call is filed as the setting says.
 * The voice is the last 16 of its levels, which leaves its line room to be read whole beside Stop.
 */
function callScene(state: StateOf<"listening">, levels: readonly number[]): Scene {
  return {
    bar: {
      mood: "listening",
      line: CALL_LISTENING_LINE,
      levels: levels.slice(-16),
      startedAt: state.startedAt,
      actions: <Button size="small" onClick={() => api.stopCall()}>Stop</Button>,
    },
  };
}
