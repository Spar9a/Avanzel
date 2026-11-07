import type { ReactNode } from "react";
import "../foundations.css";
import "./capsule.css";

export interface CapsuleAppearProps {
  /** What the capsule shows: its bar, with a card or a menu over it, or a notice. */
  children: ReactNode;
  /** It is going: it sinks and fades, and takes no pointer, before its window hides. */
  leaving?: boolean;
}

/**
 * The capsule coming and going as a whole: drawn, it rises a little from the bottom of the screen and fades in; `leaving`, it sinks back
 * and fades out (`CAPSULE_LEAVE_MS` long: `--av-duration-base`), so it never pops in or out. What changes inside it while it is up
 * changes in place.
 */
export function CapsuleAppear({ children, leaving = false }: CapsuleAppearProps) {
  return (
    <div className="av-capsule-appear" data-leaving={leaving ? "" : undefined}>
      {children}
    </div>
  );
}
