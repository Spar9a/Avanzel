import type { ReactNode } from "react";
import { useFileDrop } from "../components/file-drop.ts";
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
  /** The live line: the words as they are heard, or what the agent is doing right now. While
      listening the newest words stay in view at the right. */
  children?: ReactNode;
  /** Voice levels while listening, 0 to 1. */
  levels?: readonly number[];
  /** Elapsed time, "0:07", while listening or thinking. */
  time?: string;
  /** Buttons at the end: Undo and Open once filed, the one fix when Zel needs the person. */
  actions?: ReactNode;
  /**
   * While listening, the line is a steady label ("Taking notes on the call"), not words as they are heard: it sits at the left, and the
   * voice fills the rest of the bar, rather than a short wave at the right with an empty bar before it.
   */
  steady?: boolean;
  /** Given, files can be dropped on the bar: while one is dragged over it the bar turns violet and says so, and the files are handed over. */
  onDropFiles?: (files: File[]) => void;
  /** The recording is paused: the voice and the time stand still, dimmed, where they were, and the bar keeps its size. */
  paused?: boolean;
}

/** The capsule's bar at the bottom of the screen: Zel, the live line, the voice and the time. */
export function CapsuleBar({ mood, children, levels, time, actions, steady = false, onDropFiles, paused = false }: CapsuleBarProps) {
  const fill = mood === "listening" && steady;
  const drop = useFileDrop(onDropFiles);
  const bar = (
    <Hud shape="pill" role="status">
      <span className="av-capsule-zel"><Zel mood={ZEL_MOOD[mood]} size="tiny" /></span>
      <span className="av-capsule-live" data-flow={fill ? "label" : mood === "listening" ? "stream" : "plain"}><span className="av-capsule-text">{children}</span></span>
      {mood === "listening" && levels && <span className="av-capsule-voice" data-paused={paused ? "" : undefined}><Wave levels={levels} fill={fill} /></span>}
      {time && (mood === "listening" || mood === "thinking") && <span className="av-capsule-time" data-paused={paused ? "" : undefined}>{time}</span>}
      {actions && <span className="av-capsule-actions">{actions}</span>}
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
