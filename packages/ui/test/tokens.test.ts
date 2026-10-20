// The tokens stay complete, generated and readable: both appearances define every role, the CSS and
// TypeScript match the JSON, and text keeps WCAG AA contrast in every mode, Increase Contrast included.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCss, buildTs } from "../scripts/build-tokens.mjs";
import { contrast, flatten, isEmitted, literalColor, readTokenFile } from "../scripts/tokens-lib.mjs";
import { filesInScope, run } from "../checks/design-check.mjs";

const UI = path.join(import.meta.dirname, "..");
const roles = (file: string) => [...flatten(readTokenFile(file)).keys()].filter(isEmitted).sort();
const MODES = ["light", "dark", "contrast-light", "contrast-dark"] as const;

describe("tokens", () => {
  it("are generated from the JSON", () => {
    expect(readFileSync(path.join(UI, "src/generated/tokens.css"), "utf8")).toBe(buildCss());
    expect(readFileSync(path.join(UI, "src/generated/tokens.ts"), "utf8")).toBe(buildTs());
  });

  it("define the same roles in light and dark", () => {
    expect(roles("dark")).toEqual(roles("light"));
  });

  it("override only roles that exist", () => {
    for (const file of ["contrast-light", "contrast-dark"]) for (const role of roles(file)) expect(roles("light")).toContain(role);
  });

  for (const mode of MODES) {
    it(`keep AA contrast in ${mode}`, () => {
      const c = (role: string, over?: string) => literalColor(mode, role, over);
      const window = c("surface.window");
      const pairs: [string, string, string, number][] = [
        ["ink on window", c("ink.default"), window, 4.5],
        ["secondary ink on window", c("ink.secondary"), window, 4.5],
        ["secondary ink on stage", c("ink.secondary"), c("surface.stage"), 4.5],
        ["secondary ink on a fill", c("ink.secondary"), c("surface.fill", window), 4.5],
        ["secondary ink on a field", c("ink.secondary"), c("surface.control", window), 4.5],
        ["accent ink on window", c("ink.accent"), window, 4.5],
        ["accent ink on paper", c("ink.accent"), c("surface.paper"), 4.5],
        ["danger ink on window", c("ink.danger"), window, 4.5],
        ["ok ink on window", c("ink.ok"), window, 4.5],
        ["paper ink on paper", c("paper.ink"), c("surface.paper"), 4.5],
        ["paper secondary ink on paper", c("paper.ink-secondary"), c("surface.paper"), 4.5],
        ["label on a violet button", c("ink.on-accent"), c("accent.fill"), 4.5],
        ["capsule secondary ink over a white desktop", c("hud.ink-secondary"), c("hud.surface", "#FFFFFF"), 4.5],
        ["capsule secondary ink over a black desktop", c("hud.ink-secondary"), c("hud.surface", "#000000"), 4.5],
        ["capsule violet over a white desktop", c("hud.ink-accent"), c("hud.surface", "#FFFFFF"), 4.5],
        ["capsule danger over a white desktop", c("hud.ink-danger"), c("hud.surface", "#FFFFFF"), 4.5],
        ["focus ring on window (graphics: 3:1)", c("accent.focus"), window, 3],
        ["violet fill on window (graphics: 3:1)", c("accent.fill"), window, 3],
      ];
      for (const [name, fg, bg, needed] of pairs) expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(needed);
    });
  }

  it("leave the whole repo passing design-check", () => {
    expect(run(filesInScope())).toEqual([]);
  });
});
