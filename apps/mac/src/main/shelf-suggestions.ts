// The shelves the librarian has suggested that the owner hasn't answered yet, kept for each library on this Mac so that they outlast a
// quit. Like the undo records (undo-records.ts) they are about this Mac, not the library: they live in the app's own data folder
// (userData/shelf-suggestions.json), keyed by the library's resolved path, and never show up in the library's history. Each page a
// suggestion would move remembers the capture it came from, so that deleting the capture takes its pages off the suggestion too.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sameShelf, type ShelfSuggestion } from "@avanzel/engine";
import { writeJsonAtomic } from "./store.ts";

/** A suggested shelf that waits for the owner: make it, or turn it down. */
export interface PendingShelf {
  folder: string;
  name: string;
  /** What belongs on it. Empty for a folder the agent made on its own: the owner writes it. */
  definition: string;
  agentMade: boolean;
  /** The pages that would move onto the shelf, each with the capture that made it. */
  pages: { path: string; captureId: string }[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A pending shelf from whatever was read, or null when it isn't whole: pages that aren't a path and a capture are dropped. */
export function normalizePending(raw: unknown): PendingShelf | null {
  if (!isObject(raw) || typeof raw.folder !== "string" || typeof raw.name !== "string") return null;
  const definition = typeof raw.definition === "string" ? raw.definition : "";
  const pages = Array.isArray(raw.pages)
    ? raw.pages.flatMap((page): { path: string; captureId: string }[] =>
        isObject(page) && typeof page.path === "string" && typeof page.captureId === "string"
          ? [{ path: page.path, captureId: page.captureId }]
          : [],
      )
    : [];
  return { folder: raw.folder, name: raw.name, definition, agentMade: definition === "", pages };
}

/** Whether the suggestion `shelf` is the same shelf (`sameShelf`, on folders or names) as one of `own`, the owner's: it is answered. */
export function answeredBy(shelf: Pick<PendingShelf, "folder" | "name">, own: readonly { folder: string; name: string }[]): boolean {
  return own.some((mine) => [mine.folder, mine.name].some((theirs) => sameShelf(theirs, shelf.folder) || sameShelf(theirs, shelf.name)));
}

export class ShelfSuggestions {
  constructor(private readonly file: string) {}

  /** The suggestions waiting in `library`, oldest first: none when the file has nothing for it, is missing, or is corrupt. */
  list(library: string): PendingShelf[] {
    return this.of(this.load(), library);
  }

  /**
   * Keeps `suggestion`, made by `captureId`. One that is the same shelf as a pending one (`sameShelf` on folders or on names) joins it:
   * the pending folder and name stay, the definition is the pending one or else the incoming one, and the pages are added, each path once.
   * Returns the entry as kept. Throws when the file can't be written.
   */
  add(library: string, suggestion: ShelfSuggestion, captureId: string): PendingShelf {
    const all = this.load();
    const pending = this.of(all, library);
    const incoming = suggestion.pages.map((page) => ({ path: page, captureId }));
    const index = pending.findIndex(
      (other) => sameShelf(other.folder, suggestion.folder) || sameShelf(other.name, suggestion.name),
    );
    const found = index === -1 ? undefined : pending[index];
    let kept: PendingShelf;
    if (found) {
      const pages = [...found.pages];
      for (const page of incoming) if (!pages.some((have) => have.path === page.path)) pages.push(page);
      const definition = found.definition || suggestion.definition;
      kept = { folder: found.folder, name: found.name, definition, agentMade: definition === "", pages };
      pending[index] = kept;
    } else {
      const pages = incoming.filter((page, at) => incoming.findIndex((other) => other.path === page.path) === at);
      kept = {
        folder: suggestion.folder,
        name: suggestion.name,
        definition: suggestion.definition,
        agentMade: suggestion.definition === "",
        pages,
      };
      pending.push(kept);
    }
    this.save(all, library, pending);
    return structuredClone(kept);
  }

  /** Takes the suggestion for `folder` out and returns it, or returns null when there is none. Throws when the file can't be written. */
  remove(library: string, folder: string): PendingShelf | null {
    const all = this.load();
    const pending = this.of(all, library);
    const index = pending.findIndex((other) => other.folder === folder);
    if (index === -1) return null;
    const [removed] = pending.splice(index, 1);
    this.save(all, library, pending);
    return removed ?? null;
  }

  /**
   * Drops, as answered, each suggestion that is now the same shelf (`sameShelf`, on folders or names) as one of `own`, the owner's shelves:
   * one added in Settings, or by hand in config.toml, after it was suggested. It could be neither made nor turned down any more. The
   * suggestions for the folders in `keep` stay all the same (a Make shelf of theirs is going, and takes them out itself). Returns the
   * suggestions left. Writes only when one goes, and throws when the file can't be written.
   */
  dropAnswered(library: string, own: readonly { folder: string; name: string }[], keep: readonly string[] = []): PendingShelf[] {
    const all = this.load();
    const before = this.of(all, library);
    const after = before.filter((shelf) => keep.includes(shelf.folder) || !answeredBy(shelf, own));
    if (after.length !== before.length) this.save(all, library, after);
    return after;
  }

  /** Takes `captureId`'s pages off every suggestion, and drops a suggestion left with none. Throws when the file can't be written. */
  forgetCapture(library: string, captureId: string): void {
    const all = this.load();
    const before = this.of(all, library);
    const after = before
      .map((shelf) => ({ ...shelf, pages: shelf.pages.filter((page) => page.captureId !== captureId) }))
      .filter((shelf) => shelf.pages.length > 0);
    const changed =
      after.length !== before.length || after.some((shelf, at) => shelf.pages.length !== before[at]?.pages.length);
    if (changed) this.save(all, library, after);
  }

  /** Puts back a suggestion `remove` took out, in place of any for the same folder. Throws when the file can't be written. */
  restore(library: string, shelf: PendingShelf): void {
    const all = this.load();
    const pending = this.of(all, library);
    const back = normalizePending(shelf);
    if (!back) return;
    const index = pending.findIndex((other) => other.folder === back.folder);
    if (index === -1) pending.push(back);
    else pending[index] = back;
    this.save(all, library, pending);
  }

  private of(all: Record<string, unknown>, library: string): PendingShelf[] {
    const raw = all[path.resolve(library)];
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item): PendingShelf[] => {
      const shelf = normalizePending(item);
      return shelf ? [shelf] : [];
    });
  }

  private load(): Record<string, unknown> {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      return isObject(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  private save(all: Record<string, unknown>, library: string, pending: PendingShelf[]): void {
    const key = path.resolve(library);
    const next = { ...all };
    if (pending.length === 0) delete next[key];
    else next[key] = pending;
    writeJsonAtomic(this.file, next);
  }
}
