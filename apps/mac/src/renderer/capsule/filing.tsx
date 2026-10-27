// The capsule while an agent files the words: a card of paper above a bar. The bar is a live region, so what it says stays the
// same for a whole filing; everything that counts or changes (the seconds, the agent's newest step) is on the card, which is not
// one: VoiceOver hears a filing start and end, and not each second or each step.
import { Button, Card, Stack, Text } from "@avanzel/ui";
import { filingMeta, transcribedLine } from "../../shared/transcribing.ts";
import { filingLine } from "../common/narration.ts";
import { useNow } from "../common/use-now.ts";
import { api, type StateOf } from "./api.ts";
import { Hide } from "./hide.tsx";
import type { Scene } from "./scene.tsx";
import { Words } from "./words.tsx";

/** How often the card reads the clock: its seconds are whole, and the quiet is measured in them. */
const TICK_MS = 250;

/**
 * The bar names the agent and holds Hide, Edit (not once Stop was pressed: `canEdit`) and Stop (busy while it stops). The card
 * holds the words and, in its header, how long the filing has taken against about how long it takes (nothing while the run waits
 * for the library or its turn: its seconds have not begun). Its footer has the one line of what is going on (`filingLine`), then
 * how the words were made, and the note, if there is one.
 */
export function filingScene(state: StateOf<"filing">): Scene {
  return {
    card: <FilingCard state={state} />,
    bar: {
      mood: "thinking",
      line: `Filing with ${state.agent}…`,
      actions: (
        <>
          <Hide />
          {state.canEdit && <Button size="small" onClick={() => api.edit()}>Edit</Button>}
          <Button size="small" busy={state.cancelling} onClick={() => api.cancelFiling()}>Stop</Button>
        </>
      ),
    },
  };
}

/** The card counts the seconds, so it reads the clock; the bar, which is a live region, does not. */
function FilingCard({ state }: { state: StateOf<"filing"> }) {
  const now = useNow(TICK_MS);
  const line = filingLine(state, now);
  return (
    <Card
      label="Thought"
      meta={state.waiting ? undefined : filingMeta((now - state.startedAt) / 1000, state.estimate)}
      footer={
        <Stack gap={4}>
          {line && <Text variant="footnote" truncate>{line}</Text>}
          <Text variant="footnote" tone="secondary">
            {state.transcribedIn === null ? "Typed note" : transcribedLine(state.transcribedIn, state.onThisMac)}
          </Text>
          {state.detail && <Text variant="footnote" tone="secondary">{state.detail}</Text>}
        </Stack>
      }
    >
      <Words>{state.text}</Words>
    </Card>
  );
}
