// A run that throws after the agent wrote (the disk failed, the stop came at a bad moment) still puts back what it did to the owner's
// notes: the run here is the fake agent's, and then it throws.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Librarian } from "../../src/core/librarian.ts";
import { Vault } from "../../src/core/vault.ts";
import { NOW, envHome, write } from "./helpers.ts";
import { fakeSettings, mode, tmp } from "./librarian-fixtures.ts";

const fail = { after: false };

vi.mock("../../src/core/harness.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/harness.ts")>();
  return {
    ...original,
    runHeadless: async (...args: Parameters<typeof original.runHeadless>) => {
      const result = await original.runHeadless(...args);
      if (fail.after) throw new Error("The disk failed.");
      return result;
    },
  };
});

const SENECA = "# Seneca\n\n## 01.11.2026\nСенека пишет о письмах.\n";
const read = (vault: Vault, rel: string) => readFileSync(join(vault.root, rel), "utf8");

describe("a run that throws after the agent wrote", () => {
  let vault: Vault;
  let librarian: Librarian;

  beforeEach(async () => {
    envHome(tmp());
    vault = await Vault.init(join(tmp(), "lib"), { git: false });
    write(vault.root, "Philosophy/Seneca.md", SENECA);
    librarian = new Librarian(vault, fakeSettings({ autoCommit: false }), { clock: () => NOW });
    await librarian.applyStudy({
      style: "",
      shelves: [{ folder: "Philosophy", name: "Philosophy", definition: "Thinkers.", map: "", fileHere: true }],
    });
    fail.after = true;
    return () => {
      fail.after = false;
    };
  });

  it("puts back the owner's note a filing rewrote", async () => {
    mode("rewrite-found");
    vault.newCapture("Сенека о письмах", { source: "text", now: NOW });
    const [outcome] = await librarian.file();
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toBe("The disk failed.");
    expect(read(vault, "Philosophy/Seneca.md")).toBe(SENECA);
  });

  it("puts back the owner's note a review or a saved answer rewrote", async () => {
    mode("rewrite-note");
    vi.stubEnv("FAKE_AGENT_PAGE", "Philosophy/Seneca.md");
    await expect(librarian.review()).rejects.toThrow("The disk failed.");
    expect(read(vault, "Philosophy/Seneca.md")).toBe(SENECA);
    await expect(librarian.ask("Что писал Сенека?", { save: true })).rejects.toThrow("The disk failed.");
    expect(read(vault, "Philosophy/Seneca.md")).toBe(SENECA);
  });
});
