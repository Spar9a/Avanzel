import { useId, type CSSProperties, type ReactNode } from "react";
import type { Shelf } from "../generated/tokens.ts";
import { Badge } from "./Badge.tsx";
import { ShelfTag } from "./Shelf.tsx";
import "../foundations.css";
import "./pagerow.css";

export interface PageRowProps {
  /** The page's title, as its front matter or its first heading gives it. */
  title: string;
  /** The shelf the page is on, shown with its colour, glyph and name. Leave it out for a page on no shelf. */
  shelf?: Shelf;
  /** The page's status from its front matter, such as "open" or "done", as a badge beside the title. */
  status?: string;
  /** The page's tags, in a quiet line under it. */
  tags?: readonly string[];
  /** When the page was made or changed, already worded: "6 Nov", "Today". */
  date: string;
  /** What the page is about, in a sentence or two: shown only when the row is open, above its details. */
  summary?: string;
  /** Open: the row shows its summary and details (`children`), and its border turns violet. */
  expanded: boolean;
  onToggle: () => void;
  /** Small buttons beside the title, such as the ways to open the page ("Open as Markdown", "Open in Obsidian"). */
  actions?: ReactNode;
  /** The row's place in its list, from 0: the rows come in one after another as the list first shows. */
  order?: number;
  /** What the open row shows under the summary: the page's sections. */
  children?: ReactNode;
}

/**
 * A page of the library in a list: its title, status, shelf, tags and date, with buttons beside the title. A click folds the
 * row open in place to show what the page is about and its sections.
 */
export function PageRow({ title, shelf, status, tags, date, summary, expanded, onToggle, actions, order, children }: PageRowProps) {
  const id = useId();
  const details = `${id}-details`;
  const delay = order === undefined ? undefined : ({ "--_order": Math.min(order, 12) } as CSSProperties);
  // VoiceOver names the row by its title and reads the rest as its description, rather than everything as one long name.
  return (
    <article className="av-page-row" data-expanded={expanded ? "" : undefined} style={delay}>
      <div className="av-page-row-top">
        <button
          type="button"
          className="av-page-row-head"
          aria-expanded={expanded}
          aria-controls={details}
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-status ${id}-meta`}
          onClick={onToggle}
        >
          <span className="av-page-row-title">
            <span id={`${id}-title`} className="av-page-row-name">{title}</span>
            {status && <span id={`${id}-status`}><Badge tone="neutral">{status}</Badge></span>}
          </span>
          <span id={`${id}-meta`} className="av-page-row-meta">
            {shelf && <ShelfTag shelf={shelf} />}
            {tags && tags.length > 0 && <span className="av-page-row-tags">{tags.join(" · ")}</span>}
            <span className="av-page-row-date">{date}</span>
          </span>
        </button>
        {actions && <span className="av-page-row-actions">{actions}</span>}
      </div>
      <div id={details} className="av-page-row-details" inert={!expanded}>
        <div className="av-page-row-fold">
          <div className="av-page-row-inner">
            {summary && <p className="av-page-row-summary">{summary}</p>}
            {children}
          </div>
        </div>
      </div>
    </article>
  );
}
