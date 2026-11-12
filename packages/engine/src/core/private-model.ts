// A private model: the harness the person already uses, pointed at a server of their own (on this Mac, or their company's)
// instead of its maker's. Each run gets a route: the environment, a few flags and a throwaway config folder that make that one
// harness talk to the server and nothing else, without touching the agent's own settings. The folder is the run's temporary one,
// which goes when the run ends. A harness speaks one kind of server, so the kind the server speaks says which harnesses can be used.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "./config.ts";

/** What a server speaks: OpenAI chat completions, Anthropic Messages or OpenAI Responses. */
export type PrivateApi = "chat" | "messages" | "responses";

export const PRIVATE_APIS: readonly PrivateApi[] = ["chat", "messages", "responses"];

export interface PrivateModel {
  /** On: the library's agent runs against the server below, whatever its own login says. */
  enabled: boolean;
  /** The server's address, such as http://127.0.0.1:8080/v1. */
  baseUrl: string;
  /** The model's name on that server. */
  model: string;
  api: PrivateApi;
  /** How many tokens the server holds in one conversation; the agent is told so, to make room before it overflows. */
  contextWindow: number;
  /**
   * The name of an environment variable that holds the server's key, so the key never lands in the library's settings (which
   * can be committed). Empty for a server that needs none, as a local one does.
   */
  keyEnv: string;
}

export function defaultPrivateModel(): PrivateModel {
  return { enabled: false, baseUrl: "", model: "", api: "chat", contextWindow: 65_536, keyEnv: "" };
}

/** The agents that speak each kind of server, best first (pi and OpenCode take chat completions, Claude Code Messages, Codex Responses). */
const HARNESSES: Readonly<Record<PrivateApi, readonly string[]>> = {
  chat: ["pi", "opencode"],
  messages: ["claude"],
  responses: ["codex"],
};

/** The built-in agents that can run against a server speaking `api`. */
export function privateHarnesses(api: PrivateApi): readonly string[] {
  return HARNESSES[api];
}

/** What the server must speak for `harness`, or null for an agent that can't run against a private server. */
export function apiOf(harness: string): PrivateApi | null {
  return PRIVATE_APIS.find((api) => HARNESSES[api].includes(harness)) ?? null;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** The address as a URL, or null when it isn't an http(s) address. */
function parseUrl(text: string): URL | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * What stops a private model from running with `harness`, in a sentence for the person, or null when it can run. An address
 * that isn't on this Mac must be https, so a key and the notes don't cross a network in the clear.
 */
export function privateProblem(model: PrivateModel, harness: string): string | null {
  const url = parseUrl(model.baseUrl);
  if (!url) return "The server's address must start with http:// or https://.";
  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) {
    return "A server that isn't on this Mac must be reached over https.";
  }
  if (!model.model.trim()) return "Name the model the server runs.";
  if (!Number.isInteger(model.contextWindow) || model.contextWindow < 4_096) return "The context size must be at least 4096.";
  if (apiOf(harness) !== model.api) {
    const names = privateHarnesses(model.api).join(" or ");
    return `A server that speaks ${API_NAMES[model.api]} works with ${names}.`;
  }
  return null;
}

const API_NAMES: Readonly<Record<PrivateApi, string>> = {
  chat: "OpenAI chat completions",
  messages: "Anthropic Messages",
  responses: "OpenAI Responses",
};

/** What a server of this kind speaks, as a person reads it. */
export function apiName(api: PrivateApi): string {
  return API_NAMES[api];
}

export interface PrivateRoute {
  /** The model to pass the agent, in the form it takes. */
  model: string;
  /** Flags that come right after the agent's command (Codex's provider settings, pi's provider name). */
  args: string[];
  /** Variables for this run: where the server is, the key, a config folder of the run's own, and the agent's privacy switches. */
  env: Record<string, string>;
  /** The server's host, for the agent to reach directly even when the environment names a proxy. */
  host: string;
}

/** The server's address ending in /v1 (added when the address has no path), for the agents that take OpenAI-style addresses. */
function v1(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path || "/v1"}`;
}

/** The address without a trailing /v1, for Claude Code, which adds `/v1/messages` itself. */
function root(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}`;
}

