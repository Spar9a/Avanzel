// The capsule while a recording listens: a bar (CapsuleBar: Zel listening, the wave, the time) and, above it, what a card of paper
// or glass adds. The bar is a live region and has no line while listening, so its time and its one button are all it holds: the
// design system draws the ticking time inside the region, which VoiceOver may read each second (owner item 5).
import { Button, CapsuleBar, Card, Hud, Kbd, Text } from "@avanzel/ui";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import { fileModeLabel } from "../../shared/transcribing.ts";
import { useNow } from "../common/use-now.ts";
import { api, type StateOf } from "./api.ts";

/** How often the time is read again: it shows whole seconds. */
const TICK_MS = 250;

/** How long a recording has run, as the bar draws it: "0:07". */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The bar's one button is this capture's file mode, which a press switches between now and the evening review, worded from the
 * review (`fileModeLabel`); a screen comment and setup's first spoken thought have none to switch (`fileMode` is null). Above the
 * bar, for a screen comment, its screenshot on a card labelled with the app; and, for the first recordings, the keys that finish
 * and give up a recording, on a small card of the capsule's glass (owner item 1).
 */
export function Listening({ state, levels }: { state: StateOf<"listening">; levels: readonly number[] }) {
  const now = useNow(TICK_MS);
  const app = state.context?.app;
  return (
    <div className="stack">
      {state.mode === "comment" && state.thumbnail && (
        <Card label={app ?? "Screen"} ruled={false}>
          <img className="thumbnail" src={state.thumbnail} alt={app ? `Screenshot of ${app}` : "Screenshot"} />
        </Card>
      )}
      {state.hint && (
        <div className="hint">
          <Hud>
            <Text variant="footnote">
              <Kbd>{prettyAccelerator(state.hint)}</Kbd> to finish, <Kbd>Esc</Kbd> to cancel
            </Text>
          </Hud>
        </div>
      )}
      <CapsuleBar
        mood="listening"
        levels={levels}
        time={clock(now - state.startedAt)}
        actions={
          state.fileMode && (
            <Button size="small" onClick={() => api.toggleFileMode()}>
              {fileModeLabel(state.fileMode, state.review)}
            </Button>
          )
        }
      />
    </div>
  );
}
