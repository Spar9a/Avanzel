// The capsule while a recording listens: a bar (Zel listening, the wave, the time) and, above it, what a card of paper or glass adds. The
// bar is a live region and has no line while listening, so its time and its one button are all it holds: the design system draws the
// ticking time inside the region, which VoiceOver may read each second (owner item 5).
import { Button, Hud, Kbd, Text } from "@avanzel/ui";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import { fileModeLabel } from "../../shared/transcribing.ts";
import { api, type StateOf } from "./api.ts";
import { ScreenshotCard } from "./screenshot.tsx";
import type { Scene } from "./scene.tsx";

/**
 * The bar's one button is this capture's file mode, which a press switches between now and the evening review, worded from the
 * review (`fileModeLabel`); a screen comment and setup's first spoken thought have none to switch (`fileMode` is null). Above the
 * bar, for a screen comment, its screenshot on a card labelled with the app; and, for the first recordings, the keys that finish
 * and give up a recording, on a small card of the capsule's glass (owner item 1). The time is the recording's own, counted from when
 * it began (`startedAt`), whatever is pressed.
 */
export function listeningScene(state: StateOf<"listening">, levels: readonly number[]): Scene {
  return {
    card: state.mode === "comment" && state.thumbnail ? <ScreenshotCard thumbnail={state.thumbnail} context={state.context} /> : undefined,
    hint: state.hint ? (
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
