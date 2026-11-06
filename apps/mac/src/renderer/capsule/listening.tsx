// The capsule while a recording listens: a bar (Zel listening, the wave, the time) and, above it, what a card of paper or glass adds. The
// bar is a live region and has no line while listening, so its time and its one button are all it holds: the design system draws the
// ticking time inside the region, which VoiceOver may read each second (owner item 5).
import { Button, Hud, Kbd, Segmented, Text } from "@avanzel/ui";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import type { FileMode } from "../../shared/ipc.ts";
import { CALL_LISTENING_LINE, dictationListeningLine, fileModeChoices, stopLabel } from "../../shared/transcribing.ts";
import { api, type StateOf } from "./api.ts";
import { ScreenshotCard } from "./screenshot.tsx";
import type { Scene } from "./scene.tsx";

/**
 * The bar's one control is this capture's file mode, a switch between now and the evening review, worded from the
 * review (`fileModeChoices`); a screen comment and setup's first spoken thought have none to switch (`fileMode` is null). Above the
 * bar, for a screen comment, its screenshot on a card labelled with the app; and, for the first recordings, the keys that finish
 * and give up a recording, on a small card of the capsule's glass (owner item 1). The time is the recording's own, counted from when
 * it began (`startedAt`), whatever is pressed.
 */
export function listeningScene(state: StateOf<"listening">, levels: readonly number[]): Scene {
  if (state.mode === "call") return callScene(state, levels);
  return {
    card: state.mode === "comment" && state.thumbnail ? <ScreenshotCard thumbnail={state.thumbnail} context={state.context} /> : undefined,
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
      ...(state.pausedAt ? { pausedAt: state.pausedAt, line: "Paused" } : {}),
      // A dictation into another app ends only by its own key: its bar has none of these.
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
        />
      ),
    },
  };
}

/**
 * A recording's controls, as recorders have them and the panel shows them too: when the agent files it (✦ now, or ☾ at the evening
 * review), then ✕ to give it up, ❚❚ to pause (▶ to go on), and ■ to stop, which wears the chosen sign, so it shows what stopping will
 * do. Choosing when starts nothing: the recording goes on, and only what happens after it stops changes.
 */
export function ListeningControls(props: {
  fileMode: FileMode | null;
  review: string | null;
  paused: boolean;
  onFileMode: (mode: FileMode) => void;
  onCancel: () => void;
  onPause: () => void;
  onStop: () => void;
}) {
  const { fileMode, review, paused } = props;
  const choices = fileModeChoices(review);
  return (
    <span className="listening-controls">
      {fileMode && (
        <Segmented
          label="When your agent files this recording"
          options={[
            { value: "now", label: choices.now, icon: "spark" },
            { value: "evening", label: choices.evening, icon: "moon" },
          ]}
          value={fileMode}
          onChange={props.onFileMode}
        />
      )}
      <Button size="small" variant="secondary" icon="close" label="Cancel the recording" onClick={props.onCancel} />
      <Button size="small" variant="secondary" icon={paused ? "play" : "pause"} label={paused ? "Resume" : "Pause"} onClick={props.onPause} />
      <Button
        size="small"
        variant="primary"
        icon="stop"
        label={stopLabel(fileMode, review)}
        {...(fileMode ? { badge: fileMode === "now" ? ("spark" as const) : ("moon" as const) } : {})}
        onClick={props.onStop}
      />
    </span>
  );
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
