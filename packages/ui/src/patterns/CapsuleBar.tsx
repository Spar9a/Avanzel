import type { ReactNode } from "react";
import { Hud } from "../components/Hud.tsx";
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
  /** A short line above the row while there are no `words`, such as the keys that finish a recording. */
  hint?: ReactNode;
  /** The app the words are going to, in Zel's place: Zel stands for the library. `null` holds the place empty until it is known.
      `label` is what a screen reader hears of the icon, and `icon` an image's address. */
  app?: { icon: string; label: string } | null;
  /** The voice, or the line, stands in the middle of the row, whatever is at either side. */
  centred?: boolean;
}

/** The capsule's panel at the bottom of the screen: one piece of glass, with the words above a row of Zel or the app, the
    voice and the time. With no words it is a single row, and it grows upward as they come, so the row never moves. */
export function CapsuleBar({ mood, children, levels, time, actions, words, wordLines = 3, hint, app, centred }: CapsuleBarProps) {
  return (
    <Hud shape="capsule">
      {words ? (
        <div className="av-capsule-words" data-lines={wordLines}>
          <div>{words}</div>
        </div>
      ) : hint ? (
        <div className="av-capsule-hint">{hint}</div>
      ) : null}
      <div className="av-capsule-row" role="status" data-centred={centred ? "" : undefined}>
        {app ? (
          <img className="av-capsule-app" src={app.icon} alt={app.label} />
        ) : (
          <span className="av-capsule-zel">{app === null ? null : <Zel mood={ZEL_MOOD[mood]} size="tiny" />}</span>
        )}
        <span className="av-capsule-middle">
          {children ? <span className="av-capsule-live"><span className="av-capsule-text">{children}</span></span> : null}
          {mood === "listening" && levels && <Wave levels={levels} />}
        </span>
        {(time || actions) && (
          <span className="av-capsule-end">
            {time && (mood === "listening" || mood === "thinking") && <span className="av-capsule-time" aria-hidden="true">{time}</span>}
            {actions && <span className="av-capsule-actions">{actions}</span>}
          </span>
        )}
      </div>
    </Hud>
  );
}
