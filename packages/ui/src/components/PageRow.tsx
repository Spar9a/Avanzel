import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { disintegrate } from "./dust.ts";
import { useFileDrop } from "./file-drop.ts";
import { ShelfTag, type AnyShelf } from "./Shelf.tsx";
import "../foundations.css";
import "./pagerow.css";

/** How far the grains may drift past the row's edges. */
const DUST_PAD = 32;

export interface PageRowProps {
  /** The page's title, as its front matter or its first heading gives it. */
  title: string;
  /** The shelf the page is on, built-in or the owner's own, shown with its colour, glyph and name. Leave it out for a page on no shelf. */
  shelf?: AnyShelf;
  /** The page's status from its front matter, such as "open" or "done": a word after a dot, beside the shelf, never a pill. */
  status?: string;
  /** The page's tags, in a quiet line under it. */
  tags?: readonly string[];
  /** When the page was made or changed, already worded: "6 Nov", "Today". */
  date: string;
  /** What the page is about, in a sentence or two (its words, with links such as `FileLink` in them): shown only when the row is open. */
  summary?: ReactNode;
  /** Open: the row shows its summary and details (`children`), and its border turns violet. */
  expanded: boolean;
  onToggle: () => void;
  /** Small buttons beside the title, such as the ways to open the page ("Open as Markdown", "Open in Obsidian"). */
  actions?: ReactNode;
  /** The row's place in its list, from 0: the rows come in one after another as the list first shows. */
  order?: number;
  /** What the open row shows under the summary: the page's sections. */
  children?: ReactNode;
  /** What the open row shows first, over the summary: the ways to add to the page ("Add more"). */
  lead?: ReactNode;
  /**
   * Given, files can be dropped on the row: while one is dragged over it the row turns violet and says `dropLabel` ("Drop to add to
   * this page"), and the files dropped are handed over.
   */
  onDropFiles?: (files: File[]) => void;
  dropLabel?: string;
  /**
   * The page is being taken away: the row turns to dust from the left, as a deleted message does in Telegram, then closes up, and
   * `onRemoved` is called, for the list to let it go. With Reduce Motion it only fades.
   */
  removing?: boolean;
  onRemoved?: () => void;
}

/**
 * A page of the library in a list: its title, status, shelf, tags and date, with buttons beside the title. A click folds the
 * row open in place to show what the page is about and its sections.
 */
export function PageRow({ title, shelf, status, tags, date, summary, expanded, onToggle, actions, order, children, lead, onDropFiles, dropLabel = "Drop to add to this note", removing = false, onRemoved }: PageRowProps) {
  const id = useId();
  // Taken away: the row turns to dust over a canvas around it, then closes up (`data-gone`), then the list is told.
  const rowRef = useRef<HTMLElement>(null);
  const dustRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"here" | "dust" | "gone">("here");
  const removed = useRef(onRemoved);
  removed.current = onRemoved;
  // Run once as `removing` turns on: the phase it sets doesn't run it again, which would stop the dust it has just begun.
  useLayoutEffect(() => {
    if (!removing) return;
    const row = rowRef.current;
    const canvas = dustRef.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!row || !canvas || still) {
      setPhase("gone");
      return;
    }
    // The row's height is fixed now, so that closing up can run from it to nothing.
    row.style.setProperty("--_height", `${row.getBoundingClientRect().height}px`);
    const look = getComputedStyle(row);
    const colors = [look.color, look.color, look.backgroundColor, look.getPropertyValue("--av-accent-fill").trim() || look.color, look.getPropertyValue("--av-ink-secondary").trim() || look.color];
    setPhase("dust");
    return disintegrate(row, canvas, colors, DUST_PAD, () => setPhase("gone"));
  }, [removing]);
  // A file dragged over the row turns it violet, and a drop hands the files over (`useFileDrop`).
  const drop = useFileDrop(onDropFiles);
  const details = `${id}-details`;
  // The buttons sit in the top corner over the head: only the title's line keeps clear of them (by their width, measured), so the line
  // under it, with the date, runs the row's whole width.
  const actionsRef = useRef<HTMLSpanElement>(null);
  const [actionsWidth, setActionsWidth] = useState(0);
  useLayoutEffect(() => {
    const el = actionsRef.current;
    if (!el) return setActionsWidth(0);
    const measure = () => setActionsWidth(Math.ceil(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [actions]);
  const delay = {
    ...(order === undefined ? {} : { "--_order": Math.min(order, 12) }),
    "--_actions": `${actionsWidth}px`,
  } as CSSProperties;
  // VoiceOver names the row by its title and reads the rest as its description, rather than everything as one long name.
  return (
    <article
      ref={rowRef}
      className="av-page-row"
      data-expanded={expanded ? "" : undefined}
      data-dropping={drop.over ? "" : undefined}
      data-dust={phase === "dust" ? "" : undefined}
      data-gone={phase === "gone" ? "" : undefined}
      inert={removing}
      onAnimationEnd={(event) => {
        // Closed up: the list lets it go.
        if (event.target === event.currentTarget && event.animationName === "av-page-row-close") removed.current?.();
      }}
      style={delay}
      {...drop.handlers}
    >
      {removing && <canvas ref={dustRef} className="av-page-row-dust" aria-hidden="true" />}
      {onDropFiles && (
        <span className="av-page-row-drop" aria-hidden="true">
          <span className="av-page-row-drop-words">{dropLabel}</span>
        </span>
      )}
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
          </span>
          <span id={`${id}-meta`} className="av-page-row-meta">
            {shelf && <ShelfTag shelf={shelf} />}
            {/* The status is a word about the page, not something to press: plain text after a dot, never a pill like a button. */}
            {status && (
              <span id={`${id}-status`} className="av-page-row-status">
                <i aria-hidden="true" />
                {status}
              </span>
            )}
            {tags && tags.length > 0 && <span className="av-page-row-tags">{tags.join(" · ")}</span>}
            <span className="av-page-row-date">{date}</span>
          </span>
        </button>
        {actions && <span ref={actionsRef} className="av-page-row-actions">{actions}</span>}
      </div>
      <div id={details} className="av-page-row-details" inert={!expanded}>
        <div className="av-page-row-fold">
          <div className="av-page-row-inner">
            {lead && <div className="av-page-row-lead">{lead}</div>}
            {summary && <p className="av-page-row-summary">{summary}</p>}
            {children}
          </div>
        </div>
      </div>
    </article>
  );
}
