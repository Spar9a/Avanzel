import type { CSSProperties, ReactNode } from "react";
import { Button } from "./Button.tsx";
import { Stamp, type StampProps } from "./Stamp.tsx";
import "../foundations.css";
import "./card.css";

export interface CardProps {
  /** The small line above the red rule, on the left: "Thought", "Ideas", "Question". */
  label?: string;
  /** The small line on the right: a short line, such as a time, a date or "of about 15". A line too long for the head is cut with an ellipsis. */
  meta?: string;
  /**
   * What the work on the card is doing now, as a chip on the right of the head with a pulsing dot, in place of `meta`: "Filing · 4 s
   * of about 15". It is a live region, so VoiceOver hears it change.
   */
  status?: string;
  /** How far the work is, 0 to 1, as a thin violet line under the head; leave it out when there is no such work. */
  progress?: number;
  /** small: the capsule and setup, 21 px lines. regular: reading, 26 px lines. */
  size?: "small" | "regular";
  /** Blue ruling under the words. Turn it off only for cards that hold no words. */
  ruled?: boolean;
  /** Shown in italic while the card is still empty: "Say anything…". */
  placeholder?: string;
  /** The stamp in the top corner once the work is done. */
  stamp?: StampProps;
  /** Below the ruled area, on plain paper: a line of what is going on, chips or a receipt. */
  footer?: ReactNode;
  /** Buttons at the foot's right, the primary last: what can be done with the card's work now. */
  actions?: ReactNode;
  /** A close button in the card's top corner, named by `closeLabel`: the card goes, and the work goes on or stays done. */
  onClose?: () => void;
  closeLabel?: string;
  /** The user's own words. Plain text or paragraphs; they are set in the words face. */
  children?: ReactNode;
}

/** The index card: the unit of a thought. Red header rule, blue ruling, the user's words in a reading
    serif. Everything inside takes the paper's inks. The capsule's cards also carry what the work on them is doing, its
    actions and a close button, all on the card. */
export function Card({ label, meta, status, progress, size = "small", ruled = true, placeholder, stamp, footer, actions, onClose, closeLabel = "Hide", children }: CardProps) {
  const empty = children === undefined || children === null || children === "";
  const done = progress === undefined ? undefined : Math.min(1, Math.max(0, progress));
  return (
    <article
      className="av-card"
      data-size={size}
      data-ruled={ruled ? "" : undefined}
      data-stamped={stamp ? "" : undefined}
      data-closable={onClose ? "" : undefined}
    >
      <header className="av-card-head">
        <span>{label}</span>
        {status ? (
          <span className="av-card-status" role="status">
            <i className="av-card-status-dot" aria-hidden="true" />
            {status}
          </span>
        ) : (
          meta && <span>{meta}</span>
        )}
      </header>
      {done !== undefined && (
        <span className="av-card-progress" aria-hidden="true">
          <i style={{ "--_done": `${(done * 100).toFixed(1)}%` } as CSSProperties} />
        </span>
      )}
      <div className="av-card-lines">
        {empty && placeholder ? <p className="av-card-placeholder">{placeholder}</p> : typeof children === "string" ? <p>{children}</p> : children}
      </div>
      {stamp && <span className="av-card-stamp"><Stamp size="small" {...stamp} /></span>}
      {(footer || actions) && (
        <footer className="av-card-foot" data-actions={actions ? "" : undefined}>
          {footer && <div className="av-card-foot-words">{footer}</div>}
          {actions && <div className="av-card-actions">{actions}</div>}
        </footer>
      )}
      {onClose && (
        <span className="av-card-close">
          <Button size="small" variant="quiet" icon="close" label={closeLabel} onClick={onClose} />
        </span>
      )}
    </article>
  );
}
