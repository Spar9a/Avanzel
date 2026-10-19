// Where the library lives and how it is configured.
//
// Vault resolution order: explicit path → $AVANZEL_VAULT → nearest parent folder holding `.avanzel/`
// → `vault = "..."` in the user config → `~/Avanzel`.
// Per-library settings live in `<vault>/.avanzel/config.toml` (same keys as the v0.1 CLI).

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse, TomlError } from "smol-toml";
import { AvanzelError, type VoiceOptions } from "../types.ts";
import { render } from "./templates.ts";

export const VAULT_MARKER = ".avanzel";
export const CONFIG_NAME = "config.toml";

export type Env = Readonly<Record<string, string | undefined>>;

/** An agent CLI the owner describes in config; `{prompt}` and `{vault}` are substituted. */
export interface CustomHarness {
  name: string;
  headless: string[];
  interactive: string[];
}

/** The `[voice]` table. */
export interface VoiceSettings extends VoiceOptions {
  maxRecordSeconds: number;
}

export interface Settings {
  harness: string;
  timeoutSeconds: number;
  autoCommit: boolean;
  models: Record<string, string>;
  harnesses: Record<string, CustomHarness>;
  voice: VoiceSettings;
}

export function defaultSettings(): Settings {
  return {
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
  };
}

export function userConfigPath(env: Env = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(home(env), ".config");
  return join(base, "avanzel", CONFIG_NAME);
}

export function resolveVault(
  explicit?: string | null,
  { cwd = process.cwd(), env = process.env }: { cwd?: string; env?: Env } = {},
): string {
  if (explicit) return absolute(explicit, cwd, env);
  if (env.AVANZEL_VAULT) return absolute(env.AVANZEL_VAULT, cwd, env);
  for (let folder = resolve(cwd); ; folder = dirname(folder)) {
    if (isDirectory(join(folder, VAULT_MARKER))) return folder;
    if (dirname(folder) === folder) break;
  }
  const remembered = readToml(userConfigPath(env)).vault;
  if (typeof remembered === "string" && remembered) return absolute(remembered, cwd, env);
  return join(home(env), "Avanzel");
}

export function rememberVault(vault: string, env: Env = process.env): void {
  const path = userConfigPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `vault = ${tomlString(absolute(vault, process.cwd(), env))}\n`, "utf8");
}

export function loadSettings(vaultRoot: string): Settings {
  const path = configPath(vaultRoot);
  return parseSettings(readToml(path), path);
}

/** Re-render `.avanzel/config.toml` from the template; refuses settings that would not load back. */
export function saveSettings(vaultRoot: string, settings: Settings): void {
  const path = configPath(vaultRoot);
  const text = renderConfig(settings);
  parseSettings(parseToml(text, path), path);
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(partial, text, "utf8");
    renameSync(partial, path);
  } finally {
    rmSync(partial, { force: true });
  }
}

function configPath(vaultRoot: string): string {
  return join(vaultRoot, VAULT_MARKER, CONFIG_NAME);
}

function renderConfig(settings: Settings): string {
  const { voice } = settings;
  return render("config.toml", {
    harness: tomlString(settings.harness),
    timeout_seconds: String(settings.timeoutSeconds),
    auto_commit: String(settings.autoCommit),
    models: Object.entries(settings.models)
      .map(([name, model]) => `${tomlKey(name)} = ${tomlString(model)}\n`)
      .join(""),
    voice_backend: tomlString(voice.backend),
    voice_model: tomlString(voice.model),
    voice_quantization: tomlString(voice.quantization),
    voice_command: voice.command.length ? `command = ${tomlArray(voice.command)}\n` : "",
    voice_max_record_seconds: String(voice.maxRecordSeconds),
    harnesses: Object.entries(settings.harnesses)
      .map(
        ([name, spec]) =>
          `\n[harnesses.${tomlKey(name)}]\nheadless = ${tomlArray(spec.headless)}\ninteractive = ${tomlArray(spec.interactive)}\n`,
      )
      .join(""),
  });
}

// --- TOML ---------------------------------------------------------------------------------------

type Table = Record<string, unknown>;

// A JSON string literal is also a valid TOML basic string, once DEL (allowed by JSON) is escaped.
function tomlString(value: string): string {
  return JSON.stringify(value).replaceAll("\u007f", "\\u007f");
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function readToml(path: string): Table {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return {};
    throw error;
  }
  return parseToml(text, path);
}

