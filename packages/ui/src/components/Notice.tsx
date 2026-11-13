import { useId, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import "../foundations.css";
import "./notice.css";

export interface NoticeProps {
  /** error: something failed and one fix is offered. info: worth knowing. success: done, with proof. */
  tone?: "info" | "error" | "success";
  /** One sentence on what happened, in plain words: "Claude Code isn't signed in on this Mac." */
  title: string;
  /** One sentence on what is safe and what happens next: "Your note is safe in the inbox." */
  children?: ReactNode;
  /** One <Actions> row with the button that fixes it. */
  actions?: ReactNode;
}

/**
 * A message inside a window. In the capsule, use a Hud card with Zel instead. Its actions are a group named by its title, so two notices
 * with the same buttons are told apart ("Make shelf, Make a shelf called Projects?, group").
 */
export function Notice({ tone = "info", title, children, actions }: NoticeProps) {
  const titleId = useId();
  return (
    <div className="av-notice" data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      <span className="av-notice-icon"><Icon name={tone === "error" ? "warning" : tone === "success" ? "check" : "info"} /></span>
      <div className="av-notice-text">
        <p className="av-notice-title" id={titleId}>{title}</p>
        {children && <div className="av-notice-body">{children}</div>}
        {actions && <div className="av-notice-actions" role="group" aria-labelledby={titleId}>{actions}</div>}
      </div>
    </div>
  );
}
