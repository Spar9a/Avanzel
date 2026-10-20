import type { ReactNode } from "react";
import { Stamp, type StampProps } from "./Stamp.tsx";
import "../foundations.css";
import "./card.css";

export interface CardProps {
  /** The small line above the red rule, on the left: "Thought", "Ideas", "Question". */
  label?: string;
  /** The small line on the right: a time, a date, "of about 15". */
  meta?: string;
  /** small: the capsule and setup, 21 px lines. regular: reading, 26 px lines. */
  size?: "small" | "regular";
  /** Blue ruling under the words. Turn it off only for cards that hold no words. */
  ruled?: boolean;
  /** Shown in italic while the card is still empty: "Say anything…". */
  placeholder?: string;
  /** The stamp in the top corner once the work is done. */
  stamp?: StampProps;
  /** Below the ruled area, on plain paper: chips, a receipt or buttons. */
  footer?: ReactNode;
  /** The user's own words. Plain text or paragraphs; they are set in the words face. */
  children?: ReactNode;
}

/** The index card: the unit of a thought. Red header rule, blue ruling, the user's words in a reading
    serif. Everything inside takes the paper's inks. */
export function Card({ label, meta, size = "small", ruled = true, placeholder, stamp, footer, children }: CardProps) {
  const empty = children === undefined || children === null || children === "";
  return (
    <article className="av-card" data-size={size} data-ruled={ruled ? "" : undefined} data-stamped={stamp ? "" : undefined}>
      <header className="av-card-head">
        <span>{label}</span>
        {meta && <span>{meta}</span>}
      </header>
      <div className="av-card-lines">
        {empty && placeholder ? <p className="av-card-placeholder">{placeholder}</p> : typeof children === "string" ? <p>{children}</p> : children}
      </div>
      {stamp && <span className="av-card-stamp"><Stamp size="small" {...stamp} /></span>}
      {footer && <footer className="av-card-foot">{footer}</footer>}
    </article>
  );
}
