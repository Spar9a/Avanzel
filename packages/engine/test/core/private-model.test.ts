import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings, loadSettings, saveSettings } from "../../src/core/config.ts";
import { NoAgentError, runHeadless, selectHarness } from "../../src/core/harness.ts";
import {
  apiOf,
  defaultPrivateModel,
  privateHarnesses,
  privateProblem,
  privateRoute,
  type PrivateModel,
} from "../../src/core/private-model.ts";
import { builtin, settingsWith } from "./harness-fixtures.ts";
import { binScripts, useTmp } from "./helpers.ts";

const tmp = useTmp();

const local = (over: Partial<PrivateModel> = {}): PrivateModel => ({
  enabled: true,
  baseUrl: "http://127.0.0.1:8765/v1",
  model: "mlx-community/Qwen3.5-4B-MLX-4bit",
  api: "chat",
  contextWindow: 65_536,
  keyEnv: "",
  ...over,
});

describe("which agent speaks which server", () => {
  it("lists pi and OpenCode for chat completions, Claude Code for Messages and Codex for Responses", () => {
    expect(privateHarnesses("chat")).toEqual(["pi", "opencode"]);
    expect(privateHarnesses("messages")).toEqual(["claude"]);
    expect(privateHarnesses("responses")).toEqual(["codex"]);
    expect(apiOf("pi")).toBe("chat");
    expect(apiOf("codex")).toBe("responses");
    expect(apiOf("cursor-agent")).toBeNull();
  });
});

