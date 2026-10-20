import type { CSSProperties, ReactNode } from "react";
import type { Space } from "../generated/tokens.ts";
import "../foundations.css";
import "./layout.css";

type Align = "start" | "center" | "end" | "stretch" | "baseline";
type Justify = "start" | "center" | "end" | "between";

const gap = (space: Space) => ({ "--_gap": `var(--av-space-${space})` }) as CSSProperties;

export interface StackProps {
  /** Pixels between children, from the spacing scale. */
  gap?: Space;
  align?: Align;
  children: ReactNode;
}

/** Children in a column. */
export function Stack({ gap: space = 8, align = "stretch", children }: StackProps) {
  return <div className="av-stack" data-align={align} style={gap(space)}>{children}</div>;
}

export interface RowProps {
  gap?: Space;
  align?: Align;
  justify?: Justify;
  /** Let children flow onto more lines when they don't fit. */
  wrap?: boolean;
  children: ReactNode;
}

/** Children in a line. */
export function Row({ gap: space = 8, align = "center", justify = "start", wrap, children }: RowProps) {
  return <div className="av-row" data-align={align} data-justify={justify} data-wrap={wrap ? "" : undefined} style={gap(space)}>{children}</div>;
}

/** Takes the free space in a Row, pushing what follows to the far end. */
export function Spacer() {
  return <span className="av-spacer" aria-hidden="true" />;
}
