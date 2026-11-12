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
import { MAX_DICTIONARY_ENTRIES, plainLine } from "./dictionary.ts";
import { defaultPrivateModel, PRIVATE_APIS, PRIVATE_SOURCES, type PrivateApi, type PrivateModel, type PrivateSource } from "./private-model.ts";
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
  dictionary: string[];
  dictionarySoundAlike: boolean;
}

/**
 * The apps whose dictations are never kept by default: the password managers on a Mac, by bundle id (the words still go in). The app
 * keeps the same list (`DEFAULT_SKIP_APPS` in apps/mac/src/main/cursor-policy.ts) because it can't import from here and the engine
 * can't import from it; a test pins this one, and the two must stay equal. Enpass is listed under both ids it has shipped with. A
 * library whose config.toml was written before an id was added keeps the list it wrote.
 */
export const DEFAULT_DICTATION_SKIP_APPS: readonly string[] = [
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.bitwarden.desktop",
  "com.apple.keychainaccess",
  "com.apple.Passwords",
  "org.keepassxc.keepassxc",
  "com.lastpass.LastPass",
  "com.dashlane.Dashlane",
  "com.enpass.Enpass",
  "in.sinew.Enpass-Desktop",
];

/** The `[dictation]` table: dictating into any app, and whether the library keeps a day file of it. */
export interface DictationSettings {
  /** Also append every dictation to `raw/dictations/YYYY-MM-DD.md` in the library. The app's own history is kept either way. */
  log: boolean;
  /**
   * Bundle ids of apps whose dictations are never kept, neither in the app's history nor in the library: the words are still dictated
   * into them. Entries are trimmed; blanks and repeats are dropped.
   */
  skipApps: string[];
  /**
   * Websites whose dictations are never kept, neither in the app's history nor in the library, as the owner wrote them (the app turns
   * them into hosts): the words are still dictated into them.
   */
  skipSites: string[];
}

export interface Settings {
  private: PrivateModel;
  harness: string;
  timeoutSeconds: number;
  autoCommit: boolean;
  models: Record<string, string>;
  harnesses: Record<string, CustomHarness>;
  voice: VoiceSettings;
  dictation: DictationSettings;
}

