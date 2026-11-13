// A shelf the owner made looks the same wherever a shelf shows: its own colour (data-shelf="own"), the one own-shelf glyph and its
// name. The six built-in shelves stay as they are.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageRow, Receipt, Select, ShelfDrawer, ShelfGlyph, ShelfMark, ShelfTag, SHELF_NAMES, SHELVES, Tabs, shelfKey, shelfName, type AnyShelf } from "../src/index.ts";

const projects: AnyShelf = { own: "projects", name: "Projects" };
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
/** The data-shelf of each tag in the markup, in order. */
const shelvesIn = (markup: string) => [...markup.matchAll(/class="av-shelf-tag"[^>]*data-shelf="([^"]*)"/g)].map(([, shelf]) => shelf);

describe("own shelves", () => {
  it("a tag wears the own colour, the own glyph and the shelf's name", () => {
    const markup = html(createElement(ShelfTag, { shelf: projects }));
    expect(markup).toContain('data-shelf="own"');
    expect(markup).toContain(">Projects<");
    expect(markup).toContain(html(createElement(ShelfGlyph, { shelf: projects, size: 16 })));
  });

  it("every own shelf shares one glyph, none of the six", () => {
    const own = html(createElement(ShelfGlyph, { shelf: projects }));
    expect(html(createElement(ShelfGlyph, { shelf: { own: "recipes", name: "Recipes" } }))).toBe(own);
    for (const shelf of SHELVES) expect(html(createElement(ShelfGlyph, { shelf })), shelf).not.toBe(own);
  });

  it("a tab counts an own shelf's notes as it does a built-in one's", () => {
    const markup = html(createElement(ShelfTag, { shelf: projects, variant: "tab", count: 0, total: true }));
    expect(markup).toContain('data-shelf="own"');
    expect(markup).toContain('aria-label="0 notes"');
  });

  it("a mark wears the own colour and glyph", () => {
    const markup = html(createElement(ShelfMark, { shelf: projects }));
    expect(markup).toContain('data-shelf="own"');
    expect(markup).toContain(html(createElement(ShelfGlyph, { shelf: projects, size: 9 })));
  });

  it("the drawer draws the owner's shelves after the six, each with its count", () => {
    const markup = html(
      createElement(ShelfDrawer, {
        total: true,
        own: [
          { own: "projects", name: "Projects", count: 4 },
          { own: "recipes", name: "Recipes", count: 0 },
        ],
      }),
    );
    expect(shelvesIn(markup)).toEqual([...SHELVES, "own", "own"]);
    expect(markup.indexOf(">Projects<")).toBeLessThan(markup.indexOf(">Recipes<"));
    expect(markup).toContain('aria-label="4 notes"');
  });

  it("without own shelves the drawer is the six alone", () => {
    expect(shelvesIn(html(createElement(ShelfDrawer, {})))).toEqual([...SHELVES]);
  });

  it("a page row on an own shelf shows its tag", () => {
    const markup = html(createElement(PageRow, { title: "Plan the garden", shelf: projects, date: "6 Nov", expanded: false, onToggle: () => {} }));
    expect(shelvesIn(markup)).toEqual(["own"]);
    expect(markup).toContain(">Projects<");
  });

  it("a chosen own-shelf option dresses the select in the own colour and glyph", () => {
    const markup = html(
      createElement(Select<string>, {
        label: "Shelf",
        options: [{ value: "projects", label: "Projects", shelf: projects }],
        value: "projects",
        onChange: () => {},
      }),
    );
    expect(markup).toMatch(/class="av-select"[^>]*data-shelf="own"/);
    expect(markup).toContain(html(createElement(ShelfGlyph, { shelf: projects })));
  });

  it("a tab for an own shelf sets its glyph in the own colour", () => {
    const markup = html(
      createElement(Tabs<string>, {
        label: "Shelves",
        level: "secondary",
        options: [{ value: "all", label: "All" }, { value: "ideas", label: "Ideas", shelf: "ideas" }, { value: "projects", label: "Projects", shelf: projects }],
        value: "projects",
        onChange: () => {},
      }),
    );
    expect([...markup.matchAll(/class="av-tabs-shelf" data-shelf="([^"]*)"/g)].map(([, shelf]) => shelf)).toEqual(["ideas", "own"]);
    expect(markup).toContain(html(createElement(ShelfGlyph, { shelf: projects, size: 10 })));
  });

  it("a receipt names an own shelf and marks it in the own look", () => {
    const markup = html(createElement(Receipt, { pages: [{ title: "Plan the garden for spring", shelf: projects }, { title: "Dana", shelf: "people" }] }));
    expect([...markup.matchAll(/class="av-shelf-mark" data-shelf="([^"]*)"/g)].map(([, shelf]) => shelf)).toEqual(["own", "people"]);
    expect(markup).toContain('<span class="av-receipt-shelf">Projects</span>');
    expect(markup).toContain('<span class="av-receipt-shelf">People</span>');
  });

  it("the package names and keys any shelf", () => {
    expect(shelfName(projects)).toBe("Projects");
    expect(shelfKey(projects)).toBe("own");
    for (const shelf of SHELVES) {
      expect(shelfName(shelf)).toBe(SHELF_NAMES[shelf]);
      expect(shelfKey(shelf)).toBe(shelf);
    }
  });
});
