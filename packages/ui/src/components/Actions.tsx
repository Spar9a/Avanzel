import { Children, isValidElement, type ReactNode } from "react";
import "../foundations.css";
import "./button.css";
import "./actions.css";

export interface ActionsProps {
  /** end: dialogs and cards, primary last. start: inside text. stretch: a narrow sheet, equal widths. */
  align?: "end" | "start" | "between" | "stretch";
  children: ReactNode;
}

/** A row of buttons. As on macOS the primary one comes last, and there is at most one. */
export function Actions({ align = "end", children }: ActionsProps) {
  const primaries = Children.toArray(children).filter((child) => isValidElement<{ variant?: string }>(child) && child.props.variant === "primary").length;
  if (primaries > 1) console.error(`Actions: ${primaries} primary buttons in one row; keep one (packages/ui/DESIGN.md, "Buttons").`);
  return <div className="av-actions" data-align={align}>{children}</div>;
}
