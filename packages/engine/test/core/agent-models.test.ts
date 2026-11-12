import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codexModels, opencodeModels, parseOpencodeModels } from "../../src/core/agent-models.ts";
import { useTmp } from "./helpers.ts";

const tmp = useTmp();

function writeCache(codexHome: string, models: unknown): void {
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, "models_cache.json"), JSON.stringify({ models }));
}

describe("codexModels", () => {
  it("lists the entries Codex marks as listed, by their display names, in its order", () => {
    const home = join(tmp(), "codex");
    writeCache(home, [
      { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide" },
      { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list" },
      { slug: "gpt-5.6-luna", visibility: "list" },
      { slug: "gpt-6-luna", display_name: "again", visibility: "list" },
    ]);
    expect(codexModels({ CODEX_HOME: home }, tmp())).toEqual([
      { value: "gpt-6-luna", label: "GPT-6-Luna" },
      { value: "gpt-5.6-luna", label: "gpt-5.6-luna" },
    ]);
  });

  it("reads ~/.codex when CODEX_HOME is not set", () => {
    writeCache(join(tmp(), ".codex"), [{ slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list" }]);
    expect(codexModels({}, tmp())).toEqual([{ value: "gpt-6-luna", label: "GPT-6-Luna" }]);
  });

  it("is empty without a cache, with one that isn't JSON, and with one that has no models", () => {
    expect(codexModels({ CODEX_HOME: join(tmp(), "none") }, tmp())).toEqual([]);
    mkdirSync(join(tmp(), "bad"));
    writeFileSync(join(tmp(), "bad", "models_cache.json"), "{ not json");
    expect(codexModels({ CODEX_HOME: join(tmp(), "bad") }, tmp())).toEqual([]);
    writeCache(join(tmp(), "empty"), "nothing");
    expect(codexModels({ CODEX_HOME: join(tmp(), "empty") }, tmp())).toEqual([]);
  });
});

describe("parseOpencodeModels", () => {
  it("keeps the provider/model lines once each and skips everything else", () => {
    const output = [
      "opencode/deepseek-v4.1-flash-free",
      "atomic-chat/Qwen3_5-9B-MLX-4bit",
      "huggingface/Qwen/Qwen3-8B",
      "opencode/deepseek-v4.1-flash-free",
      "Error: something",
      "",
    ].join("\n");
    expect(parseOpencodeModels(output).map((m) => m.value)).toEqual([
      "opencode/deepseek-v4.1-flash-free",
      "atomic-chat/Qwen3_5-9B-MLX-4bit",
      "huggingface/Qwen/Qwen3-8B",
    ]);
  });
});

describe("opencodeModels", () => {
  function fakeOpencode(body: string): string {
    const file = join(tmp(), "opencode");
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  }

  it("runs `opencode models` and returns what it lists", async () => {
    const binary = fakeOpencode('[ "$1" = models ] && printf "opencode/big-pickle\\natomic-chat/gemma-4-E4B-it-MLX-4bit\\n"');
    expect((await opencodeModels(binary)).map((m) => m.value)).toEqual(["opencode/big-pickle", "atomic-chat/gemma-4-E4B-it-MLX-4bit"]);
  });

  it("is empty when the command fails or isn't there", async () => {
    expect(await opencodeModels(fakeOpencode("exit 1"))).toEqual([]);
    expect(await opencodeModels(join(tmp(), "missing"))).toEqual([]);
  });
});
