// The capsule's two Stopped cards: a filing the person stopped, and a transcription they stopped. Each is a card over a bar that
// says Stopped (an action keeps its name through the flow: Stop, then Stopped), with Hide alone: the note, or the recording, is safe
// in the inbox, and nothing is left to do. Zel shows `filed` for it, there being no calmer mood for the bar (owner item 14).
import { CapsuleBar, Card, Text } from "@avanzel/ui";
import type { StateOf } from "./api.ts";
import { recordedLine, stoppedLine } from "./copy.ts";
import { Hide } from "./hide.tsx";
import { Words } from "./words.tsx";

/**
 * A filing that Stop ended: the person's words, and under them what is safe: the words are back in the inbox, what the stopped run
 * did to the library stayed or didn't (`partial`, `leftovers`), and when the evening review files the note, while a review will.
 * The card is not stamped: nothing was filed.
 */
export function Stopped({ state }: { state: StateOf<"cancelled"> }) {
  return (
    <div className="stack">
      <Card label="Thought" footer={<Text variant="footnote">{stoppedLine(state.agent, state.partial, state.leftovers, state.review)}</Text>}>
        <Words>{state.text}</Words>
      </Card>
      <CapsuleBar mood="filed" actions={<Hide />}>
        Stopped
      </CapsuleBar>
    </div>
  );
}

/**
 * A transcription that Stop ended: its recording waits in the inbox, and the card has no words yet (they are the evening review's to
 * make), so it is empty, and says what it is waiting for.
 */
export function Recorded({ state }: { state: StateOf<"recorded"> }) {
  return (
    <div className="stack">
      <Card label="Recording" placeholder="Your recording" footer={<Text variant="footnote">{recordedLine(state.review)}</Text>} />
      <CapsuleBar mood="filed" actions={<Hide />}>
        Stopped
      </CapsuleBar>
    </div>
  );
}
