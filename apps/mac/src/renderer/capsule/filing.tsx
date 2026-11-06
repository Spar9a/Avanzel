// The capsule while an agent files the words: one card of paper that holds it all. Its head names the agent at work, in a chip that is a
// live region and stays the same for the whole filing; a violet line under the head fills as the filing goes; the words; and a foot with
// what is going on and how long it has taken (which tick, and are not a live region), with Edit and Stop at its right. Hide is the card's
// close button in its corner. VoiceOver hears a filing start and end, and not each second or each step.
import { Button, Card, Stack, Text } from "@avanzel/ui";
import { filingMeta, transcribedLine } from "../../shared/transcribing.ts";
import { filingLine } from "../common/narration.ts";
import { useNow } from "../common/use-now.ts";
import { api, type StateOf } from "./api.ts";
import type { Scene } from "./scene.tsx";
import { Words } from "./words.tsx";

/** How often the card reads the clock: its seconds are whole, and the quiet is measured in them. */
const TICK_MS = 250;

/** The card, and no bar: everything a filing shows and offers is on the card (`FilingCard`). */
export function filingScene(state: StateOf<"filing">): Scene {
  return { card: <FilingCard state={state} /> };
}

/**
 * How far a filing is against about how long it takes: it never reads as done before it is, so it slows as it nears the estimate and
 * stops short of the end. Nothing while the run waits for the library or its turn: its seconds have not begun.
 */
export function filingProgress(seconds: number, estimate: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || estimate <= 0) return 0;
  return Math.min(0.95, 1 - Math.exp(-seconds / estimate));
}

/** The card counts the seconds, so it reads the clock; its chip, which is a live region, does not change with them. */
function FilingCard({ state }: { state: StateOf<"filing"> }) {
  const now = useNow(TICK_MS);
  const line = filingLine(state, now);
  const seconds = (now - state.startedAt) / 1000;
  return (
    <Card
      label="Thought"
      status={state.waiting ? "Waiting to file" : `Filing with ${state.agent}`}
      progress={state.waiting ? undefined : filingProgress(seconds, state.estimate)}
      onClose={() => api.dismiss()}
      footer={
        <Stack gap={4}>
          {line && <Text variant="footnote" truncate>{line}</Text>}
          <Text variant="footnote" tone="secondary">
            {[
              state.waiting ? null : filingMeta(seconds, state.estimate),
              state.transcribedIn === null ? "Typed note" : transcribedLine(state.transcribedIn, state.onThisMac),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {state.detail && <Text variant="footnote" tone="secondary">{state.detail}</Text>}
        </Stack>
      }
      actions={
        <>
          {state.canEdit && <Button size="regular" onClick={() => api.edit()}>Edit</Button>}
          <Button size="regular" icon="stop" busy={state.cancelling} onClick={() => api.cancelFiling()}>Stop</Button>
        </>
      }
    >
      <Words>{state.text}</Words>
    </Card>
  );
}
