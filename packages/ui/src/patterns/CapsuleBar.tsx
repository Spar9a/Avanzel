import type { ReactNode } from "react";
import { useFileDrop } from "../components/file-drop.ts";
import { Hud } from "../components/Hud.tsx";
import { Text } from "../components/Text.tsx";
import { Wave } from "../components/Wave.tsx";
import { Zel, type ZelMood } from "../components/Zel.tsx";
import "../foundations.css";
import "./capsule.css";

/** The capsule's four moments: the microphone is on, the agent is working, the work is saved, or one
    thing needs the person. */
export type CapsuleMood = "listening" | "thinking" | "filed" | "needs-you";

const ZEL_MOOD: Record<CapsuleMood, ZelMood> = { listening: "listening", thinking: "thinking", filed: "filed", "needs-you": "needs-you" };

export interface CapsuleBarProps {
  mood: CapsuleMood;
  /** The bar's one line: what the agent is doing right now. It is in the live region, so a screen reader reads it when it
      changes: the words as they are heard go in `words`. */
  children?: ReactNode;
  /** Voice levels while listening, 0 to 1. */
  levels?: readonly number[];
  /** Elapsed time, "0:07", while listening or thinking. A screen reader isn't read each second of it. */
  time?: string;
  /** Buttons at the end: Undo and Open once filed, the one fix when Zel needs the person. */
  actions?: ReactNode;
  /** The person's words as they are heard, on the same glass above the row, with the newest in view and older ones fading out at
      the top. They are outside the live region, so a screen reader doesn't read them out at each change. */
  words?: string;
  /** How many lines of `words` stay in view: 3, or 2 where a card above leaves less room. */
  wordLines?: 2 | 3;
  /** A short line above the row while there are no `words`, such as the keys that finish a recording: words and keys, set as a footnote. */
  hint?: ReactNode;
  /** The app the words are going to, in Zel's place: Zel stands for the library. `null` holds the place empty, for words going to an app
      with no icon to show, or none known yet. `icon` is an image's address. `label` names it for a screen reader that moves onto it,
      outside the live region, so that nothing speaks while the person does and a microphone hears only them. */
  app?: { icon: string; label: string } | null;
  /** The voice, or the line, stands in the middle of the row, whatever is at either side. */
  centred?: boolean;
  /**
   * While listening, the line is a steady label ("Taking notes on the call"), not words as they are heard: it sits at the left, and the
   * voice fills the rest of the row, rather than a short wave with an empty row beside it.
   */
  steady?: boolean;
  /** Given, files can be dropped on the bar: while one is dragged over it the bar turns violet and says so, and the files are handed over. */
  onDropFiles?: (files: File[]) => void;
  /** The recording is paused: the voice and the time stand still, dimmed, where they were, and the bar keeps its size. */
  paused?: boolean;
}

/** The capsule's panel at the bottom of the screen: one piece of glass, with the words above a row of Zel or the app, the
    voice and the time. With no words it is a single row, and it grows upward as they come, so the row never moves. */
export function CapsuleBar({ mood, children, levels, time, actions, words, wordLines = 3, hint, app, centred, steady = false, onDropFiles, paused = false }: CapsuleBarProps) {
  const fill = mood === "listening" && steady;
  const drop = useFileDrop(onDropFiles);
  const bar = (
    <Hud shape="capsule">
      {app ? <span className="av-capsule-label">{app.label}</span> : null}
      {words ? (
        <div className="av-capsule-words" data-lines={wordLines}>
          <div>{words}</div>
        </div>
      ) : hint ? (
        <div className="av-capsule-hint">
          <Text variant="footnote" tone="secondary">{hint}</Text>
        </div>
      ) : null}
      <div className="av-capsule-row" role="status" data-centred={centred ? "" : undefined}>
        {app ? (
          <img className="av-capsule-app" src={app.icon} alt="" />
        ) : (
          <span className="av-capsule-zel">{app === null ? null : <Zel mood={ZEL_MOOD[mood]} size="tiny" />}</span>
        )}
        <span className="av-capsule-middle">
          {children ? <span className="av-capsule-live" data-flow={fill ? "label" : undefined}><span className="av-capsule-text">{children}</span></span> : null}
          {mood === "listening" && levels && (
            <span className="av-capsule-voice" data-paused={paused ? "" : undefined}><Wave levels={levels} tone="ink" fill={fill} /></span>
          )}
        </span>
        {(time || actions) && (
          <span className="av-capsule-end">
            {time && (mood === "listening" || mood === "thinking") && (
              <span className="av-capsule-time" data-paused={paused ? "" : undefined} aria-hidden="true">{time}</span>
            )}
            {actions && <span className="av-capsule-actions">{actions}</span>}
          </span>
        )}
      </div>
    </Hud>
  );
  // The same box around the bar whether or not it takes files, so the bar, and its live region, stays the one node as it starts and
  // stops taking them (a dictation's listening, then its transcribing): only the words that show while a file is over it come and go.
  return (
    <span className="av-capsule-drop-zone" data-dropping={drop.over ? "" : undefined} {...drop.handlers}>
      {bar}
      {onDropFiles && <span className="av-capsule-drop" aria-hidden="true">Drop to add to this recording</span>}
    </span>
  );
}
