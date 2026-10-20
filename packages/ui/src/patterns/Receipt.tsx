import { SHELF_NAMES, ShelfMark, type Shelf } from "../components/Shelf.tsx";
import "../foundations.css";
import "./receipt.css";

export interface ReceiptPage {
  title: string;
  shelf: Shelf;
}

/** What a filing changed: every page, with its shelf. It is the proof that goes with Undo. */
export function Receipt({ pages }: { pages: readonly ReceiptPage[] }) {
  return (
    <ul className="av-receipt">
      {pages.map((page, i) => (
        <li key={`${page.shelf}:${page.title}:${i}`}>
          <ShelfMark shelf={page.shelf} />
          <span className="av-receipt-title">{page.title}</span>
          <span className="av-receipt-shelf">{SHELF_NAMES[page.shelf]}</span>
        </li>
      ))}
    </ul>
  );
}
