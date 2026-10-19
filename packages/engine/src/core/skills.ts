// Install the Avanzel Agent Skill (SKILL.md, agentskills.io format) where each harness looks for it.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AvanzelError } from "../types.ts";
import { which } from "./proc.ts";
import { template } from "./templates.ts";

export const SKILL_NAME = "avanzel";

// target -> skills folder under $HOME, and the binaries whose harness reads that folder
const TARGETS: Readonly<Record<string, { folder: string; binaries: readonly string[] }>> = {
  claude: { folder: ".claude/skills", binaries: ["claude", "opencode"] },
  agents: { folder: ".agents/skills", binaries: ["codex", "opencode"] },
  cursor: { folder: ".cursor/skills", binaries: ["cursor-agent"] },
};

export interface SkillTarget {
  name: string;
  skillsDir: string;
}

/** Skill folders to install into: the ones the installed harnesses read, or `only` (a target or "all"). */
export function skillTargets(
  home: string,
  { which: lookup = (binary: string) => which(binary), only = null }: { which?: (binary: string) => string | null; only?: string | null } = {},
): SkillTarget[] {
  let names: string[];
  if (!only) {
    names = Object.keys(TARGETS).filter((name) => TARGETS[name]?.binaries.some((binary) => lookup(binary)));
  } else if (only === "all") {
    names = Object.keys(TARGETS);
  } else if (Object.hasOwn(TARGETS, only)) {
    names = [only];
  } else {
    throw new AvanzelError(`Unknown skill target '${only}'. Choose from: ${Object.keys(TARGETS).join(", ")}, all.`);
  }
  return names.map((name) => ({ name, skillsDir: join(home, ...(TARGETS[name]?.folder ?? "").split("/")) }));
}

export function renderSkill(): string {
  return template("skill/SKILL.md");
}

/** Write SKILL.md into each target (or only list where it would go); returns the paths. */
export function installSkill(targets: readonly SkillTarget[], { dryRun = false }: { dryRun?: boolean } = {}): string[] {
  const paths = targets.map((target) => join(target.skillsDir, SKILL_NAME, "SKILL.md"));
  if (!dryRun) {
    for (const path of paths) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, renderSkill(), "utf8");
    }
  }
  return paths;
}
