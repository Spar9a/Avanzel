// The capsule while a thought is made and filed: it listens, the words are made, an agent files them, or the person edits them
// first. Each is a bar (CapsuleBar: Zel's mood, one steady line, buttons) and, above it, a card of paper where there are words to
// show. The bar is a live region, so what it says stays the same for a whole state, and everything that counts or changes (a
// filing's seconds, the agent's newest step) is on the card, which is not one: VoiceOver hears a filing start and end, and not each
// second. The one exception is the listening bar's time, which the design system draws in the bar (owner item 5).
import { Actions, Button, CapsuleBar, Card, Hud, Kbd, Stack, Text, TextArea } from "@avanzel/ui";
import { useState } from "react";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import type { CapsuleState } from "../../shared/ipc.ts";
import { filingMeta, transcribedLine, transcribingLine } from "../../shared/transcribing.ts";
import { rowLine } from "../common/narration.ts";
import { Hide, useNow, Words } from "./common.tsx";

const api = window.avanzel.capsule;

type State<Kind extends CapsuleState["kind"]> = Extract<CapsuleState, { kind: Kind }>;

/** How often a card reads the clock: its seconds are whole, and the quiet is measured in them. */
const TICK_MS = 250;

/** How long the agent may take no step before the card says it is still at work. */
const QUIET_MS = 8_000;

/** How long a recording has run, as the bar draws it: "0:07". */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Recording. The bar has no line (the words are made after the stop), only its time and this capture's file mode as a button,
 * which switches it between now and tonight; a screen comment and setup's first spoken thought have none to switch (`fileMode`
 * is null). Above the bar, for a screen comment, its screenshot on a card labelled with the app; and, for the first recordings,
 * the keys that finish and give up a recording, on a small card of the capsule's glass (owner item 1).
 */
export function Listening({ state, levels }: { state: State<"listening">; levels: readonly number[] }) {
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
              {state.fileMode === "now" ? "Files now" : "Files tonight"}
            </Button>
          )
        }
      />
    </div>
  );
}

/**
 * The words are being made. The line says where, once, and changes once if it takes long (`slow`): then Stop keeps the recording
 * in the inbox for the evening review. A screen comment's and setup's first spoken thought's are never slow.
 */
export function Transcribing({ state }: { state: State<"transcribing"> }) {
  return (
    <div className="stack">
      <CapsuleBar
        mood="thinking"
        actions={state.slow && <Button size="small" onClick={() => api.stopTranscribing()}>Stop</Button>}
      >
        {state.slow ? "Still transcribing…" : transcribingLine(state.onThisMac)}
      </CapsuleBar>
    </div>
  );
}

/**
 * An agent files the words. The bar names the agent and holds Hide, Edit (not once Stop was pressed: `canEdit`) and Stop (busy
 * while it stops). The card holds the words and, in its header, how long the filing has taken against about how long it takes
 * (nothing while the run waits for the library: its seconds have not begun). Its footer has one line of what is going on: the
 * newest step; or, with no step for eight seconds, that the agent is still working; or that the run waits for another. Under it
 * come how the words were made, and the note, if there is one.
 */
export function Filing({ state }: { state: State<"filing"> }) {
  const now = useNow(TICK_MS);
  const newest = state.rows.at(-1);
  let line: string | null = null;
  if (state.waiting) line = "Waiting for another Avanzel run to finish…";
  else if (now - state.stepAt >= QUIET_MS) line = `${state.agent} is still working…`;
  else if (newest) line = rowLine(newest);
  return (
    <div className="stack">
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
      <CapsuleBar
        mood="thinking"
        actions={
          <>
            <Hide />
            {state.canEdit && <Button size="small" onClick={() => api.edit()}>Edit</Button>}
            <Button size="small" busy={state.cancelling} onClick={() => api.cancelFiling()}>Stop</Button>
          </>
        }
      >
        {`Filing with ${state.agent}…`}
      </CapsuleBar>
    </div>
  );
}

/**
 * The words, edited on the card's paper before they are filed (owner item 13). The panel takes the focus for this, and Return
 * files, Shift-Return starts a line and Esc gives the edit up. Every change goes to main, which keeps the edit if Avanzel quits
 * or a recording starts first. There is no bar: Cancel and File are the card's own.
 */
export function Editor({ text }: { text: string }) {
  const [value, setValue] = useState(text);
  return (
    <div className="stack">
      <Card
        label="Edit before filing"
        footer={
          <Actions>
            <Button size="small" variant="quiet" onClick={() => api.cancelEdit()}>Cancel</Button>
            <Button size="small" variant="primary" onClick={() => api.submitEdit(value)}>File</Button>
          </Actions>
        }
      >
        <div className="editor">
          <TextArea
            label="Your words"
            labelHidden
            autoFocus
            value={value}
            onChange={(next) => {
              setValue(next);
              api.editDraft(next);
            }}
            onEnter={() => api.submitEdit(value)}
            onEscape={() => api.cancelEdit()}
          />
        </div>
      </Card>
    </div>
  );
}
