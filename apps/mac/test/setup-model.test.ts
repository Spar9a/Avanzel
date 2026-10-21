import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Vault } from "@avanzel/engine";
import { bestAgent, libraryFolder, tildePath } from "../src/main/setup-model.ts";
import type { AgentStatus, SetupAgent } from "../src/shared/ipc.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "avz-setup-"));

/** An installed agent as setup lists it, with what its check found. */
const agent = (name: string, status: AgentStatus | null): SetupAgent => ({ name, label: name, freeCheck: true, status });
const signedIn: AgentStatus = { kind: "signed-in", seconds: 0.4 };
const signedOut: AgentStatus = { kind: "signed-out", detail: "" };
const checking: AgentStatus = { kind: "checking" };
const replied: AgentStatus = { kind: "replied", seconds: 1.6 };

describe("setup model", () => {
  it("tildePath shortens only the home folder itself", () => {
    expect(tildePath("/Users/a/Avanzel", "/Users/a")).toBe("~/Avanzel");
    expect(tildePath("/Users/ab/x", "/Users/a")).toBe("/Users/ab/x");
    expect(tildePath("/Volumes/x", "/Users/a")).toBe("/Volumes/x");
    expect(tildePath("/Users/a", "/Users/a")).toBe("~");
  });

  it("libraryFolder tells missing, empty, has-files and library apart", async () => {
    const missing = path.join(tmp(), "Avanzel");
    const empty = tmp();
    const onlyDsStore = tmp();
    writeFileSync(path.join(onlyDsStore, ".DS_Store"), "");
    const notes = tmp();
    writeFileSync(path.join(notes, "notes.md"), "# Notes\n");
    const file = path.join(tmp(), "Avanzel");
    writeFileSync(file, "a file where the folder would go");
    const library = tmp();
    await Vault.init(library, { git: false });
    expect([missing, empty, onlyDsStore, notes, file, library].map((target) => libraryFolder(target))).toEqual([
      "missing", "empty", "empty", "has-files", "has-files", "library",
    ]);
  });
});

describe("bestAgent", () => {
  it("Claude Code first when it works", () => {
    expect(bestAgent([agent("claude", signedIn), agent("codex", signedIn)])).toBe("claude");
    expect(bestAgent([agent("codex", signedIn), agent("claude", replied)])).toBe("claude"); // wherever it is listed
  });

  it("else the first that works", () => {
    expect(bestAgent([agent("claude", signedOut), agent("codex", signedIn)])).toBe("codex");
    expect(bestAgent([agent("claude", checking), agent("codex", replied)])).toBe("codex");
    expect(bestAgent([agent("claude", { kind: "timeout" }), agent("opencode", replied), agent("codex", signedIn)])).toBe("opencode");
  });

  it("nothing that is known to work", () => {
    expect(bestAgent([agent("claude", null), agent("codex", checking), agent("opencode", signedOut)])).toBeNull();
    expect(bestAgent([agent("claude", { kind: "failed", detail: "Error: boom" })])).toBeNull();
    expect(bestAgent([])).toBeNull();
  });
});
