import type { ReactNode } from "react";
import { Hud } from "../components/Hud.tsx";
import { Zel } from "../components/Zel.tsx";
import "../foundations.css";
import "./capsule.css";

export interface CapsuleNoticeProps {
  /** What happened, in one sentence: "Claude Code has hit its usage limit." */
  title: string;
  /** What is safe and what happens next, in one sentence. Commands go in <Text variant="code">. */
  children?: ReactNode;
  /** One <Actions> row: the fix first in importance, last in the row. */
  actions?: ReactNode;
}

/** A problem in the capsule: Zel looks worried, never alarmed, and offers one way out (DESIGN.md, "Copy"). */
export function CapsuleNotice({ title, children, actions }: CapsuleNoticeProps) {
  return (
    <Hud role="alert">
      <div className="av-capsule-notice">
        <Zel mood="needs-you" size="small" />
        <div className="av-capsule-notice-text">
          <p className="av-capsule-notice-title">{title}</p>
          {children && <div className="av-capsule-notice-body">{children}</div>}
          {actions && <div className="av-capsule-notice-actions">{actions}</div>}
        </div>
      </div>
    </Hud>
  );
}