/**
 * The key to send: the one `keyEnv` names when that variable is set, else the app's own (`appKey`, kept in the Mac's Keychain),
 * else a stand-in for a server that checks none.
 */
function keyOf(model: PrivateModel, env: Env, appKey: string | null): string {
  return (model.keyEnv && env[model.keyEnv]) || appKey || "private";
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/**
 * The route for running `harness` against the private model, with its files written under `dir`. `model` must have passed
 * `privateProblem` for `harness`. Throws for a harness that can't take one.
 */
export function privateRoute(
  harness: string,
  model: PrivateModel,
  dir: string,
  env: Env = process.env,
  appKey: string | null = null,
): PrivateRoute {
  const url = parseUrl(model.baseUrl);
  if (!url) throw new Error(`Not an address: ${model.baseUrl}`);
  const key = keyOf(model, env, appKey);
  const id = model.model.trim();
  const base = { model: id, host: url.hostname };

  if (harness === "pi") {
    const agentDir = join(dir, "pi-agent");
    writeJson(join(agentDir, "models.json"), {
      providers: {
        private: {
          baseUrl: v1(url),
          api: "openai-completions",
          apiKey: key,
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
          models: [{ id, name: id, contextWindow: model.contextWindow, maxTokens: Math.min(8_192, Math.floor(model.contextWindow / 4)) }],
        },
      },
    });
    return {
      ...base,
      args: ["--provider", "private"],
      env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" },
    };
  }

  if (harness === "opencode") {
    const file = join(dir, "opencode.json");
    writeJson(file, {
      $schema: "https://opencode.ai/config.json",
      provider: {
        private: {
          npm: "@ai-sdk/openai-compatible",
          name: "Private model",
          options: { baseURL: v1(url), apiKey: key },
          models: { [id]: { name: id, tools: true, limit: { context: model.contextWindow, output: Math.min(8_192, Math.floor(model.contextWindow / 4)) } } },
        },
      },
      enabled_providers: ["private"],
      autoupdate: false,
      share: "disabled",
    });
    return {
      model: `private/${id}`,
      host: url.hostname,
      args: [],
      env: {
        OPENCODE_CONFIG: file,
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_SHARE: "1",
        OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      },
    };
  }

  if (harness === "claude") {
    const home = join(dir, "claude-home");
    mkdirSync(home, { recursive: true });
    return {
      ...base,
      args: [],
      env: {
        ANTHROPIC_BASE_URL: root(url),
        ANTHROPIC_AUTH_TOKEN: key,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_DEFAULT_OPUS_MODEL: id,
        ANTHROPIC_DEFAULT_SONNET_MODEL: id,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: id,
        CLAUDE_CODE_SUBAGENT_MODEL: id,
        CLAUDE_CONFIG_DIR: home,
        // Everything Claude Code would send its maker besides the model's own requests: updates, telemetry, error reports, surveys.
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_TELEMETRY: "1",
        // A server that isn't Claude: no beta fields it would reject, no thinking blocks, and a steady first line so it can reuse its cache.
        CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
        CLAUDE_CODE_DISABLE_THINKING: "1",
      },
    };
  }

  if (harness === "codex") {
    const home = join(dir, "codex-home");
    mkdirSync(home, { recursive: true });
    const provider = `model_providers.private={name="Private model",base_url=${JSON.stringify(v1(url))},wire_api="responses",env_key="AVANZEL_PRIVATE_KEY"}`;
    return {
      ...base,
      args: [
        "-c", 'model_provider="private"',
        "-c", provider,
        "-c", 'model_reasoning_effort="low"',
        "-c", `model_context_window=${model.contextWindow}`,
        "-c", `model_auto_compact_token_limit=${Math.floor(model.contextWindow * 0.8)}`,
        "-c", "analytics.enabled=false",
        "-c", "feedback.enabled=false",
        "-c", "check_for_update_on_startup=false",
        "-c", 'web_search="disabled"',
        "--disable", "plugins",
      ],
      env: { CODEX_HOME: home, AVANZEL_PRIVATE_KEY: key },
    };
  }

  throw new Error(`${harness} can't run against a private model.`);
}
