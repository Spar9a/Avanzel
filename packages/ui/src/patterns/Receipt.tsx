import { ShelfMark, shelfName, type AnyShelf } from "../components/Shelf.tsx";
import "../foundations.css";
import "./receipt.css";

export interface ReceiptPage {
  title: string;
  /** A built-in shelf, or one the owner made, which shows its own name with the own-shelf mark. */
  shelf: AnyShelf;
}

/** What a filing changed: every page, with its shelf. It is the proof that goes with Undo. */
export function Receipt({ pages }: { pages: readonly ReceiptPage[] }) {
  return (
    <ul className="av-receipt">
      {pages.map((page, i) => (
        <li key={`${typeof page.shelf === "string" ? page.shelf : `own:${page.shelf.own}`}:${page.title}:${i}`}>
          <ShelfMark shelf={page.shelf} />
          <span className="av-receipt-title">{page.title}</span>
          <span className="av-receipt-shelf">{shelfName(page.shelf)}</span>
        </li>
      ))}
    </ul>
  );
}
