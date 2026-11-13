import { SHELVES, type Shelf } from "../generated/tokens.ts";
import { Row } from "./Layout.tsx";
import { ShelfTag } from "./Shelf.tsx";

export interface ShelfDrawerProps {
  /** Pages per shelf. A shelf left out has none: its tab shows no count, unless `total` is set. */
  counts?: Partial<Record<Shelf, number>>;
  /** The counts are what each shelf holds, so every tab shows its own, 0 too. Without it they are what just went in. */
  total?: boolean;
  /** Where the tabs sit in their line. */
  align?: "start" | "center";
  /** The shelves the owner made, in their order, each with its folder, its name and its pages: drawn after the six, in the own-shelf look. */
  own?: readonly { folder: string; name: string; count: number }[];
}

/** The shelves' divider tabs in one line, as in a drawer: the six, then the owner's own. Where a filing goes, or what the library holds. */
export function ShelfDrawer({ counts = {}, total, align = "center", own = [] }: ShelfDrawerProps) {
  return (
    <Row gap={6} wrap justify={align}>
      {SHELVES.map((shelf) => <ShelfTag key={shelf} shelf={shelf} variant="tab" total={total} count={total ? (counts[shelf] ?? 0) : counts[shelf]} />)}
      {own.map(({ folder, name, count }) => <ShelfTag key={`own:${folder}`} shelf={{ own: folder, name }} variant="tab" total={total} count={count} />)}
    </Row>
  );
}
