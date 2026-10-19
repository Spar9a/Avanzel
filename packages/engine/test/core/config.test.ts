import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  loadSettings,
  rememberVault,
  resolveVault,
  saveSettings,
  userConfigPath,
  type Settings,
} from "../../src/core/config.ts";
import { AvanzelError } from "../../src/types.ts";
import { thrownBy, useTmp, write } from "./helpers.ts";

const tmp = useTmp();

function homeEnv(): { home: string; env: Record<string, string> } {
  const home = join(tmp(), "home");
  mkdirSync(home, { recursive: true });
  return { home, env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") } };
}

function folder(name: string): string {
  const path = join(tmp(), name);
  mkdirSync(path, { recursive: true });
  return path;
}

describe("resolveVault", () => {
  it("prefers explicit, then $AVANZEL_VAULT, then the nearest .avanzel, then the remembered one, then ~/Avanzel", () => {
    const { home, env } = homeEnv();
    const elsewhere = folder("elsewhere");
    expect(resolveVault(undefined, { cwd: elsewhere, env })).toBe(join(home, "Avanzel"));

    const remembered = join(tmp(), "remembered");
    rememberVault(remembered, env);
    expect(resolveVault(undefined, { cwd: elsewhere, env })).toBe(remembered);

    folder("marked/.avanzel");
    const marked = join(tmp(), "marked");
    const inside = folder("marked/goals");
    expect(resolveVault(undefined, { cwd: inside, env })).toBe(marked);

    const fromEnv = join(tmp(), "from-env");
    const withVar = { ...env, AVANZEL_VAULT: fromEnv };
    expect(resolveVault(undefined, { cwd: inside, env: withVar })).toBe(fromEnv);

    const explicit = join(tmp(), "explicit");
    expect(resolveVault(explicit, { cwd: inside, env: withVar })).toBe(explicit);
  });

  it("expands ~ to the home folder", () => {
    const { home, env } = homeEnv();
    expect(resolveVault("~/notes", { cwd: tmp(), env })).toBe(join(home, "notes"));
  });

  it("remembers an awkward path and finds it again", () => {
    const { home, env } = homeEnv();
    const target = join(tmp(), 'My Brain "2" \\ дом');
    rememberVault(target, env);
    expect(userConfigPath(env)).toBe(join(home, ".config", "avanzel", "config.toml"));
    expect(resolveVault(undefined, { cwd: folder("elsewhere"), env })).toBe(target);
  });
});

describe("loadSettings", () => {
  it("falls back to the defaults when there is no config", () => {
    const settings = loadSettings(tmp());
    expect(settings).toEqual(defaultSettings());
    expect(settings.voice.model).toBe("nemo-parakeet-tdt-0.6b-v3");
    expect(settings).toEqual({
      harness: "auto",
      timeoutSeconds: 900,
      autoCommit: true,
      models: {},
      harnesses: {},
      voice: {
        backend: "onnx-asr",
        model: "nemo-parakeet-tdt-0.6b-v3",
        quantization: "int8",
        command: [],
        maxRecordSeconds: 600,
      },
    });
  });

  it("reads a custom harness, models and the voice table", () => {
    write(
      tmp(),
      ".avanzel/config.toml",
      `
harness = "fake"
timeout_seconds = 30
auto_commit = false

[models]
claude = "sonnet"

[voice]
backend = "command"
command = ["whisper-cli", "-f", "{audio}"]

[harnesses.fake]
headless = ["python", "agent.py", "{prompt}"]
interactive = ["python", "agent.py"]
`,
    );
    const settings = loadSettings(tmp());
    expect(settings.harness).toBe("fake");
    expect(settings.timeoutSeconds).toBe(30);
    expect(settings.autoCommit).toBe(false);
    expect(settings.models).toEqual({ claude: "sonnet" });
    expect(settings.voice.backend).toBe("command");
    expect(settings.voice.command).toEqual(["whisper-cli", "-f", "{audio}"]);
    expect(settings.voice.model).toBe("nemo-parakeet-tdt-0.6b-v3");
    expect(settings.harnesses).toEqual({
      fake: { name: "fake", headless: ["python", "agent.py", "{prompt}"], interactive: ["python", "agent.py"] },
    });
  });

  it.each([
    ['timeout_seconds = "soon"', "timeout_seconds"],
    ["timeout_seconds = 0", "timeout_seconds"],
    ["timeout_seconds = true", "timeout_seconds"],
    ["timeout_seconds = 1.5", "timeout_seconds"],
    ['auto_commit = "yes"', "auto_commit"],
    ['models = "sonnet"', "models"],
    ["[models]\nclaude = 3", "models.claude"],
    ['[harnesses.x]\nheadless = "agent {prompt}"', "harnesses.x.headless"],
    ['[harnesses.x]\nheadless = ["agent"]', "{prompt}"],
    ['[voice]\ncommand = "whisper"', "voice.command"],
    ["[voice]\nmax_record_seconds = -5", "voice.max_record_seconds"],
    ["harness = [", "config.toml"],
  ])("rejects %j naming %s", (body, needle) => {
    write(tmp(), ".avanzel/config.toml", body);
    const error = thrownBy(() => loadSettings(tmp()));
    expect(error).toBeInstanceOf(AvanzelError);
    expect(error.message).toContain(needle);
  });
});

describe("saveSettings", () => {
  const configPath = () => join(tmp(), ".avanzel", "config.toml");

  it("renders the defaults from the template, in the v0.1 key format", () => {
    saveSettings(tmp(), defaultSettings());
    const text = readFileSync(configPath(), "utf8");
    for (const line of [
      'harness = "auto"\n',
      "timeout_seconds = 900\n",
      "auto_commit = true\n",
      "[models]\n",
      '[voice]\n',
      'backend = "onnx-asr"\n',
      'model = "nemo-parakeet-tdt-0.6b-v3"\n',
      'quantization = "int8"\n',
      "max_record_seconds = 600\n",
    ]) {
      expect(text).toContain(line);
    }
    expect(text).not.toContain("$");
    expect(text).not.toMatch(/^command = /m);
    expect(text).not.toMatch(/^\[harnesses/m);
    expect(loadSettings(tmp())).toEqual(defaultSettings());
  });

  it("round-trips every setting, awkward strings included", () => {
    const settings: Settings = {
      harness: "my agent",
      timeoutSeconds: 30,
      autoCommit: false,
      models: { claude: "sonnet", "cursor-agent": "gpt-5", "my agent": 'model "x" \\ дом' },
      harnesses: {
        fake: { name: "fake", headless: ["node", "/tmp/agent \"x\".mjs", "--dir={vault}", "{prompt}"], interactive: [] },
        "my agent": { name: "my agent", headless: ["my-agent", "{prompt}"], interactive: ["my-agent", "--tui\u007f"] },
      },
      voice: {
        backend: "command",
        model: "nemo-parakeet-tdt-0.6b-v2",
        quantization: "",
        command: ["whisper-cli", "-m", "/models/ggml large.bin", "-f", "{audio}"],
        maxRecordSeconds: 120,
      },
    };
    saveSettings(tmp(), settings);
    expect(loadSettings(tmp())).toEqual(settings);
    expect(readFileSync(configPath(), "utf8")).toContain('[models]\nclaude = "sonnet"\ncursor-agent = "gpt-5"\n');
    expect(readFileSync(configPath(), "utf8")).toContain('\n\n[voice]\n');
  });

  it("refuses settings that would not load back, leaving the file alone", () => {
    saveSettings(tmp(), defaultSettings());
    const before = readFileSync(configPath(), "utf8");
    for (const bad of [
      { ...defaultSettings(), timeoutSeconds: 0 },
      { ...defaultSettings(), timeoutSeconds: 2.5 },
      { ...defaultSettings(), harnesses: { x: { name: "x", headless: ["agent"], interactive: [] } } },
    ]) {
      expect(() => saveSettings(tmp(), bad)).toThrow(AvanzelError);
    }
    expect(readFileSync(configPath(), "utf8")).toBe(before);
  });
});
