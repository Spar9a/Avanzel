// A thought while an agent files it, as one card of paper: in the capsule over the bar, and in the panel's Capture under its tiles. Its
// head names the agent at work, in a chip that is a live region and stays the same for the whole filing; a violet line under the head
// fills as the filing goes; the words; and a foot with what is going on and how long it has taken (which tick, and are not a live
// region), with Edit and Stop at its right. VoiceOver hears a filing start and end, and not each second or each step.
import { Button, Card, Stack, Text } from "@avanzel/ui";
import type { ReactNode } from "react";
import type { CapsuleState } from "../../shared/ipc.ts";
import { filingMeta, transcribedLine } from "../../shared/transcribing.ts";
import { filingLine } from "./narration.ts";
import { useNow } from "./use-now.ts";

/** How often the card reads the clock: its seconds are whole, and the quiet is measured in them. */
const TICK_MS = 250;

export type FilingCardState = Extract<CapsuleState, { kind: "filing" }>;

/**
 * How far a filing is against about how long it takes: it never reads as done before it is, so it slows as it nears the estimate and
 * stops short of the end. Nothing while the run waits for the library or its turn: its seconds have not begun.
 */
export function filingProgress(seconds: number, estimate: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || estimate <= 0) return 0;
  return Math.min(0.95, 1 - Math.exp(-seconds / estimate));
}

/**
 * The card counts the seconds, so it reads the clock; its chip, which is a live region, does not change with them. `words` is the
 * thought as the window sets it. Edit and Stop show only when given; × in its corner only with `onClose`.
 */
export function FilingCard({ state, words, onEdit, onStop, onClose, more }: {
  state: FilingCardState;
  words: ReactNode;
  onEdit?: () => void;
  onStop?: () => void;
  onClose?: () => void;
  /** A control of the window's own in the head, right after the status: Processing's bin for a thought in the queue. */
  more?: ReactNode;
}) {
  const now = useNow(TICK_MS);
  const line = filingLine(state, now);
  const seconds = (now - state.startedAt) / 1000;
  return (
    <Card
      look="panel"
      label="Thought"
      status={state.waiting ? "Waiting to file" : `Filing with ${state.agent}`}
      progress={state.waiting ? undefined : filingProgress(seconds, state.estimate)}
      {...(onClose ? { onClose } : {})}
      {...(more ? { headAction: more } : {})}
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
        onEdit || onStop ? (
          <>
            {onEdit && state.canEdit && <Button size="regular" onClick={onEdit}>Edit</Button>}
            {onStop && <Button size="regular" icon="stop" busy={state.cancelling} onClick={onStop}>Stop</Button>}
          </>
        ) : undefined
      }
    >
      {words}
    </Card>
  );
}