function parseToml(text: string, path: string): Table {
  try {
    return parse(text, { integersAsBigInt: true });
  } catch (error) {
    if (error instanceof TomlError) {
      const reason = error.message.split("\n")[0];
      throw new AvanzelError(`${path}: invalid TOML at line ${error.line}, column ${error.column}: ${reason}`);
    }
    throw error;
  }
}

function parseSettings(data: Table, path: string): Settings {
  const defaults = defaultSettings();
  const voiceData = table(data, "voice", path);
  const voice: VoiceSettings = {
    backend: stringValue(voiceData, "backend", defaults.voice.backend, path, "voice."),
    model: stringValue(voiceData, "model", defaults.voice.model, path, "voice."),
    quantization: stringValue(voiceData, "quantization", defaults.voice.quantization, path, "voice."),
    command: stringList(voiceData, "command", path, "voice."),
    maxRecordSeconds: positiveInt(voiceData, "max_record_seconds", defaults.voice.maxRecordSeconds, path, "voice."),
  };
  const models = Object.fromEntries(
    Object.entries(table(data, "models", path)).map(([name, model]) => {
      if (typeof model !== "string") throw new AvanzelError(`${path}: \`models.${name}\` must be a string`);
      return [name, model];
    }),
  );
  const harnesses = Object.fromEntries(
    Object.entries(table(data, "harnesses", path)).map(([name, spec]): [string, CustomHarness] => {
      if (!isTable(spec)) throw new AvanzelError(`${path}: \`harnesses.${name}\` must be a table`);
      const headless = stringList(spec, "headless", path, `harnesses.${name}.`);
      if (!headless.some((part) => part.includes("{prompt}"))) {
        throw new AvanzelError(`${path}: \`harnesses.${name}.headless\` must contain a {prompt} placeholder`);
      }
      return [name, { name, headless, interactive: stringList(spec, "interactive", path, `harnesses.${name}.`) }];
    }),
  );
  return {
    harness: stringValue(data, "harness", defaults.harness, path),
    timeoutSeconds: positiveInt(data, "timeout_seconds", defaults.timeoutSeconds, path),
    autoCommit: booleanValue(data, "auto_commit", defaults.autoCommit, path),
    models,
    harnesses,
    voice,
  };
}

function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function table(data: Table, key: string, path: string): Table {
  const value = Object.hasOwn(data, key) ? data[key] : {};
  if (!isTable(value)) throw new AvanzelError(`${path}: \`${key}\` must be a table`);
  return value;
}

function stringValue(data: Table, key: string, fallback: string, path: string, prefix = ""): string {
  if (!Object.hasOwn(data, key)) return fallback;
  const value = data[key];
  if (typeof value !== "string") throw new AvanzelError(`${path}: \`${prefix}${key}\` must be a string`);
  return value;
}

function booleanValue(data: Table, key: string, fallback: boolean, path: string, prefix = ""): boolean {
  if (!Object.hasOwn(data, key)) return fallback;
  const value = data[key];
  if (typeof value !== "boolean") throw new AvanzelError(`${path}: \`${prefix}${key}\` must be true or false`);
  return value;
}

function positiveInt(data: Table, key: string, fallback: number, path: string, prefix = ""): number {
  if (!Object.hasOwn(data, key)) return fallback;
  const value = data[key];
  if (typeof value !== "bigint") throw new AvanzelError(`${path}: \`${prefix}${key}\` must be a whole number`);
  if (value <= 0n) throw new AvanzelError(`${path}: \`${prefix}${key}\` must be greater than zero`);
  return Number(value);
}

function stringList(data: Table, key: string, path: string, prefix = ""): string[] {
  const value = Object.hasOwn(data, key) ? data[key] : [];
  if (!Array.isArray(value) || !value.every((part) => typeof part === "string")) {
    throw new AvanzelError(`${path}: \`${prefix}${key}\` must be a list of strings`);
  }
  return [...value];
}

// --- paths ---------------------------------------------------------------------------------------

function home(env: Env): string {
  return env.HOME || homedir();
}

function absolute(path: string, cwd: string, env: Env): string {
  const expanded = path === "~" || path.startsWith("~/") ? home(env) + path.slice(1) : path;
  return resolve(cwd, expanded);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
