import { useId, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import "../foundations.css";
import "./disclosure.css";

export interface DisclosureProps {
  /** Its heading, which opens and folds it: "Log". */
  label: string;
  /** How many things are in it, beside its heading while it is folded: "4". */
  count?: number;
  /** Open at first; folded by default. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A part of a page that folds away, as its Log: a quiet heading with a chevron (and how many it holds) that opens it in place, and
 * folds it again. Folded by default.
 */
export function Disclosure({ label, count, defaultOpen = false, children }: DisclosureProps) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="av-disclosure" data-open={open ? "" : undefined}>
      <button type="button" className="av-disclosure-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="av-disclosure-chevron"><Icon name="chevron" size={12} /></span>
        <span className="av-disclosure-label">{label}</span>
        {count !== undefined && <span className="av-disclosure-count">{count}</span>}
      </button>
      <div id={id} className="av-disclosure-fold" inert={!open}>
        <div className="av-disclosure-clip">
          <div className="av-disclosure-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
