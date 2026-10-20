import type { ReactNode } from "react";
import "../foundations.css";
import "./bubble.css";

export interface BubbleProps {
  /** What Zel says first, in its voice: "This agent wants to run a command." */
  title?: string;
  /** The rest, in one or two short sentences. Zel may say "I" here. */
  children?: ReactNode;
  /** One <Actions> row: the answer, and a way out. */
  actions?: ReactNode;
  /** The side the tail points to, where Zel is. */
  tail?: "top-end" | "top-start" | "bottom-start" | "none";
}

/** Zel's speech bubble. Only Zel speaks in bubbles, and only when asked or when something needs the
    person, such as a permission request. It never covers the user's words. */
export function Bubble({ title, children, actions, tail = "top-end" }: BubbleProps) {
  return (
    <div className="av-bubble" data-tail={tail}>
      {title && <p className="av-bubble-title">{title}</p>}
      {children && <div className="av-bubble-body">{children}</div>}
      {actions && <div className="av-bubble-actions">{actions}</div>}
    </div>
  );
}
