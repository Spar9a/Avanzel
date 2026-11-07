// The capsule while a recording listens: one panel of glass, with the words as they are said above a row of Zel or the app, the voice and the
// time. The row is a live region and has no line while listening, so a screen reader says nothing while the person speaks, but for what its
// buttons say when pressed. A card of paper goes above the panel only for a screen comment's screenshot: paper is for what is kept,
// and these words are still in the air.
import { Button, Kbd } from "@avanzel/ui";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import { CALL_LISTENING_LINE } from "../../shared/transcribing.ts";
import { ListeningControls } from "../common/listening-controls.tsx";
import { api, type StateOf } from "./api.ts";
import { appOf, type Scene } from "./scene.tsx";
import { ScreenshotCard } from "./screenshot.tsx";

/**
 * The row's controls: this capture's file mode, a switch between now and the evening review, worded from the review (`fileModeChoices`),
 * which a screen comment and setup's first spoken thought have none of (`fileMode` is null); then Cancel, Pause and Stop, and for a thought
 * that files a note, Add (+) for files and screenshots. A dictation into another app ends only by its own key: it has no controls, and the
 * panel lets the pointer through to the app below. Above the row, the words as they are said, the newest in view; before there are any,
 * for the first recordings, the keys that finish and give up a recording (owner item 1). A dictation never has those: the owner took out
 * its line on how it ends, as it only took room, and Settings → Dictation says. A screen comment's card leaves room for two lines of words.
 * The time is the recording's own, counted from when it began (`startedAt`), whatever is pressed; paused, it stands still.
 */
export function listeningScene(state: StateOf<"listening">, levels: readonly number[], onAdd?: () => void): Scene {
  if (state.mode === "call") return callScene(state, levels);
  const comment = state.mode === "comment" && state.thumbnail;
  return {
    card: comment ? <ScreenshotCard thumbnail={state.thumbnail!} context={state.context} /> : undefined,
    through: !!state.dictation,
    bar: {
      mood: "listening",
      // A thought that files a note takes files dropped on its bar, as its + takes them.
      ...(onAdd && state.mode === "dictate" && state.fileMode !== null ? { onDropFiles: (files: File[]) => api.attachToRecording(files) } : {}),
      // Paused, the wave and the time stand still where they were, dimmed (`CapsuleBar`'s `paused`): the bar keeps its size, and the
      // ❚❚ that became ▶ says it is paused.
      levels,
      startedAt: state.startedAt,
      ...(state.pausedAt ? { pausedAt: state.pausedAt } : {}),
      centred: true,
      words: state.words,
      wordLines: comment ? 2 : 3,
      app: appOf(state.dictation),
      hint: state.hint ? (
        <>
          <Kbd>{prettyAccelerator(state.hint)}</Kbd> to finish, <Kbd>Esc</Kbd> to cancel
        </>
      ) : undefined,
      actions: state.dictation ? undefined : (
        <ListeningControls
          fileMode={state.fileMode}
          review={state.review}
          paused={!!state.pausedAt}
          onFileMode={(next) => {
            if (next !== state.fileMode) api.toggleFileMode();
          }}
          onCancel={() => api.cancel()}
          onPause={() => api.pause()}
          onStop={() => api.stop()}
          // A thought that files a note takes files and screenshots: the + opens the Add menu over the bar. A comment on the screen,
          // setup's first thought and a question for Ask (none of which has a file mode) don't.
          {...(onAdd && state.mode === "dictate" && state.fileMode !== null ? { onAdd } : {})}
          attached={state.attached?.length ?? 0}
        />
      ),
    },
  };
}

/**
 * Notes on a call: the row alone, with its line (the same for the whole call, so the live region says it once), the voice, which fills the
 * rest of the row after it (`steady`), the call's time and Stop, which ends the call and makes its notes. No card, no hint and no file-mode
 * switch: a call is filed as the setting says.
 */
function callScene(state: StateOf<"listening">, levels: readonly number[]): Scene {
  return {
    bar: {
      mood: "listening",
      line: CALL_LISTENING_LINE,
      steady: true,
      levels,
      startedAt: state.startedAt,
      actions: <Button size="small" onClick={() => api.stopCall()}>Stop</Button>,
    },
  };
}
