import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import "../foundations.css";
import "./undobar.css";

export interface UndoBarProps {
  /** What was just done, which can still be taken back: "Page deleted". */
  message: string;
  /** How long it can be taken back, in seconds: a ring around the × empties over them, and then it is done (`onDone`). */
  seconds: number;
  /** Undo: what was done is taken back, and the bar goes. */
  onUndo: () => void;
  /** The time is up, or the × was pressed: it stays done, and the bar goes. */
  onDone: () => void;
  /** The time stands still at its start (a still picture of it, as the gallery shows): nothing ends by itself. */
  paused?: boolean;
}

/**
 * Something just done that can still be taken back, for a few seconds: a bar on the capsule's glass that rises in, with what was done,
 * Undo, and an × in a ring that empties as the time runs out. Undo takes it back; the × or the end of the time lets it stand. Each new
 * thing done is a new bar (give it a new `key`), its time from the start.
 */
export function UndoBar({ message, seconds, onUndo, onDone, paused = false }: UndoBarProps) {
  const done = useRef(onDone);
  done.current = onDone;
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (paused) return;
    const began = Date.now();
    const tick = setInterval(() => {
      const remaining = Math.max(0, seconds - (Date.now() - began) / 1000);
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(tick);
        done.current();
      }
    }, 100);
    return () => clearInterval(tick);
  }, [seconds, paused]);
  return (
    <div className="av-undo-bar" role="status" data-paused={paused ? "" : undefined} style={{ "--_seconds": `${seconds}s` } as CSSProperties}>
      <span className="av-undo-bar-message">{message}</span>
      <Button size="small" variant="quiet" icon="undo" onClick={onUndo}>Undo</Button>
      <button type="button" className="av-undo-bar-close" aria-label={`Let it stand, ${Math.ceil(left)} seconds left to undo`} onClick={onDone}>
        <span className="av-undo-bar-ring" aria-hidden="true" />
        <span className="av-undo-bar-count" aria-hidden="true">{Math.ceil(left)}</span>
        <span className="av-undo-bar-x" aria-hidden="true"><Icon name="close" size={12} /></span>
      </button>
    </div>
  );
}
