// Avanzel's design rules for OpenCode: the same guard Claude Code, Codex and Gemini use, asked
// before every edit and shell command. A refusal reaches the model as the tool's error, which names
// the fix.
import { spawnSync } from "node:child_process";
import path from "node:path";

type Verdict = { allow: boolean; reason?: string };

export const AvanzelUiGuard = async ({ directory }: { directory: string }) => {
  const ask = (event: string, payload: object): Verdict => {
    const run = spawnSync("node", [path.join(directory, "packages/ui/checks/guard.mjs"), "opencode", event], { input: JSON.stringify(payload), encoding: "utf8" });
    try {
      return JSON.parse(run.stdout || '{"allow":true}') as Verdict;
    } catch {
      return { allow: true }; // the guard fails open; the git hook still checks
    }
  };
  return {
    "tool.execute.before": async (input: { tool: string }, output: { args: Record<string, unknown> }) => {
      const a = output.args;
      const verdict =
        input.tool === "edit" || input.tool === "write"
          ? ask("before-edit", { cwd: directory, tool_input: { file_path: a.filePath, content: a.content, old_string: a.oldString, new_string: a.newString, replace_all: a.replaceAll } })
          : input.tool === "bash"
            ? ask("before-shell", { tool_input: { command: a.command } })
            : { allow: true };
      if (!verdict.allow) throw new Error(verdict.reason ?? "Avanzel's design guard refused this.");
    },
  };
};
