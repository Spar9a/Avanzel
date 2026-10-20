// Every design rule fails on an example that breaks it and passes on its fix, so a rule can't stop
// working without a test noticing.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkSource, introduced, scopeOf } from "../checks/design-check.mjs";
import { RULES } from "../checks/rules.mjs";

const WINDOW_CSS = "apps/mac/src/renderer/demo/styles.css";
const WINDOW_TSX = "apps/mac/src/renderer/demo/main.tsx";
const SYSTEM_CSS = "packages/ui/src/components/demo.css";
const SYSTEM_TSX = "packages/ui/src/components/Demo.tsx";

const rules = (file: string, text: string) => checkSource(file, text).map((p: { rule: string }) => p.rule);

/** For each rule: a file, text that breaks the rule, and the fixed text. */
const CASES: Record<string, [string, string, string]> = {
  "windows-arrange": [WINDOW_CSS, ".hint { color: #ff3b30; }", ".hint { display: flex; }"],
  "space-scale": [WINDOW_CSS, ".row { padding: 0 14px; }", ".row { padding: 0 var(--av-space-12); }"],
  "layer-scale": [WINDOW_CSS, ".bar { z-index: 2; }", ".bar { z-index: var(--av-layer-sticky); }"],
  "known-token": [WINDOW_CSS, ".row { gap: var(--av-space-14); }", ".row { gap: var(--av-space-16); }"],
  "ui-internals": [WINDOW_CSS, ".pane .av-button { width: 100%; }", ".pane > * { width: 100%; }"],
  "no-important": [WINDOW_CSS, ".row { display: none !important; }", ".row { display: none; }"],
  "use-components": [WINDOW_TSX, "export const A = () => <button>File it</button>;", 'import { Button } from "@avanzel/ui";\nexport const A = () => <Button>File it</Button>;'],
  "no-style-prop": [WINDOW_TSX, 'export const A = () => <div style={{ color: "red" }} />;', "export const A = () => <div className=\"pane\" />;"],
  "no-overrides": [WINDOW_TSX, 'import { Button } from "@avanzel/ui";\nexport const A = () => <Button className="big">File it</Button>;', 'import { Button } from "@avanzel/ui";\nexport const A = () => <Button size="large">File it</Button>;'],
  "ui-entry": [WINDOW_TSX, 'import { Button } from "@avanzel/ui/src/components/Button.tsx";', 'import { Button } from "@avanzel/ui";'],
  "tokens-only": [SYSTEM_CSS, ".av-demo { color: #333; border-radius: 9px; }", ".av-demo { color: var(--av-ink); border-radius: var(--av-radius-group); }"],
  "raw-colour": [SYSTEM_TSX, 'export const A = () => <svg><path fill="#fff" /></svg>;', 'export const A = () => <svg><path fill="currentColor" /></svg>;'],
  "motion-tokens": [SYSTEM_CSS, ".av-demo { transition: opacity 250ms ease; }", ".av-demo { transition: opacity var(--av-duration-base) var(--av-ease-out); }"],
  "glass-in-hud": [SYSTEM_CSS, ".av-demo { backdrop-filter: blur(20px); }", ".av-demo { background: var(--av-surface-raised); }"],
  "capitals-in-stamp": [SYSTEM_CSS, ".av-demo { text-transform: uppercase; }", ".av-demo { text-transform: none; }"],
  "style-vars-only": [SYSTEM_TSX, "export const A = () => <i style={{ height: 4 }} />;", 'export const A = () => <i style={{ "--_level": 0.4 }} />;'],
  "sentence-case": [WINDOW_TSX, 'import { Button } from "@avanzel/ui";\nexport const A = () => <Button>Open The Library</Button>;', 'import { Button } from "@avanzel/ui";\nexport const A = () => <Button>Open the library</Button>;'],
  "no-exclamation": [WINDOW_TSX, 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Filed!</Text>;', 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Filed.</Text>;'],
  "no-filler": [WINDOW_TSX, 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Oops, something went wrong.</Text>;', 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Claude Code has hit its usage limit.</Text>;'],
  "real-ellipsis": [WINDOW_TSX, 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Filing...</Text>;', 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Filing…</Text>;'],
  "no-shouting": [WINDOW_TSX, 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>This is IMPORTANT.</Text>;', 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>This needs you. See AGENTS.md and the CLI.</Text>;'],
  "they-them": [WINDOW_TSX, 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Ask her about the launch.</Text>;', 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Ask them about the launch.</Text>;'],
  "zel-says-i": [WINDOW_TSX, 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>I filed it in Ideas.</Text>;', 'import { Bubble } from "@avanzel/ui";\nexport const A = () => <Bubble title="I filed it in Ideas." />;'],
  "no-emoji": [WINDOW_TSX, 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Filed 🎉</Text>;', 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>Filed.</Text>;'],
};

describe("design rules", () => {
  it("has an example for every rule", () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(RULES).sort());
  });

  for (const [rule, [file, bad, good]] of Object.entries(CASES)) {
    it(`${rule}: catches the problem and passes the fix`, () => {
      expect(rules(file, bad)).toContain(rule);
      expect(rules(file, good)).not.toContain(rule);
    });
  }

  it("knows windows from the design system", () => {
    expect(scopeOf("apps/mac/src/renderer/quick/styles.css")).toBe("windows");
    expect(scopeOf("packages/ui/src/components/button.css")).toBe("system");
    expect(scopeOf("packages/ui/src/generated/tokens.css")).toBeNull();
    expect(scopeOf("apps/mac/src/main/controller.ts")).toBeNull();
  });

  it("lets Zel say I in setup, bubbles, letters and its voice", () => {
    expect(rules("apps/mac/src/renderer/setup/main.tsx", 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text>I listen only while you can see me.</Text>;')).not.toContain("zel-says-i");
    expect(rules(WINDOW_TSX, 'import { Text } from "@avanzel/ui";\nexport const A = () => <Text variant="voice">I already knew that one.</Text>;')).not.toContain("zel-says-i");
    expect(rules(WINDOW_TSX, 'import { Switch } from "@avanzel/ui";\nexport const A = () => <Switch label="Keep Zel on my desktop" checked onChange={() => {}} />;')).toEqual([]);
  });

  it("reports only what an edit adds to a file that predates the rules", () => {
    const before = ".hint { color: var(--text-2); }";
    expect(introduced(WINDOW_CSS, before, `${before}\n.hint2 { display: flex; }`)).toEqual([]);
    expect(introduced(WINDOW_CSS, before, `${before}\n.hint2 { color: red; }`).map((p: { rule: string }) => p.rule)).toEqual(["windows-arrange"]);
  });

  it("is explained in DESIGN.md, rule by rule", () => {
    const doc = readFileSync(path.join(import.meta.dirname, "..", "DESIGN.md"), "utf8");
    for (const rule of Object.keys(RULES)) expect(doc, `DESIGN.md should mention ${rule}`).toContain(`\`${rule}\``);
  });
});