describe("privateProblem", () => {
  it("passes a local server with an agent that speaks it", () => {
    expect(privateProblem(local(), "pi")).toBeNull();
    expect(privateProblem(local({ api: "messages" }), "claude")).toBeNull();
  });

  it("refuses an address that isn't http or https", () => {
    expect(privateProblem(local({ baseUrl: "" }), "pi")).toMatch(/http:\/\/ or https:\/\//);
    expect(privateProblem(local({ baseUrl: "ftp://x" }), "pi")).toMatch(/http:\/\/ or https:\/\//);
    expect(privateProblem(local({ baseUrl: "127.0.0.1:8080" }), "pi")).toMatch(/http:\/\/ or https:\/\//);
  });

  it("accepts plain http only on this Mac", () => {
    expect(privateProblem(local({ baseUrl: "http://localhost:1234/v1" }), "pi")).toBeNull();
    expect(privateProblem(local({ baseUrl: "http://llm.internal:8000/v1" }), "pi")).toMatch(/https/);
    expect(privateProblem(local({ baseUrl: "https://llm.internal/v1" }), "pi")).toBeNull();
  });

  it("wants a model name and a sensible context size", () => {
    expect(privateProblem(local({ model: "  " }), "pi")).toMatch(/model/);
    expect(privateProblem(local({ contextWindow: 100 }), "pi")).toMatch(/4096/);
  });

  it("names the agents that fit when the chosen one doesn't", () => {
    expect(privateProblem(local({ api: "responses" }), "pi")).toBe("A server that speaks OpenAI Responses works with codex.");
    expect(privateProblem(local(), "claude")).toBe("A server that speaks OpenAI chat completions works with pi or opencode.");
    expect(privateProblem(local(), "gemini")).toMatch(/pi or opencode/);
  });
});

describe("privateRoute", () => {
  it("pi: a models.json of the run's own, the provider's name, and no startup traffic", () => {
    const route = privateRoute("pi", local({ keyEnv: "KEY" }), tmp(), { KEY: "sekret" });
    expect(route.model).toBe("mlx-community/Qwen3.5-4B-MLX-4bit");
    expect(route.args).toEqual(["--provider", "private"]);
    expect(route.env.PI_CODING_AGENT_DIR).toBe(join(tmp(), "pi-agent"));
    expect(route.env.PI_OFFLINE).toBe("1");
    expect(route.host).toBe("127.0.0.1");
    const models = JSON.parse(readFileSync(join(tmp(), "pi-agent", "models.json"), "utf8"));
    expect(models.providers.private).toMatchObject({
      baseUrl: "http://127.0.0.1:8765/v1",
      api: "openai-completions",
      apiKey: "sekret",
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    });
    expect(models.providers.private.models[0]).toMatchObject({ id: "mlx-community/Qwen3.5-4B-MLX-4bit", contextWindow: 65_536 });
  });

  it("adds /v1 to an address with no path, and keeps one that has a path", () => {
    expect(JSON.parse(readFileSync(join(privateRouteDir(local({ baseUrl: "http://127.0.0.1:8080" })), "pi-agent", "models.json"), "utf8")).providers.private.baseUrl).toBe(
      "http://127.0.0.1:8080/v1",
    );
    expect(JSON.parse(readFileSync(join(privateRouteDir(local({ baseUrl: "https://h.example/openai/v1/" })), "pi-agent", "models.json"), "utf8")).providers.private.baseUrl).toBe(
      "https://h.example/openai/v1",
    );
  });

  it("sends the app's own key when no variable is set, and the variable's value when there is one", () => {
    privateRoute("pi", local({ keyEnv: "KEY" }), tmp(), {}, "from-keychain");
    expect(JSON.parse(readFileSync(join(tmp(), "pi-agent", "models.json"), "utf8")).providers.private.apiKey).toBe("from-keychain");
    const other = join(tmp(), "other");
    privateRoute("pi", local({ keyEnv: "KEY" }), other, { KEY: "from-env" }, "from-keychain");
    expect(JSON.parse(readFileSync(join(other, "pi-agent", "models.json"), "utf8")).providers.private.apiKey).toBe("from-env");
    expect(privateRoute("codex", local({ api: "responses" }), join(tmp(), "c"), {}, "from-keychain").env.AVANZEL_PRIVATE_KEY).toBe("from-keychain");
  });

  it("sends a stand-in key to a server that needs none", () => {
    privateRoute("pi", local(), tmp(), {});
    expect(JSON.parse(readFileSync(join(tmp(), "pi-agent", "models.json"), "utf8")).providers.private.apiKey).toBe("private");
  });

  it("OpenCode: a config file with only the private provider, and its own switches off", () => {
    const route = privateRoute("opencode", local(), tmp());
    expect(route.model).toBe("private/mlx-community/Qwen3.5-4B-MLX-4bit");
    expect(route.env.OPENCODE_CONFIG).toBe(join(tmp(), "opencode.json"));
    expect(route.env.OPENCODE_DISABLE_MODELS_FETCH).toBe("1");
    const config = JSON.parse(readFileSync(route.env.OPENCODE_CONFIG as string, "utf8"));
    expect(config.enabled_providers).toEqual(["private"]);
    expect(config.provider.private.options.baseURL).toBe("http://127.0.0.1:8765/v1");
    expect(config.provider.private.models["mlx-community/Qwen3.5-4B-MLX-4bit"].limit.context).toBe(65_536);
  });

  it("Claude Code: the address without /v1, the model for every tier, a config folder of its own and the traffic switch", () => {
    const route = privateRoute("claude", local({ api: "messages", baseUrl: "http://127.0.0.1:1234/v1", keyEnv: "K" }), tmp(), { K: "tok" });
    expect(route.model).toBe("mlx-community/Qwen3.5-4B-MLX-4bit");
    expect(route.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:1234",
      ANTHROPIC_AUTH_TOKEN: "tok",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "mlx-community/Qwen3.5-4B-MLX-4bit",
      CLAUDE_CODE_SUBAGENT_MODEL: "mlx-community/Qwen3.5-4B-MLX-4bit",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
    expect(existsSync(route.env.CLAUDE_CONFIG_DIR as string)).toBe(true);
  });

  it("Codex: Responses, the key by variable name, a home of its own, analytics and plugins off", () => {
    const route = privateRoute("codex", local({ api: "responses", contextWindow: 50_000, keyEnv: "K" }), tmp(), { K: "tok" });
    expect(route.env).toEqual({ CODEX_HOME: join(tmp(), "codex-home"), AVANZEL_PRIVATE_KEY: "tok" });
    const args = route.args.join(" ");
    expect(args).toContain('wire_api="responses"');
    expect(args).toContain('base_url="http://127.0.0.1:8765/v1"');
    expect(args).toContain('env_key="AVANZEL_PRIVATE_KEY"');
    expect(args).toContain("model_context_window=50000");
    expect(args).toContain("model_auto_compact_token_limit=40000");
    expect(args).toContain("analytics.enabled=false");
    expect(args).toContain("--disable plugins");
  });

  it("refuses an agent that can't run against a private model", () => {
    expect(() => privateRoute("gemini", local(), tmp())).toThrow(/can't run against a private model/);
  });
});

/** A folder of its own for a route that a test reads the files of. */
function privateRouteDir(model: PrivateModel): string {
  const dir = join(tmp(), `route-${Math.random().toString(36).slice(2)}`);
  privateRoute("pi", model, dir);
  return dir;
}

describe("the library's private settings", () => {
  it("start off, and round-trip through config.toml", () => {
    expect(defaultSettings().private).toEqual(defaultPrivateModel());
    expect(defaultPrivateModel().enabled).toBe(false);
    const settings = settingsWith({ private: local({ api: "responses", keyEnv: "LLM_KEY", model: 'a "b"' }) });
    saveSettings(tmp(), settings);
    expect(loadSettings(tmp()).private).toEqual(settings.private);
  });
});

describe("selecting the agent with a private model on", () => {
  it("Automatic picks among the agents that speak the server, and says what is needed when none is installed", () => {
    vi.stubEnv("PATH", binScripts(tmp(), { pi: "exit 0", claude: "exit 0" }));
    expect(selectHarness(settingsWith({ private: local() })).name).toBe("pi");
    expect(selectHarness(settingsWith({ private: local({ api: "messages" }) })).name).toBe("claude");
    expect(() => selectHarness(settingsWith({ private: local({ api: "responses" }) }))).toThrow(NoAgentError);
    expect(() => selectHarness(settingsWith({ private: local({ api: "responses" }) }))).toThrow(/OpenAI Responses needs one of: codex/);
  });

  it("still takes the agent that was named", () => {
    vi.stubEnv("PATH", binScripts(tmp(), { pi: "exit 0", opencode: "exit 0" }));
    expect(selectHarness(settingsWith({ harness: "opencode", private: local() })).name).toBe("opencode");
  });
});

describe("a run with a private model", () => {
  // A stand-in agent that prints its arguments and the variables the route sets, one per line.
  const printing = 'for a in "$@"; do echo "arg=$a"; done; echo "base=$ANTHROPIC_BASE_URL"; echo "key=$AVANZEL_PRIVATE_KEY"; echo "noproxy=$NO_PROXY"; echo "cfg=$PI_CODING_AGENT_DIR"';

  it("puts the route's flags after the command and its variables in the run's environment", async () => {
    vi.stubEnv("PATH", binScripts(tmp(), { pi: printing }));
    vi.stubEnv("LLM_KEY", "sekret");
    vi.stubEnv("HTTPS_PROXY", "http://proxy.example:3128");
    const result = await runHeadless(builtin("pi"), "file it", tmp(), {
      write: true,
      timeoutSeconds: 30,
      private: local({ keyEnv: "LLM_KEY" }),
    });
    const lines = result.output.split("\n");
    expect(lines.slice(0, 4)).toEqual(["arg=-p", "arg=--provider", "arg=private", "arg=--no-session"]);
    expect(lines).toContain("arg=--model");
    expect(lines).toContain("arg=mlx-community/Qwen3.5-4B-MLX-4bit");
    expect(lines.at(-2)).toContain("127.0.0.1"); // the server is reached directly, whatever proxy the environment names
    expect(lines.at(-1)).toMatch(/^cfg=.*pi-agent$/);
  });

  it("gives Codex its key under the name the provider reads", async () => {
    vi.stubEnv("PATH", binScripts(tmp(), { codex: printing }));
    vi.stubEnv("LLM_KEY", "sekret");
    const result = await runHeadless(builtin("codex"), "file it", tmp(), {
      write: false,
      timeoutSeconds: 30,
      private: local({ api: "responses", keyEnv: "LLM_KEY" }),
    });
    expect(result.output).toContain("key=sekret");
    expect(result.output).toContain("arg=exec");
    expect(result.output).toContain('arg=model_provider="private"');
  });

  it("gives a run the app's own key without putting it in the process environment", async () => {
    vi.stubEnv("PATH", binScripts(tmp(), { codex: printing }));
    const result = await runHeadless(builtin("codex"), "file it", tmp(), {
      write: false,
      timeoutSeconds: 30,
      private: local({ api: "responses" }),
      privateKey: "from-keychain",
    });
    expect(result.output).toContain("key=from-keychain");
    expect(process.env.AVANZEL_PRIVATE_KEY).toBeUndefined();
  });

  it("changes nothing when the private model is off", async () => {
    vi.stubEnv("PATH", binScripts(tmp(), { pi: printing }));
    const result = await runHeadless(builtin("pi"), "file it", tmp(), {
      write: true,
      timeoutSeconds: 30,
      model: "own/model",
      private: local({ enabled: false }),
    });
    expect(result.output).not.toContain("arg=--provider");
    expect(result.output).toContain("arg=own/model");
  });

  it("stops with the sentence that says what is wrong, before any agent starts", async () => {
    vi.stubEnv("PATH", binScripts(tmp(), { claude: printing }));
    await expect(
      runHeadless(builtin("claude"), "x", tmp(), { write: false, timeoutSeconds: 30, private: local() }),
    ).rejects.toThrow("Private model: A server that speaks OpenAI chat completions works with pi or opencode.");
  });
});
