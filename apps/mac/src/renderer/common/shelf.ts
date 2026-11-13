// Which folders are the six shelves, for the windows that show a page's shelf as a chip, and how any other shelf a page is on is shown.
import { SHELVES, type AnyShelf, type Shelf } from "@avanzel/ui";

/** Whether a page's folder is one of the six shelves, which a ShelfTag can show. */
export const isShelf = (shelf: string): shelf is Shelf => (SHELVES as readonly string[]).includes(shelf);

/**
 * The shelf a page is on (`PanelPage.shelf`, a folder) as the shelf parts take it (`AnyShelf`): one of the six as it is; an own shelf by
 * the name the owner gave it in `own` (the library's own shelves); meetings, which is built in but none of the six, in the own look as
 * "Meetings"; and a folder `own` doesn't know (the list not read yet, or the shelf gone meanwhile) by its folder. None for no shelf.
 */
export function anyShelfOf(folder: string | null, own: readonly { folder: string; name: string }[]): AnyShelf | undefined {
  if (!folder) return undefined;
  if (isShelf(folder)) return folder;
  if (folder === "meetings") return { own: folder, name: "Meetings" };
  return { own: folder, name: own.find((shelf) => shelf.folder === folder)?.name ?? folder };
}
