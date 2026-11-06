// The panel's words that are made from values: a page's date, a review's next run and how its last one ended, and the day's line.
import { SHELF_NAMES, SHELVES, type Shelf } from "@avanzel/ui";
import type { PanelPage, PanelReview } from "../../shared/ipc.ts";

const MONTH_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** A page's day, YYYY-MM-DD: "Today", "Yesterday", "6 Nov", or "6 Nov 2025" for another year. */
export function pageDay(day: string | null, now = new Date()): string {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  const date = new Date(y, m - 1, d);
  if (day === localDay(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === localDay(yesterday)) return "Yesterday";
  return (y === now.getFullYear() ? MONTH_DAY : MONTH_DAY_YEAR).format(date);
}

/** When, from an ISO time: "today at 21:00", "tomorrow at 21:00", "Sun at 18:00", "12 Nov at 18:00". */
export function when(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = TIME.format(date);
  const day = localDay(date);
  if (day === localDay(now)) return `today at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (day === localDay(tomorrow)) return `tomorrow at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === localDay(yesterday)) return `yesterday at ${time}`;
  const days = (date.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 6) return `${WEEKDAY.format(date)} at ${time}`;
  return `${MONTH_DAY.format(date)} at ${time}`;
}

/** What a review's line says of its next run: "Running…" or how far it is, "Next today at 21:00", or "Off". */
export function reviewState(review: PanelReview, now = new Date()): string {
  if (review.running) return review.progress ?? "Running…";
  if (!review.enabled) return "Off";
  return review.next ? `Next ${when(review.next, now)}` : "On";
}

/** How a review's last run ended, from its notification, with when: "Last today at 06:10: Nothing to file." */
export function reviewOutcome(review: PanelReview, now = new Date()): string | null {
  const outcome = review.outcome;
  if (outcome) {
    const told = outcome.title === review.name ? outcome.body : `${outcome.title.replace(`${review.name}: `, "")}. ${outcome.body}`;
    return `Last ${when(outcome.at, now)}: ${told}`;
  }
  return review.lastRun ? `Last ran ${when(review.lastRun, now)}.` : null;
}

/** The inbox's line on Capture, under the head that counts the day: "2 notes wait in the inbox." */
export function inboxLine(inbox: number): string {
  if (inbox === 0) return "The inbox is empty.";
  return `${inbox} ${inbox === 1 ? "note waits" : "notes wait"} in the inbox.`;
}

export const pagesLabel = (count: number) => `${count} ${count === 1 ? "page" : "pages"}`;

/** The orders Library can list its pages in. */
export const SORTS = ["changed", "made", "title", "shelf"] as const;
export type PageSort = (typeof SORTS)[number];

const SORT_LABELS: Record<PageSort, string> = {
  changed: "Newest change",
  made: "Newest made",
  title: "Title",
  shelf: "Shelf",
};
export const sortLabel = (sort: PageSort) => SORT_LABELS[sort];

/** What Library shows: every page, a shelf's, or those of one status. */
export type PageFilter = { kind: "all" } | { kind: "shelf"; shelf: Shelf } | { kind: "status"; status: string };

/** A filter's name on its button: "Ideas", "Status: open". */
export function filterLabel(filter: PageFilter): string {
  if (filter.kind === "shelf") return SHELF_NAMES[filter.shelf];
  if (filter.kind === "status") return `Status: ${filter.status}`;
  return "All pages";
}

const SHELF_ORDER: readonly string[] = SHELVES;

/** `pages` in the order `sort` names; ties keep the newest change first. A new list, the given one is left as it was. */
export function sortPages(pages: readonly PanelPage[], sort: PageSort): PanelPage[] {
  const newest = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");
  const byChange = (a: PanelPage, b: PanelPage) => newest(a.updated ?? a.created, b.updated ?? b.created);
  const list = [...pages];
  if (sort === "changed") return list.sort(byChange);
  if (sort === "made") return list.sort((a, b) => newest(a.created, b.created) || byChange(a, b));
  if (sort === "title") return list.sort((a, b) => a.title.localeCompare(b.title) || byChange(a, b));
  const rank = (p: PanelPage) => (p.shelf === null ? SHELF_ORDER.length : SHELF_ORDER.indexOf(p.shelf));
  return list.sort((a, b) => rank(a) - rank(b) || byChange(a, b));
}
