import { defaultSettings, privateHarnesses, PRIVATE_APIS } from "@avanzel/engine";
import { describe, expect, it } from "vitest";
import { patchedSettings } from "../src/main/dictionary-settings.ts";
import { privateInfo } from "../src/main/library-info.ts";
import { PRIVATE_AGENTS, PRIVATE_API_LABELS } from "../src/shared/ipc.ts";

describe("the private model's shared constants", () => {
  it("name the same agents for each kind of server as the engine, so Settings offers what the engine runs", () => {
    for (const kind of PRIVATE_APIS) expect(PRIVATE_AGENTS[kind]).toEqual(privateHarnesses(kind));
    expect(Object.keys(PRIVATE_API_LABELS).sort()).toEqual([...PRIVATE_APIS].sort());
  });
});

describe("patchedSettings with a private model", () => {
  const base = defaultSettings();

  it("changes only the fields it names, trimmed", () => {
    const next = patchedSettings(base, { private: { enabled: true, baseUrl: "  http://127.0.0.1:8765/v1 ", model: " m " } });
    expect(next.private).toEqual({
      enabled: true,
      source: "own",
      hostedModel: "qwen3.5-4b",
      baseUrl: "http://127.0.0.1:8765/v1",
      model: "m",
      api: "chat",
      contextWindow: 65_536,
      keyEnv: "",
    });
    const again = patchedSettings(next, { private: { api: "responses" } });
    expect(again.private).toMatchObject({ enabled: true, model: "m", api: "responses" });
  });

  it("leaves the private model alone when the patch has none", () => {
    expect(patchedSettings(base, { harness: "pi" }).private).toEqual(base.private);
    expect(patchedSettings(base, { harness: "pi" }).harness).toBe("pi");
  });

  it("takes the hosted model as the source, and refuses a source or a model that doesn't exist", () => {
    expect(patchedSettings(base, { private: { enabled: true, source: "hosted" } }).private).toMatchObject({ source: "hosted", hostedModel: "qwen3.5-4b" });
    expect(() => patchedSettings(base, { private: { source: "cloud" as never } })).toThrow(/your own server or on a model Avanzel hosts/);
    expect(() => patchedSettings(base, { private: { hostedModel: "nope" } })).toThrow(/doesn't host that model/);
  });

  it("refuses a kind of server or a context size the settings file would not read back", () => {
    expect(() => patchedSettings(base, { private: { api: "soap" as never } })).toThrow(/chat, messages or responses/);
    expect(() => patchedSettings(base, { private: { contextWindow: 0 } })).toThrow(/whole number/);
    expect(() => patchedSettings(base, { private: { contextWindow: 1.5 } })).toThrow(/whole number/);
  });
});

describe("privateInfo", () => {
  it("is off without settings, and says nothing is wrong", () => {
    expect(privateInfo(null, null)).toEqual({ private: defaultSettings().private, privateProblem: null });
  });

  it("names the problem that keeps a private model from running with the agent in use, only while it is on", () => {
    const on = patchedSettings(defaultSettings(), { private: { enabled: true, baseUrl: "http://127.0.0.1:8765/v1", model: "m" } });
    expect(privateInfo(on, "pi").privateProblem).toBeNull();
    expect(privateInfo(on, "claude").privateProblem).toBe("A server that speaks OpenAI chat completions works with pi or opencode.");
    expect(privateInfo(defaultSettings(), "claude").privateProblem).toBeNull();
    expect(privateInfo(on, null).privateProblem).toBeNull();
  });
});
