import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templates = fileURLToPath(new URL("../templates/", import.meta.url));

describe("templates", () => {
  it("ships the library scaffold, prompts, default shadow tasks and the skill", () => {
    for (const rel of [
      "AGENTS.md", "CLAUDE.md", "index.md", "log.md", "config.toml", "opencode.json", "gitignore",
      "prompts/file.md", "prompts/ask.md", "prompts/review.md",
      "tasks/evening-review.md", "tasks/weekly-review.md", "skill/SKILL.md",
    ]) {
      expect(existsSync(templates + rel), rel).toBe(true);
    }
  });
});
