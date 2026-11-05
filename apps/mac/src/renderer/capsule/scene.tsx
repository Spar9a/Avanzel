// What a state of the capsule draws, and the one bar it draws it in. Every state that has a bar says what is in it as a `BarSpec`, and
// `Capsule` (main.tsx) draws that into ONE bar, so that the bar's live region stays mounted from listening through transcribing and
// filing to filed: each change of state is then a change of what the region holds, which a screen reader hears. A region drawn again
// for each state arrives with its line already in it, which it often does not read, and the capsule announces only the start and the end of
// a filing.
import { CapsuleBar, type CapsuleBarProps, type CapsuleMood } from "@avanzel/ui";
import { Fragment, type ReactNode } from "react";
import { clock } from "../../shared/clock.ts";
import type { DictationState } from "../../shared/ipc.ts";
import { dictatingIntoLabel } from "../../shared/transcribing.ts";
import { useNow } from "../common/use-now.ts";

/** How often the time is read again: it shows whole seconds. */
const TICK_MS = 250;

/**
 * What a state says in the bar. `line`: the bar's one line, which stays the same for a whole state, since the region is live (a
 * listening bar has none). `levels` and `startedAt`: only a listening bar has them, the voice and how long the recording has run; nothing
 * else ticks inside a live region. `actions`: the buttons, in the order they read. `words`, `wordLines`, `hint`, `app` and `centred`: what
 * a recording's panel has beyond a row, as `CapsuleBar` says.
 */
export interface BarSpec extends Pick<CapsuleBarProps, "words" | "wordLines" | "hint" | "app" | "centred"> {
  mood: CapsuleMood;
  line?: ReactNode;
  levels?: readonly number[];
  /** Date.now() when the recording began: the bar draws how long it has run, in whole seconds. */
  startedAt?: number;
  actions?: ReactNode;
}

/**
 * The pieces of a state's stack, from the top: a card (of paper, or of the capsule's glass) if it has one, and the bar. A state leaves out
 * what it has none of: the editor has no bar, and a dictation's transcription has no card. Each piece is drawn in its own place, so that
 * one that two states share, the bar and a screen comment's screenshot, stays the same piece from one state to the next. `through`: the
 * bar has nothing to press, and may stand over the very box a dictation goes into, so the pointer goes through it.
 */
export interface Scene {
  card?: ReactNode;
  bar?: BarSpec;
  through?: boolean;
}

/**
 * What stands for where the words are going. A dictation's app, or an empty place (null) until it has been looked at, where it couldn't be
 * told, or where the app has no icon: Zel stands for the library, and these words aren't going there. Otherwise Zel (undefined).
 */
export function appOf(dictation: DictationState | undefined): CapsuleBarProps["app"] {
  if (!dictation) return undefined;
  return dictation.app?.icon ? { icon: dictation.app.icon, label: dictatingIntoLabel(dictation.app.name) } : null;
}

/**
 * The capsule's bar for the state of `kind`. It is drawn in the same place for every state that has one, so React keeps it, and its
 * live region, as the state changes; only what is in it changes. The buttons are the state's own, though: a button a state shares a
 * place with in the next one (Stop, then Open) is a new button, as it would be in a bar drawn for each state.
 */
export function Bar({ kind, mood, line, levels, startedAt, actions, words, wordLines, hint, app, centred }: BarSpec & { kind: string }) {
  const now = useNow(startedAt === undefined ? null : TICK_MS);
  return (
    <CapsuleBar
      mood={mood}
      levels={levels}
      time={startedAt === undefined ? undefined : clock(now - startedAt)}
      actions={actions ? <Fragment key={kind}>{actions}</Fragment> : undefined}
      words={words}
      wordLines={wordLines}
      hint={hint}
      app={app}
      centred={centred}
    >
      {line}
    </CapsuleBar>
  );
}
