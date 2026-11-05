// The capsule while a recording listens: a bar (Zel listening, the wave, the time) and, above it, what a card of paper or glass adds. The
// bar is a live region and has no line while listening, so its time and its one button are all it holds: the design system draws the
// ticking time inside the region, which VoiceOver may read each second (owner item 5).
import { Button, Card, Hud, Kbd, Text } from "@avanzel/ui";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import { CALL_LISTENING_LINE, dictationListeningLine, fileModeLabel } from "../../shared/transcribing.ts";
import { api, type StateOf } from "./api.ts";
import { ScreenshotCard } from "./screenshot.tsx";
import type { Scene } from "./scene.tsx";
import { Words } from "./words.tsx";

/**
 * The bar's one button is this capture's file mode, which a press switches between now and the evening review, worded from the
 * review (`fileModeLabel`); a screen comment and setup's first spoken thought have none to switch (`fileMode` is null). Above the
 * bar, for a screen comment, its screenshot on a card labelled with the app; and, for the first recordings, the keys that finish
 * and give up a recording, on a small card of the capsule's glass (owner item 1). The time is the recording's own, counted from when
 * it began (`startedAt`), whatever is pressed. A dictation's words, once there are some, go on a card above that: the newest of them, as
 * they are said, and marked as a preview, since those that are pasted come from a recognition of their own. It has nothing to press, so
 * the pointer goes through it to the app they are said to (`.live-words`). It stands apart from the bar, whose live region would have a
 * screen reader read the words out at each change: the bar's own line is not used for them for that reason.
 */
export function listeningScene(state: StateOf<"listening">, levels: readonly number[]): Scene {
  if (state.mode === "call") return callScene(state, levels);
  return {
    card: state.dictation?.words ? (
      <div className="live-words">
        <Card label="Dictation" meta="Preview">
          <Words latest>{state.dictation.words}</Words>
        </Card>
      </div>
    ) : state.mode === "comment" && state.thumbnail ? (
      <ScreenshotCard thumbnail={state.thumbnail} context={state.context} />
    ) : undefined,
    // A dictation into another app says so on the same small card of glass, every time: its words go to the app the person is in,
    // not to the library, and only its own key ends it.
    hint: state.dictation ? (
      <div className="hint">
        <Hud>
          <Text variant="footnote">{dictationListeningLine(state.dictation.key)}</Text>
        </Hud>
      </div>
    ) : state.hint ? (
      <div className="hint">
        <Hud>
          <Text variant="footnote">
            <Kbd>{prettyAccelerator(state.hint)}</Kbd> to finish, <Kbd>Esc</Kbd> to cancel
          </Text>
        </Hud>
      </div>
    ) : undefined,
    bar: {
      mood: "listening",
      levels,
      startedAt: state.startedAt,
      actions: state.fileMode && (
        <Button size="small" onClick={() => api.toggleFileMode()}>
          {fileModeLabel(state.fileMode, state.review)}
        </Button>
      ),
    },
  };
}

/**
 * Notes on a call: the bar alone, with its line (the same for the whole call, so the live region says it once), the voice, the call's
 * time and Stop, which ends the call and makes its notes. No card, no hint and no file-mode switch: a call is filed as the setting says.
 */
function callScene(state: StateOf<"listening">, levels: readonly number[]): Scene {
  return {
    bar: {
      mood: "listening",
      line: CALL_LISTENING_LINE,
      levels,
      startedAt: state.startedAt,
      actions: <Button size="small" onClick={() => api.stopCall()}>Stop</Button>,
    },
  };
}
