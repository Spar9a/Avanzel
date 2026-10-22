// The write guard of Claude Code's write runs: the hook Claude Code runs before each Write, Edit and NotebookEdit, and
// the --settings that carry it with the deny rules. Each hook here runs as Claude Code runs it, through /bin/sh -c with
// the tool call on stdin, for a temporary library.
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEEP_OUT, guardSettings, installHook } from "../../src/core/guard-hook.ts";
import { useTmp } from "./helpers.ts";

const tmp = useTmp();

interface Answer {
  status: number | null;
  stdout: string;
}

/** A library at `<tmp>/<name>` with a few of its folders, and its hook installed in `<tmp>/<hookFolder>`. */
function library(name = "lib", hookFolder = "hook", interpreter = process.execPath): { root: string; command: string } {
  const root = join(tmp(), name);
  for (const folder of ["inbox", "raw", "ideas", "reviews", "tasks", ".avanzel"]) {
    mkdirSync(join(root, folder), { recursive: true });
  }
  const dir = join(tmp(), hookFolder);
  mkdirSync(dir);
  return { root, command: installHook(dir, root, interpreter) };
}

/** The hook's answer to `input` on its stdin. */
function run(command: string, input: string): Answer {
  const { status, stdout } = spawnSync("/bin/sh", ["-c", command], { input, encoding: "utf8" });
  return { status, stdout };
}

/** The hook's answer to a Write of `filePath` by an agent working in `cwd`. */
function write(command: string, filePath: string, cwd: string): Answer {
  return run(command, JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath, content: "x" }, cwd }));
}

/** The reason the hook gave for a deny (the test fails for any other answer). */
function refusal(answer: Answer): string {
  expect(answer.status).toBe(0);
  const { hookSpecificOutput } = JSON.parse(answer.stdout) as { hookSpecificOutput: Record<string, unknown> };
  expect(hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
  return String(hookSpecificOutput.permissionDecisionReason);
}

const LET_THROUGH: Answer = { status: 0, stdout: "" };

describe("the guard's hook", () => {
  it("refuses a write to the owner's words, with the reason", () => {
    const { root, command } = library();
    expect(refusal(write(command, join(root, "raw/2026/10/x.md"), root))).toContain("own words");
    expect(refusal(write(command, join(root, "inbox/2026-10-22-140312-x.md"), root))).toContain("own words");
  });

  it("refuses the library's settings", () => {
    const { root, command } = library();
    for (const rel of [".avanzel/config.toml", "AGENTS.md", ".claude/settings.json"]) {
      expect(refusal(write(command, join(root, rel), root)), rel).toContain("only its owner changes it");
    }
    expect(refusal(write(command, join(root, "tasks/weekly.md"), root))).toContain("scheduled instructions");
  });

  it("lets pages, the index, the log and reviews through", () => {
    const { root, command } = library();
    for (const rel of ["ideas/a.md", "index.md", "log.md", "reviews/2026-10-22-evening.md"]) {
      expect(write(command, join(root, rel), root), rel).toEqual(LET_THROUGH);
    }
  });

  it("refuses a write outside the library", () => {
    const { root, command } = library();
    const reason = refusal(write(command, "/tmp/elsewhere.md", root));
    expect(reason).toBe(`This run may only write inside the library, ${root}.`);
  });

  it("follows a symlink before deciding", () => {
    const { root, command } = library();
    symlinkSync(join(root, "raw"), join(root, "ideas/link"));
    expect(refusal(write(command, join(root, "ideas/link/x.md"), root))).toContain("own words");
    // A link to a file that isn't there yet: the write would create it in raw/.
    symlinkSync("../raw/new.md", join(root, "ideas/new.md"));
    expect(refusal(write(command, join(root, "ideas/new.md"), root))).toContain("own words");
    // A link that leads out of the library.
    mkdirSync(join(tmp(), "elsewhere"));
    symlinkSync(join(tmp(), "elsewhere"), join(root, "ideas/out"));
    expect(refusal(write(command, join(root, "ideas/out/x.md"), root))).toContain(`inside the library, ${root}`);
  });

  it("takes a relative path from the agent's folder", () => {
    const { root, command } = library();
    expect(refusal(write(command, "raw/x.md", root))).toContain("own words");
    expect(write(command, "ideas/a.md", root)).toEqual(LET_THROUGH);
  });

  it("matches in any letter case", () => {
    const { root, command } = library();
    expect(refusal(write(command, join(root, "RAW/x.md"), root))).toContain("own words");
    // A name not on disk yet, so the disk can't give its letter case: the rule still matches.
    expect(refusal(write(command, join(root, "Agents.md"), root))).toContain("only its owner changes it");
  });

  it("stays quiet about input it doesn't understand", () => {
    const { command } = library();
    expect(run(command, "not json")).toEqual(LET_THROUGH);
    expect(run(command, '{"tool_input":{}}')).toEqual(LET_THROUGH);
  });

  it("works for a library with spaces, a quote and brackets in its path", () => {
    // Its hook's folder and the Node it runs with have such names too, so the command's quoting is tried as well.
    const node = join(tmp(), "Kate's node [1]");
    symlinkSync(process.execPath, node);
    const { root, command } = library("My Notes [Kate's]", "Kate's hook [1]", node);
    expect(refusal(write(command, "raw/x.md", root))).toContain("own words");
    expect(write(command, join(root, "ideas/a.md"), root)).toEqual(LET_THROUGH);
  });
});

describe("guardSettings", () => {
  const denyOf = (root: string): string[] =>
    (JSON.parse(guardSettings(root, "true")) as { permissions: { deny: string[] } }).permissions.deny;

  it("denies the same paths to Edit, for the root and its real path", () => {
    const { root, command } = library();
    const settings = JSON.parse(guardSettings(root, command)) as Record<string, unknown>;
    // Nothing else: -p silently ignores settings that fail validation.
    expect(Object.keys(settings)).toEqual(["permissions", "hooks"]);
    expect(settings.permissions).toEqual({ deny: expect.any(Array) });
    const deny = denyOf(root);
    expect(deny).toContain(`Edit(//${root.slice(1)}/raw/**)`);
    expect(deny).toContain(`Edit(//${root.slice(1)}/raw)`);
    expect(deny).toContain(`Edit(//${root.slice(1)}/.claude/**)`);
    expect(deny).toHaveLength(KEEP_OUT.length * 2);
    expect(settings.hooks).toEqual({
      PreToolUse: [{ matcher: "Write|Edit|NotebookEdit", hooks: [{ type: "command", command, timeout: 10 }] }],
    });

    // A root reached through a symlink has its rules in both forms.
    const linked = join(tmp(), "linked");
    symlinkSync(root, linked);
    const both = denyOf(linked);
    expect(both).toContain(`Edit(//${linked.slice(1)}/AGENTS.md)`);
    expect(both).toContain(`Edit(//${root.slice(1)}/AGENTS.md)`);
    expect(both).toHaveLength(KEEP_OUT.length * 4);

    // What a pattern reads as a wildcard is escaped.
    const odd = join(tmp(), "My Notes [Kate's] *?");
    mkdirSync(odd);
    expect(denyOf(odd)).toContain(`Edit(//${tmp().slice(1)}/My Notes \\[Kate's\\] \\*\\?/raw/**)`);
  });
});
