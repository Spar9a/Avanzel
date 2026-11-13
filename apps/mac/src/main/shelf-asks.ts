// The shelf questions as the windows see them (`ShelfAsk`, `ShelfOp`), read from whatever a page or a file sent, and the shelves as
// Settings lists them. Pure: the controller does the asking and the making (`Controller.makeShelf`, `changeShelves`).
import { BUILT_IN_SHELVES, type OwnShelf } from "@avanzel/engine";
import type { LibraryInfo, ShelfAsk, ShelfOp } from "../shared/ipc.ts";
import { undoRefused, type Problem } from "../shared/problems.ts";
import { shelfUndoneNote } from "../shared/shelves.ts";
import type { PendingShelf } from "./shelf-suggestions.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A pending suggestion as the windows ask about it: without its pages. */
export function askOf(shelf: Pick<PendingShelf, "folder" | "name" | "definition" | "agentMade">): ShelfAsk {
  return { folder: shelf.folder, name: shelf.name, definition: shelf.definition, agentMade: shelf.agentMade };
}

/** A suggestion from whatever was read or sent: its four fields of the right types, in one order, or null. Anything else about it goes. */
export function parseShelfAsk(raw: unknown): ShelfAsk | null {
  if (!isObject(raw)) return null;
  const { folder, name, definition, agentMade } = raw;
  if (typeof folder !== "string" || typeof name !== "string" || typeof definition !== "string" || typeof agentMade !== "boolean") return null;
  return { folder, name, definition, agentMade };
}

const isString = (value: unknown): value is string => typeof value === "string";

/**
 * What Settings sent as a shelf operation, or null when it isn't one: its `op`, and fields of the right types (optional ones absent or
 * strings). Whether the folder, name and definition keep the shelf rules is the engine's to say, in its own words.
 */
export function parseShelfOp(raw: unknown): ShelfOp | null {
  if (!isObject(raw)) return null;
  if (raw.op === "make") {
    const shelf = raw.shelf;
    if (!isObject(shelf) || !isString(shelf.folder) || !isString(shelf.name) || !isString(shelf.definition)) return null;
    if (raw.fromSuggestion !== undefined && !isString(raw.fromSuggestion)) return null;
    return {
      op: "make",
      shelf: { folder: shelf.folder, name: shelf.name, definition: shelf.definition },
      ...(raw.fromSuggestion !== undefined ? { fromSuggestion: raw.fromSuggestion } : {}),
    };
  }
  if (raw.op === "edit") {
    if (!isString(raw.folder)) return null;
    if ((raw.name !== undefined && !isString(raw.name)) || (raw.definition !== undefined && !isString(raw.definition))) return null;
    return {
      op: "edit",
      folder: raw.folder,
      ...(raw.name !== undefined ? { name: raw.name } : {}),
      ...(raw.definition !== undefined ? { definition: raw.definition } : {}),
    };
  }
  if (raw.op === "remove") return isString(raw.folder) ? { op: "remove", folder: raw.folder } : null;
  return null;
}

/**
 * The shelves Settings lists as the owner's (`LibraryInfo.ownShelves`): each own shelf in its saved order with the pages its folder holds
 * (`counts`, the vault's `shelfCounts`), then each other top-level folder that isn't one of Avanzel's own shelves, as it is named on disk
 * and with no definition: one made by hand, which Add definition makes a shelf.
 */
export function ownShelvesInfo(shelves: readonly OwnShelf[], counts: Readonly<Record<string, number>>): LibraryInfo["ownShelves"] {
  const own = shelves.map((shelf) => ({ folder: shelf.folder, name: shelf.name, definition: shelf.definition, pages: counts[shelf.folder] ?? 0 }));
  const handMade = Object.entries(counts)
    .filter(([folder]) => !BUILT_IN_SHELVES.includes(folder) && !shelves.some((shelf) => shelf.folder === folder))
    .map(([folder, pages]) => ({ folder, name: folder, definition: "", pages }));
  return [...own, ...handMade];
}

/**
 * What an Undo of a Make shelf tells, by notification (no filed card is of it): a refusal is told as any refused Undo (`undoRefused`);
 * otherwise the shelf is gone, and Library asks about its suggestion again only when `restored`: the suggestion is pending again for sure.
 */
export function shelfUndoNotice(undone: boolean, name: string, restored: boolean): Problem {
  return undone ? { title: "Undone", body: shelfUndoneNote(name, restored) } : undoRefused;
}
