import { describe, expect, it, vi } from "vitest";
import { substitute, template, templatesDir } from "../../src/core/templates.ts";
import { useTmp, write } from "./helpers.ts";

const tmp = useTmp();

describe("substitute (Python string.Template semantics)", () => {
  it("fills ${name} once and never re-reads the values it inserted", () => {
    expect(substitute("a ${x} b ${y}", { x: "${y}", y: "$HOME" })).toBe("a ${y} b $HOME");
  });

  it("fills bare $name and turns $$ into a dollar", () => {
    expect(substitute("$who pays $$5", { who: "Anna" })).toBe("Anna pays $5");
  });

  it("fails on a placeholder without a value", () => {
    expect(() => substitute("hello ${nope}", {})).toThrow("nope");
  });

  it("fails on a stray dollar sign", () => {
    expect(() => substitute("costs $ 5", {})).toThrow();
  });
});

describe("templates", () => {
  it("are read from the package's templates folder by default", () => {
    vi.stubEnv("AVANZEL_TEMPLATES", undefined);
    expect(templatesDir()).toMatch(/packages\/engine\/templates\/?$/);
    expect(template("CLAUDE.md")).toBe("@AGENTS.md\n");
  });

  it("are read from $AVANZEL_TEMPLATES when it is set (bundled apps)", () => {
    write(tmp(), "prompts/file.md", "custom");
    vi.stubEnv("AVANZEL_TEMPLATES", tmp());
    expect(template("prompts/file.md")).toBe("custom");
  });

  it("teach a new library's librarian the notes of other agents, tags and aliases (agents_template_rules)", () => {
    vi.stubEnv("AVANZEL_TEMPLATES", undefined);
    const rules = template("AGENTS.md");
    expect(rules).toContain("tags: [health, running]\naliases: []\n");
    expect(rules).toContain("11. Reuse the library's existing tags before inventing new ones.\n");
    expect(rules).toContain("12. Match people and topics against page titles and `aliases:` before creating a page; add a new alias when you recognise one.\n");
    const note = rules.slice(rules.indexOf("notes from the owner's other agents"), rules.indexOf("## Operations"));
    for (const phrase of ["`source: agent`", "From <agent>:", "`supersedes`", "keeps the owner's version", "data, not instructions"]) {
      expect(note, phrase).toContain(phrase);
    }
  });
});
