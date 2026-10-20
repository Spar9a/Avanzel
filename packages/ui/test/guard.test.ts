// The hooks' answers, in each agent's own format.
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPO } from "../checks/design-check.mjs";
import { beforeEdit, beforeShell, patchedFiles, respond } from "../checks/guard.mjs";

const at = (rel: string) => path.join(REPO, rel);

describe("guard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses an edit that paints in a window, and says how to fix it", () => {
    const d = beforeEdit({ tool_input: { file_path: at("apps/mac/src/renderer/demo/styles.css"), content: ".x { color: #ff3b30; padding: 14px; }" } });
    expect(d.verdict).toBe("deny");
    expect(d.reason).toContain("windows-arrange");
    expect(d.reason).toContain("var(--av-space-12) or var(--av-space-16)");
  });

  it("lets a clean window through", () => {
    const d = beforeEdit({ tool_input: { file_path: at("apps/mac/src/renderer/demo/main.tsx"), content: 'import { Button } from "@avanzel/ui";\nexport const A = () => <Button variant="primary">File it</Button>;\n' } });
    expect(d.verdict).toBe("allow");
  });

  it("asks the owner before a token changes and refuses edits to generated files", () => {
    expect(beforeEdit({ tool_input: { file_path: at("packages/ui/tokens/light.tokens.json"), content: "{}" } }).verdict).toBe("ask");
    expect(beforeEdit({ tool_input: { file_path: at("packages/ui/src/generated/tokens.css"), content: "" } }).verdict).toBe("deny");
    expect(beforeEdit({ tool_input: { file_path: at("packages/ui/checks/baseline.json"), content: "{}" } }).verdict).toBe("ask");
  });

  it("ignores files outside the repo and outside the design scope", () => {
    expect(beforeEdit({ tool_input: { file_path: "/tmp/notes.css", content: ".x { color: red; }" } }).verdict).toBe("allow");
    expect(beforeEdit({ tool_input: { file_path: at("apps/mac/src/main/tray.ts"), content: "const x = '#fff';" } }).verdict).toBe("allow");
  });

  it("refuses commands that approve screenshots or skip the checks", () => {
    expect(beforeShell({ tool_input: { command: "npx playwright test --update-snapshots" } }).verdict).toBe("deny");
    expect(beforeShell({ tool_input: { command: "npm run ui:approve" } }).verdict).toBe("deny");
    expect(beforeShell({ tool_input: { command: "git commit -n -m wip" } }).verdict).toBe("deny");
    expect(beforeShell({ tool_input: { command: "sed -i '' s/5B3FD1/FF0000/ packages/ui/tokens/base.tokens.json" } }).verdict).toBe("deny");
    expect(beforeShell({ tool_input: { command: "npm run design:check" } }).verdict).toBe("allow");
    expect(beforeShell({ tool_input: { command: "cd apps/mac/src/renderer/quick && python3 - <<'E'\np='main.tsx'\ns=open(p).read()\nopen(p,'w').write(s)\nE" } }).verdict).toBe("deny");
    expect(beforeShell({ tool_input: { command: "sed -i '' 's/a/b/' packages/ui/src/components/button.css" } }).verdict).toBe("deny");
    expect(beforeShell({ tool_input: { command: "cat apps/mac/src/renderer/quick/main.tsx" } }).verdict).toBe("allow");
    expect(beforeShell({ tool_input: { command: "grep -n hint apps/mac/src/renderer/quick/styles.css > /tmp/hits.txt" } }).verdict).toBe("allow");
    expect(beforeShell({ tool_input: { command: "npm run ui:e2e" } }).verdict).toBe("allow");
  });

  it("finds the files in a Codex patch", () => {
    const patch = "*** Begin Patch\n*** Update File: apps/mac/src/renderer/quick/styles.css\n@@\n-a\n+b\n*** Add File: apps/mac/src/renderer/x.tsx\n+x\n*** End Patch";
    expect(patchedFiles(patch)).toEqual(["apps/mac/src/renderer/quick/styles.css", "apps/mac/src/renderer/x.tsx"]);
  });

  it("answers each agent in its own format", () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (lines.push(String(s)), true));
    respond("claude", "before-edit", { verdict: "deny", reason: "r" });
    respond("claude", "before-edit", { verdict: "ask", reason: "r" });
    respond("codex", "before-shell", { verdict: "ask", reason: "r" });
    respond("codex", "after-edit", { verdict: "deny", reason: "r" });
    respond("gemini", "before-edit", { verdict: "deny", reason: "r" });
    respond("claude", "stop", { verdict: "deny", reason: "r" });
    const out = lines.map((l) => JSON.parse(l));
    expect(out[0].hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out[1].hookSpecificOutput.permissionDecision).toBe("ask");
    expect(out[2].hookSpecificOutput.permissionDecision).toBe("deny"); // Codex can't ask
    expect(out[3]).toEqual({ decision: "block", reason: "r" });
    expect(out[4]).toEqual({ decision: "deny", reason: "r" });
    expect(out[5]).toEqual({ decision: "block", reason: "r" });
  });
});
