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
  /** The live line: the words as they are heard, or what the agent is doing right now. While
      listening the newest words stay in view at the right. */
  children?: ReactNode;
  /** Voice levels while listening, 0 to 1. */
  levels?: readonly number[];
  /** Elapsed time, "0:07", while listening or thinking. */
  time?: string;
  /** Buttons at the end: Undo and Open once filed, the one fix when Zel needs the person. */
  actions?: ReactNode;
}

/** The capsule's bar at the bottom of the screen: Zel, the live line, the voice and the time. */
export function CapsuleBar({ mood, children, levels, time, actions }: CapsuleBarProps) {
  return (
    <Hud shape="pill" role="status">
      <span className="av-capsule-zel"><Zel mood={ZEL_MOOD[mood]} size="tiny" /></span>
      <span className="av-capsule-live" data-flow={mood === "listening" ? "stream" : "plain"}><span className="av-capsule-text">{children}</span></span>
      {mood === "listening" && levels && <Wave levels={levels} />}
      {time && (mood === "listening" || mood === "thinking") && <span className="av-capsule-time">{time}</span>}
      {actions && <span className="av-capsule-actions">{actions}</span>}
    </Hud>
  );
}