export function defaultSettings(): Settings {
  return {
    private: defaultPrivateModel(),
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
      dictionary: [],
      dictionarySoundAlike: true,
    },
    dictation: { log: false, skipApps: [...DEFAULT_DICTATION_SKIP_APPS], skipSites: [] },
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
    private_enabled: String(settings.private.enabled),
    private_source: tomlString(settings.private.source),
    private_hosted_model: tomlString(settings.private.hostedModel),
    private_base_url: tomlString(settings.private.baseUrl),
    private_model: tomlString(settings.private.model),
    private_api: tomlString(settings.private.api),
    private_context_window: String(settings.private.contextWindow),
    private_key_env: tomlString(settings.private.keyEnv),
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
    voice_dictionary: voice.dictionary.length
      ? `dictionary = [\n${voice.dictionary.map((line) => `  ${tomlString(line)},\n`).join("")}]\n`
      : "dictionary = []\n",
    voice_dictionary_sound_alike: String(voice.dictionarySoundAlike),
    dictation_log: String(settings.dictation.log),
    dictation_skip_apps: tomlLines("skip_apps", settings.dictation.skipApps),
    dictation_skip_sites: tomlLines("skip_sites", settings.dictation.skipSites),
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

/** `key = [...]` with one entry to a line, so a long list stays readable and a hand edit is one line; `key = []` when empty. */
function tomlLines(key: string, values: readonly string[]): string {
  return values.length ? `${key} = [\n${values.map((value) => `  ${tomlString(value)},\n`).join("")}]\n` : `${key} = []\n`;
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
    dictionary: dictionaryLines(voiceData, path),
    dictionarySoundAlike: booleanValue(voiceData, "dictionary_sound_alike", defaults.voice.dictionarySoundAlike, path, "voice."),
  };
  const dictationData = table(data, "dictation", path);
  const dictation: DictationSettings = {
    log: booleanValue(dictationData, "log", defaults.dictation.log, path, "dictation."),
    skipApps: Object.hasOwn(dictationData, "skip_apps")
      ? dictationList(dictationData, "skip_apps", path)
      : defaults.dictation.skipApps,
    skipSites: dictationList(dictationData, "skip_sites", path),
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
  const privateData = table(data, "private", path);
  const api = stringValue(privateData, "api", defaults.private.api, path, "private.");
  if (!PRIVATE_APIS.includes(api as PrivateApi)) {
    throw new AvanzelError(`${path}: \`private.api\` must be "chat", "messages" or "responses"`);
  }
  const source = stringValue(privateData, "source", defaults.private.source, path, "private.");
  if (!PRIVATE_SOURCES.includes(source as PrivateSource)) {
    throw new AvanzelError(`${path}: \`private.source\` must be "own" or "hosted"`);
  }
  const privateModel: PrivateModel = {
    enabled: booleanValue(privateData, "enabled", defaults.private.enabled, path, "private."),
    source: source as PrivateSource,
    hostedModel: stringValue(privateData, "hosted_model", defaults.private.hostedModel, path, "private."),
    baseUrl: stringValue(privateData, "base_url", defaults.private.baseUrl, path, "private."),
    model: stringValue(privateData, "model", defaults.private.model, path, "private."),
    api: api as PrivateApi,
    contextWindow: positiveInt(privateData, "context_window", defaults.private.contextWindow, path, "private."),
    keyEnv: stringValue(privateData, "key_env", defaults.private.keyEnv, path, "private."),
  };
  return {
    private: privateModel,
    harness: stringValue(data, "harness", defaults.harness, path),
    timeoutSeconds: positiveInt(data, "timeout_seconds", defaults.timeoutSeconds, path),
    autoCommit: booleanValue(data, "auto_commit", defaults.autoCommit, path),
    models,
    harnesses,
    voice,
    dictation,
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

export const MAX_DICTIONARY_LINE_LENGTH = 200;

/** The `voice.dictionary` lines, refusing a list or a line longer than the dictionary can use. */
function dictionaryLines(data: Table, path: string): string[] {
  const lines = stringList(data, "dictionary", path, "voice.");
  if (lines.length > MAX_DICTIONARY_ENTRIES) {
    throw new AvanzelError(
      `${path}: \`voice.dictionary\` has ${lines.length} lines, and ${MAX_DICTIONARY_ENTRIES} is the most it can hold. ` +
        "Remove the lines you use least.",
    );
  }
  const long = lines.findIndex((line) => line.length > MAX_DICTIONARY_LINE_LENGTH);
  if (long >= 0) {
    throw new AvanzelError(
      `${path}: \`voice.dictionary\` line ${long + 1} is ${lines[long]?.length} characters, and ${MAX_DICTIONARY_LINE_LENGTH} is the most. ` +
        "Shorten it, or put some of its heard-as words on a second line for the same term.",
    );
  }
  return lines.map(plainLine);
}

/**
 * A `dictation` list (apps or sites), refusing a list or an entry longer than the dictionary's limits, as the dictionary is refused.
 * Entries are trimmed; blanks and repeats are dropped. Websites are not normalised here: the app does that.
 */
function dictationList(data: Table, key: string, path: string): string[] {
  const entries = stringList(data, key, path, "dictation.");
  if (entries.length > MAX_DICTIONARY_ENTRIES) {
    throw new AvanzelError(
      `${path}: \`dictation.${key}\` has ${entries.length} entries, and ${MAX_DICTIONARY_ENTRIES} is the most it can hold. ` +
        "Remove the ones you use least.",
    );
  }
  const long = entries.findIndex((entry) => entry.length > MAX_DICTIONARY_LINE_LENGTH);
  if (long >= 0) {
    throw new AvanzelError(
      `${path}: \`dictation.${key}\` entry ${long + 1} is ${entries[long]?.length} characters, and ${MAX_DICTIONARY_LINE_LENGTH} is the most. ` +
        "Shorten it, or check that it is a single name.",
    );
  }
  return [...new Set(entries.map((entry) => entry.trim()).filter((entry) => entry !== ""))];
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
