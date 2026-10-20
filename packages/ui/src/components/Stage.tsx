import type { ReactNode } from "react";
import "../foundations.css";
import "./stage.css";

/** A tinted area inside a window where Zel and the cards perform, as in setup. One per window. */
export function Stage({ children }: { children: ReactNode }) {
  return <div className="av-stage">{children}</div>;
}
