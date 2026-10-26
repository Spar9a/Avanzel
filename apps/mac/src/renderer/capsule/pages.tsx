// The pages a filing wrote, as the filed card's footer lists them (owner item 3: a clickable chip that says new or updated is a stand-in).
import { Button, ShelfTag, Stack, Text } from "@avanzel/ui";
import type { FiledPage } from "../../shared/ipc.ts";
import { isShelf } from "../setup/copy.ts";
import { api } from "./api.ts";
import { moreLine, pageCaption, shortTitle, SHOWN_PAGES } from "./copy.ts";

/**
 * A row for each of the first three pages (new pages come first), in columns that line up from row to row: the shelf's chip when the
 * page is on one of the six shelves, else the name of the folder it is in; the page's title as a link that opens it; and whether the
 * filing made the page or changed it. What the three don't list is counted under them. A link never wraps its words, so a long title
 * is shortened (`shortTitle`) rather than run out of its column.
 */
export function Pages({ pages }: { pages: readonly FiledPage[] }) {
  const shown = pages.slice(0, SHOWN_PAGES);
  const hidden = pages.length - shown.length;
  return (
    <Stack gap={6}>
      <div className="page-list" role="list">
        {shown.map((page) => (
          <div key={page.path} className="page" role="listitem">
            {isShelf(page.shelf) ? <ShelfTag shelf={page.shelf} /> : <Text variant="caption" tone="secondary" truncate>{page.shelf}</Text>}
            <div className="page-title">
              <Button variant="link" onClick={() => api.openPage(page.path)}>{shortTitle(page.title)}</Button>
            </div>
            <Text variant="caption" tone="secondary">{pageCaption(page)}</Text>
          </div>
        ))}
      </div>
      {hidden > 0 && <Text variant="caption" tone="secondary">{moreLine(hidden)}</Text>}
    </Stack>
  );
}
