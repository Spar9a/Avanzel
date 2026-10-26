// Which folders are the six shelves, for the windows that show a page's shelf as a chip.
import { SHELVES, type Shelf } from "@avanzel/ui";

/** Whether a page's folder is one of the six shelves, which a ShelfTag can show. */
export const isShelf = (shelf: string): shelf is Shelf => (SHELVES as readonly string[]).includes(shelf);
