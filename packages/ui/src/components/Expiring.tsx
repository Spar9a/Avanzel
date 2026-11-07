import { type CSSProperties, type ReactNode } from "react";
import "../foundations.css";
import "./expiring.css";

export interface ExpiringProps {
  /** The card it goes around, a panel card (`Card look="panel"`): the ring follows its rounded edge. */
  children: ReactNode;
  /** How long it has left, in seconds: a violet ring runs once round its edge over them, as `UndoBar`'s ring empties. Null: no ring. */
  seconds: number | null;
}

/**
 * Something that goes by itself in a moment, such as a thought that came to no note: a violet line runs round its edge, emptying as its
 * time runs out, so the eye sees it is on its way. The window takes it away when the time is up.
 */
export function Expiring({ children, seconds }: ExpiringProps) {
  return (
    <div className="av-expiring" style={seconds === null ? undefined : ({ "--_seconds": `${Math.max(0, seconds)}s` } as CSSProperties)}>
      {children}
      {seconds !== null && (
        <svg className="av-expiring-ring" aria-hidden="true">
          <rect pathLength={100} />
        </svg>
      )}
    </div>
  );
}
