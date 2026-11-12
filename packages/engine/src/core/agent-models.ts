// The models an installed agent CLI says it can run, for a picker: Codex keeps its list in a cache file, OpenCode prints
// its own with `opencode models` (the models of every provider the person set up, local servers among them). Claude Code
// has no list, and the apps offer its aliases; an agent with no list has its model typed. Nothing here asks a model.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Env } from "./config.ts";

/** One model an agent can run: `value` is what its `--model` flag takes, `label` what a person reads. */
export interface AgentModel {
  value: string;
  label: string;
}

/** How long `opencode models` may take: it reads its configuration and asks no server. */
const LIST_TIMEOUT_MS = 10_000;

/**
 * The models Codex lists for the person: its cache's entries marked "list", in its order. The cache is Codex's own
 * (`$CODEX_HOME/models_cache.json`, or `~/.codex`), so these are the models its account can use. Empty when Codex has
 * not written one yet or it can't be read.
 */
export function codexModels(env: Env = process.env, home: string = homedir()): AgentModel[] {
  try {
    const file = join(env.CODEX_HOME || join(home, ".codex"), "models_cache.json");
    const cache: unknown = JSON.parse(readFileSync(file, "utf8"));
    const models = (cache as { models?: unknown }).models;
    if (!Array.isArray(models)) return [];
    const found: AgentModel[] = [];
    for (const entry of models) {
      const { slug, display_name, visibility } = (entry ?? {}) as Record<string, unknown>;
      if (typeof slug !== "string" || !slug || visibility !== "list" || found.some((m) => m.value === slug)) continue;
      found.push({ value: slug, label: typeof display_name === "string" && display_name ? display_name : slug });
    }
    return found;
  } catch {
    return [];
  }
}

/** The models in what `opencode models` printed: one `provider/model` per line, other lines (errors, notices) skipped. */
export function parseOpencodeModels(output: string): AgentModel[] {
  const found: AgentModel[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!/^[\w.-]+\/\S+$/.test(line) || found.some((m) => m.value === line)) continue;
    found.push({ value: line, label: line });
  }
  return found;
}

/** OpenCode's models, as `opencode models` lists them. Empty when it isn't there, doesn't answer in time or fails. */
export function opencodeModels(binary: string, env: Env = process.env): Promise<AgentModel[]> {
  return new Promise((resolve) => {
    execFile(binary, ["models"], { env, timeout: LIST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? [] : parseOpencodeModels(stdout));
    });
  });
}
