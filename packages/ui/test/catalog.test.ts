// A component isn't finished until people and agents can find it: every component @avanzel/ui exports
// has a section in the gallery (so it is photographed and reviewed) and a row in DESIGN.md.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as ui from "../src/index.ts";

const UI = path.join(import.meta.dirname, "..");
const components = Object.entries(ui).filter(([name, value]) => typeof value === "function" && /^[A-Z]/.test(name)).map(([name]) => name);

describe("catalog", () => {
  it("exports components", () => {
    expect(components.length).toBeGreaterThan(20);
  });

  it("shows every component in the gallery", () => {
    const gallery = readFileSync(path.join(UI, "gallery/Gallery.tsx"), "utf8");
    for (const name of components) expect(gallery, `gallery/Gallery.tsx should render <${name}>`).toMatch(new RegExp(`<${name}[\\s/>]`));
  });

  it("shows a shelf the owner made on a tag, a page row and the drawer", () => {
    const gallery = readFileSync(path.join(UI, "gallery/Gallery.tsx"), "utf8");
    expect(gallery).toMatch(/<ShelfTag shelf=\{\{ own: "projects", name: "Projects" \}\}/);
    expect(gallery).toMatch(/<PageRow[^>]*shelf=\{\{ own: "projects", name: "Projects" \}\}/);
    expect(gallery).toMatch(/<ShelfDrawer[^>]*own=\{\[\{ own: "projects", name: "Projects", count: \d+ \}\]\}/);
  });

  it("shows every own-shelf variant: its swatch, a chosen Select option, a Tabs tab and a Receipt's mark", () => {
    const gallery = readFileSync(path.join(UI, "gallery/Gallery.tsx"), "utf8");
    expect(gallery).toMatch(/\["Shelves", \[[^\]]*"--av-shelf-own"\]\]/);
    expect(gallery).toMatch(/<Select[\s\S]{0,300}?shelf: \{ own: "projects", name: "Projects" \}[\s\S]{0,200}?value="projects"/);
    expect(gallery).toMatch(/<Tabs[\s\S]{0,300}?shelf: \{ own: "projects", name: "Projects" \}/);
    expect(gallery).toMatch(/<Receipt pages=\{\[\{ title: "[^"]+", shelf: \{ own: "projects", name: "Projects" \} \}/);
  });

  it("lists every component in DESIGN.md", () => {
    const doc = readFileSync(path.join(UI, "DESIGN.md"), "utf8");
    for (const name of components) expect(doc, `DESIGN.md should list ${name}`).toContain(`\`${name}\``);
  });
});
