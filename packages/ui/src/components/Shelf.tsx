import type { ReactElement } from "react";
import type { Shelf } from "../generated/tokens.ts";
import "../foundations.css";
import "./shelf.css";

export type { Shelf };

/**
 * One of the six shelves, or a shelf the owner made: its folder (`own`) and its name as the owner gave it. Every shelf the owner
 * makes shares one look, the own-shelf colour and glyph, and is told apart by its name.
 */
export type AnyShelf = Shelf | { own: string; name: string };

/** What `data-shelf` says, which picks the shelf's colour in shelf.css: a built-in shelf's key, or "own". */
export const shelfKey = (shelf: AnyShelf): Shelf | "own" => (typeof shelf === "string" ? shelf : "own");

/** How a shelf is named on screen: a built-in shelf's name, or the name the owner gave. */
export const shelfName = (shelf: AnyShelf): string => (typeof shelf === "string" ? SHELF_NAMES[shelf] : shelf.name);

/** How each shelf is named on screen. */
export const SHELF_NAMES: Record<Shelf, string> = {
  goals: "Goals",
  ideas: "Ideas",
  problems: "Problems",
  memories: "Memories",
  people: "People",
  topics: "Topics",
};

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** A flag, a spark, a knot, an hourglass, a figure and a tag, on a 12 px grid. Goals (green) and
    Problems (red) are the classic red–green pair, so colour never carries the meaning alone. */
const GLYPHS: Record<Shelf, ReactElement> = {
  goals: <path d="M3 11V1.5M3 1.5h6.2L7.8 4l1.4 2.5H3" {...stroke} strokeWidth={1.4} />,
  ideas: <path d="M6 .8 7.2 4.8 11.2 6 7.2 7.2 6 11.2 4.8 7.2.8 6 4.8 4.8Z" fill="currentColor" />,
  problems: <path d="M1.5 6c0-2.2 2.2-3.2 4.5-1.1S10.5 7 10.5 6M1.5 6c0 2.2 2.2 3.2 4.5 1.1S10.5 5 10.5 6" {...stroke} strokeWidth={1.4} />,
  memories: <path d="M3 1.2h6M3 10.8h6M3.6 1.2c0 3.2 4.8 2.8 4.8 4.8S3.6 7.6 3.6 10.8M8.4 1.2c0 3.2-4.8 2.8-4.8 4.8s4.8 1.6 4.8 4.8" {...stroke} strokeWidth={1.3} />,
  people: (
    <>
      <circle cx="6" cy="3.4" r="2.1" {...stroke} strokeWidth={1.4} />
      <path d="M1.8 11c0-2.9 1.9-4.4 4.2-4.4s4.2 1.5 4.2 4.4" {...stroke} strokeWidth={1.4} />
    </>
  ),
  topics: (
    <>
      <path d="M1.2 6V1.2H6L10.8 6 6 10.8Z" {...stroke} strokeWidth={1.3} />
      <circle cx="3.8" cy="3.8" r=".9" fill="currentColor" />
    </>
  ),
};

/** A plain folder with its tab, on the same grid: the one glyph every shelf the owner makes shares. */
const OWN_GLYPH: ReactElement = <path d="M1.2 10V2h3.4l1.4 1.6h4.8V10Z" {...stroke} strokeWidth={1.3} />;

/** The shelf's glyph alone. It is decoration: put it next to the shelf's visible name. */
export function ShelfGlyph({ shelf, size = 12 }: { shelf: AnyShelf; size?: 9 | 10 | 12 | 14 | 16 }) {
  return (
    <svg className="av-shelf-glyph" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      {typeof shelf === "string" ? GLYPHS[shelf] : OWN_GLYPH}
    </svg>
  );
}

export interface ShelfTagProps {
  /** A built-in shelf, or one the owner made (`{ own: "projects", name: "Projects" }`), which wears the own-shelf look. */
  shelf: AnyShelf;
  /** chip: inline, as in a receipt or under an answer. tab: a divider tab, as in the drawer. */
  variant?: "chip" | "tab";
  /** A count badge on a tab: how many pages. VoiceOver reads it as "1 note" or "3 notes". */
  count?: number;
  /** The count is how many pages the shelf holds, not how many just went in, so it shows at 0 too. */
  total?: boolean;
}

const pages = (count: number) => `${count} ${count === 1 ? "note" : "notes"}`;

/** A shelf with its colour, its glyph and its name, always all three. */
export function ShelfTag({ shelf, variant = "chip", count, total }: ShelfTagProps) {
  const counted = variant === "tab" && count !== undefined && (total || count > 0);
  return (
    <span className="av-shelf-tag" data-variant={variant} data-shelf={shelfKey(shelf)}>
      {/* At least 16 px, on a tab as on a chip: a sign that small is still read at a glance. */}
      <ShelfGlyph shelf={shelf} size={16} />
      <span className="av-shelf-name">{shelfName(shelf)}</span>
      {counted && <span className="av-shelf-count" aria-label={pages(count)}>{count}</span>}
    </span>
  );
}

/** A tiny divider tab with the shelf's glyph, for rows that already show the shelf's name. */
export function ShelfMark({ shelf }: { shelf: AnyShelf }) {
  return (
    <span className="av-shelf-mark" data-shelf={shelfKey(shelf)} aria-hidden="true">
      <ShelfGlyph shelf={shelf} size={9} />
    </span>
  );
}
