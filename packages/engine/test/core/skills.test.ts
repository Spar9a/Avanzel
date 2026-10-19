import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKILL_NAME, installSkill, renderSkill, skillTargets } from "../../src/core/skills.ts";
import { AvanzelError } from "../../src/types.ts";
import { thrownBy, useTmp } from "./helpers.ts";

const tmp = useTmp();
const which = (...present: string[]) => (binary: string) => (present.includes(binary) ? `/usr/bin/${binary}` : null);

describe("skills", () => {
  it("ship a valid SKILL.md frontmatter", () => {
    const text = renderSkill();
    expect(text.startsWith("---\n")).toBe(true);
    const fields = Object.fromEntries(
      (text.split("---\n")[1] ?? "")
        .trim()
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)]),
    );
    expect(fields.name).toBe(SKILL_NAME);
    expect(SKILL_NAME).toBe("avanzel");
    expect(fields.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fields.description?.length).toBeGreaterThanOrEqual(1);
    expect(fields.description?.length).toBeLessThanOrEqual(1024);
  });

  it("go where the installed harnesses look for them", () => {
    expect(skillTargets(tmp(), { which: which("codex") })).toEqual([{ name: "agents", skillsDir: join(tmp(), ".agents", "skills") }]);
    expect(skillTargets(tmp(), { which: which("claude", "cursor-agent") }).map((target) => target.name)).toEqual(["claude", "cursor"]);
    expect(skillTargets(tmp(), { which: which("opencode") }).map((target) => target.name)).toEqual(["claude", "agents"]);
    expect(skillTargets(tmp(), { which: which() })).toEqual([]);
  });

  it("go where the owner says", () => {
    expect(skillTargets(tmp(), { which: which(), only: "all" }).map((target) => target.name)).toEqual(["claude", "agents", "cursor"]);
    expect(skillTargets(tmp(), { which: which(), only: "cursor" }).map((target) => target.name)).toEqual(["cursor"]);
    const error = thrownBy(() => skillTargets(tmp(), { only: "vim" }));
    expect(error).toBeInstanceOf(AvanzelError);
    expect(error.message).toContain("vim");
  });

  it("are written on install, and only planned on a dry run", () => {
    const targets = skillTargets(tmp(), { which: which(), only: "all" });
    const planned = installSkill(targets, { dryRun: true });
    expect(planned).toEqual([
      join(tmp(), ".claude", "skills", "avanzel", "SKILL.md"),
      join(tmp(), ".agents", "skills", "avanzel", "SKILL.md"),
      join(tmp(), ".cursor", "skills", "avanzel", "SKILL.md"),
    ]);
    expect(planned.some((path) => existsSync(path))).toBe(false);
    expect(installSkill(targets)).toEqual(planned);
    for (const path of planned) expect(readFileSync(path, "utf8").startsWith("---\nname: avanzel\n")).toBe(true);
  });
});
