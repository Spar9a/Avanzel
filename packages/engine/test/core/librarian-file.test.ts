import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../src/core/config.ts";
import { NoAgentError, errorLine } from "../../src/core/harness.ts";
import { Librarian } from "../../src/core/librarian.ts";
import { Vault } from "../../src/core/vault.ts";
import { AvanzelError, type Transcriber, type Transcript } from "../../src/types.ts";
import { FAKE_AGENT, NOW, binScripts, write } from "./helpers.ts";
import { fakeSettings, lstatOrNull, mode, only, read, recordRuns, tmp } from "./librarian-fixtures.ts";

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
      refused: [],
      commit: null,
      failure: null,
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

  it("fails a capture whose agent cannot be started, and still tries the next", async () => {
    // Picked because it is executable, but its interpreter is not, so running it is refused (EACCES). A missing agent
    // (ENOENT) is another matter: it fails every capture alike, and `file` rejects with it.
    const interpreter = write(tmp(), "bin/interpreter", "not a program\n");
    const agent = write(tmp(), "bin/agent", `#!${interpreter}\n`);
    chmodSync(agent, 0o755);
    const harnesses = { fake: { name: "fake", headless: [agent, "{prompt}"], interactive: [] } };
    librarian = new Librarian(vault, fakeSettings({ harnesses }), { clock: () => NOW });
    const first = librarian.captureText("first");
    const second = librarian.captureText("second");
    const outcomes = await librarian.file();
    expect(outcomes.map((outcome) => [outcome.captureId, outcome.ok])).toEqual([[first.id, false], [second.id, false]]);
    for (const { error, failure } of outcomes) {
      expect(error).toContain(`Could not start \`${agent}\``);
      expect(failure).toBeNull(); // not a run that failed, so there is nothing to classify
    }
    expect(vault.pending()).toEqual([first.path, second.path]);
  });

  it("rejects with the NoAgentError when the agent it picked is gone, and tries no other capture", async () => {
    const bin = binScripts(tmp(), { claude: "exit 0" });
    vi.stubEnv("PATH", bin); // no other agent of this Mac's is on it
    librarian = new Librarian(vault, { ...defaultSettings(), harness: "claude", timeoutSeconds: 30 }, { clock: () => NOW });
    const first = librarian.captureText("first");
    const second = librarian.captureText("second");
    expect(librarian.harness.name).toBe("claude"); // picked while it was there
    rmSync(join(bin, "claude"));
    const error: unknown = await librarian.file().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NoAgentError);
    expect(error).toMatchObject({ agent: "claude", message: "Could not start `claude`: it is not on your PATH." });
    expect(vault.pending()).toEqual([first.path, second.path]);
    expect(vault.logMentions(first.id)).toBe(false);
  });

  it("rejects with a NoAgentError that names none when no agent is installed, for a filing and for an ask", async () => {
    vi.stubEnv("PATH", binScripts(tmp(), {}));
    librarian = new Librarian(vault, { ...defaultSettings(), harness: "auto", timeoutSeconds: 30 }, { clock: () => NOW });
    const capture = librarian.captureText("Something to keep");
    const filing: unknown = await librarian.file().catch((caught: unknown) => caught);
    expect(filing).toBeInstanceOf(NoAgentError);
    expect(filing).toMatchObject({ agent: null });
    const asking: unknown = await librarian.ask("anything?").catch((caught: unknown) => caught);
    expect(asking).toBeInstanceOf(NoAgentError);
    expect(vault.pending()).toEqual([capture.path]);
  });

  it("says a capture hit a usage limit, and keeps it in the inbox", async () => {
    mode("limit");
    const capture = librarian.captureText("Something to keep");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toEqual({ kind: "limit", resetsAt: null, line: "You've hit your usage limit. Try again at 3:05 PM." });
    expect(outcome.archivedTo).toBeNull();
    expect(outcome.commit).toBeNull();
    expect(vault.pending()).toEqual([capture.path]);
    expect(vault.logMentions(capture.id)).toBe(false);
  });

  it("reads when Claude Code's usage limit resets from its stream", async () => {
    vi.stubEnv("PATH", binScripts(tmp(), { claude: `exec '${process.execPath}' '${FAKE_AGENT}' "$2"` })); // the stand-in, and no other agent
    vi.stubEnv("FAKE_AGENT_STREAM", "claude");
    vi.stubEnv("FAKE_AGENT_RESETS_AT", "1792532400");
    mode("limit");
    librarian = new Librarian(vault, { ...defaultSettings(), harness: "claude", timeoutSeconds: 30 }, { clock: () => NOW });
    const capture = librarian.captureText("Something to keep");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toEqual({ kind: "limit", resetsAt: 1792532400000, line: "Claude AI usage limit reached|1792532400" });
    expect(vault.pending()).toEqual([capture.path]);
  });

  it("classifies a failed filing by what the agent printed", async () => {
    mode("fail");
    librarian.captureText("Something to keep");
    expect((await only(librarian.file())).failure).toEqual({ kind: "signin", resetsAt: null, line: "agent crashed: not logged in" });
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
    expect(outcome.failure).toMatchObject({ kind: "other", resetsAt: null });
    expect(vault.pending()).toEqual([capture.path]);
    expect(vault.logMentions(capture.id)).toBe(false);
  });

  it("a run that finished without filing is other, whatever its reply says", async () => {
    // The reply talks of a usage limit, but only what a failed run printed is read for one.
    const reply = "You've hit your usage limit. Try again at 3:05 PM.";
    const talker = { name: "talker", headless: ["/bin/sh", "-c", `echo "${reply}"`, "{prompt}"], interactive: [] };
    librarian = new Librarian(vault, fakeSettings({ harness: "talker", harnesses: { talker } }), { clock: () => NOW });
    const capture = librarian.captureText("Something the agent ignores");
    const outcome = await only(librarian.file());
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe(`talker finished without filing anything. Its reply: ${reply}`);
    expect(outcome.failure).toEqual({ kind: "other", resetsAt: null, line: outcome.error });
    expect(vault.pending()).toEqual([capture.path]);
  });

  it("a run that finished without filing names a built-in agent as a person reads it, not by its command", async () => {
    // The library's own harness that takes a built-in's name is that agent to the person: Claude Code, not "claude".
    const claude = { name: "claude", headless: ["/bin/sh", "-c", "echo 'I would need permission to write files.'", "{prompt}"], interactive: [] };
    librarian = new Librarian(vault, fakeSettings({ harness: "claude", harnesses: { claude } }), { clock: () => NOW });
    librarian.captureText("Something the agent ignores");
    const outcome = await only(librarian.file());
    expect(outcome.error).toBe("Claude Code finished without filing anything. Its reply: I would need permission to write files.");
  });

  // Avanzel's own findings say why first: the capsule's card keeps about the first 100 characters of a line, and a capture's
  // name is long. The card and the evening review's digest already say which note it is.
  it("a capture the agent left a folder at the archive for is other, in Avanzel's words, why first", async () => {
    mode("folder-at-archive");
    const capture = librarian.captureText("blocked-archive notes");
    const outcome = await only(librarian.file());
    const problem = `The agent left a folder at raw/2026/10/${capture.id}.md, so the note could not be archived.`;
    expect(outcome).toMatchObject({ ok: false, error: problem, failure: { kind: "other", resetsAt: null, line: problem } });
  });

  it("a capture whose archive is behind a link of the owner's is other, in Avanzel's words, why first", async () => {
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    mkdirSync(vault.raw, { recursive: true });
    symlinkSync(outside, join(vault.raw, "2026")); // the owner's: the guard leaves it be
    const capture = librarian.captureText("harmless words");
    const outcome = await only(librarian.file());
    const problem = `A folder on the way to raw/2026/10/${capture.id}.md is a symlink, so the note could not be archived.`;
    expect(outcome).toMatchObject({ ok: false, error: problem, failure: { kind: "other", resetsAt: null, line: problem } });
    expect(readdirSync(outside)).toEqual([]); // nothing archived through it
    expect(vault.pending()).toEqual([capture.path]);
  });

  it("a capture the agent changed behind a symlinked inbox/ is other, in Avanzel's words, why first", async () => {
    mode("tamper"); // files it, then rewrites the capture
    const elsewhere = join(tmp(), "elsewhere");
    renameSync(vault.inbox, elsewhere);
    symlinkSync(elsewhere, vault.inbox);
    librarian.captureText("My exact words");
    const outcome = await only(librarian.file());
    const blocked = "A symlink in inbox/ kept Avanzel from putting back the words the agent changed.";
    expect(outcome).toMatchObject({ ok: false, error: blocked, failure: { kind: "other", resetsAt: null, line: blocked } });
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
    // The task that was planted and the one that was changed are the guard's to put back, not the filing's changes.
    expect(outcome.changes).toMatchObject({
      created: [`ideas/idea-${outcome.captureId}.md`],
      modified: ["index.md", "log.md"],
      deleted: [],
    });
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
    // The tasks looked gone while the link stood, and are put back: neither is a change of the filing's.
    expect(outcome.changes).toMatchObject({
      created: [`ideas/idea-${outcome.captureId}.md`],
      modified: ["index.md", "log.md"],
      deleted: [],
    });
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
    // The link stood in place of the log, and is gone: log.md is the guard's, and Avanzel's line comes after the changes.
    expect(outcome.changes).toMatchObject({ created: [`ideas/idea-${capture.id}.md`], modified: ["index.md"], deleted: [] });
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
    // The file looked gone, and a page looked new inside it, while it stood as a folder: neither is the filing's change.
    expect(outcome.changes).toMatchObject({
      created: [`ideas/idea-${outcome.captureId}.md`],
      modified: ["index.md", "log.md"],
      deleted: [],
    });
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
    expect(outcome.failure).toBeNull();
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

  it("tells the agent the terms of the owner's dictionary, never the heard-as words", async () => {
    const runs = recordRuns();
    const settings = fakeSettings();
    settings.voice = { ...settings.voice, dictionary: ["Ollama = Alema, Polymer", "Kowalczyk"] };
    librarian = new Librarian(vault, settings, { clock: () => NOW });
    librarian.captureText("A thought");
    await librarian.file();
    const prompt = runs()[0]?.prompt ?? "";
    expect(prompt).toContain("The owner uses these names and terms. Spell them exactly this way: Ollama, Kowalczyk.");
    expect(prompt).not.toContain("Alema");
  });

  it("says nothing of names when the dictionary is empty", async () => {
    const runs = recordRuns();
    librarian.captureText("A thought");
    await librarian.file();
    expect(runs()[0]?.prompt).not.toContain("The owner uses these names");
  });

  it("stops when cancelled, leaving the rest in the inbox", async () => {
    mode("slow-noisy");
    const runs = recordRuns();
    const first = librarian.captureText("first");
    const second = librarian.captureText("second");
    const controller = new AbortController();
    const filing = librarian.file(null, { signal: controller.signal });
    await vi.waitFor(() => expect(runs()).toHaveLength(1), { timeout: 10_000 }); // the agent has started
    controller.abort();
    const outcomes = await filing;
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
    // Nor does the echoed prompt make a limit or a sign-in of it.
    expect(outcome.failure).toEqual({ kind: "other", resetsAt: null, line: "ERROR: the model is not supported with this account" });
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
    expect(outcome.failure).toEqual({ kind: "timeout", resetsAt: null, line: "fake timed out after 1s" });
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

  it("keeps what was heard when the dictionary corrected the words, and nothing more when it did not", async () => {
    const corrected: Transcriber = {
      engine: "fake:asr",
      transcribe: async () => ({ text: "We tried Ollama", engine: "fake:asr", seconds: 1, heard: "We tried Alema" }),
    };
    librarian = new Librarian(vault, fakeSettings(), { transcriber: corrected, clock: () => NOW });
    const capture = await librarian.captureAudio(write(tmp(), "note.wav", "audio"), { source: "audio" });
    const text = read(capture!.path);
    expect(text).toMatch(/^heard: We tried Alema$/m);
    expect(text).toContain("---\n\nWe tried Ollama\n");

    librarian = new Librarian(vault, fakeSettings(), { transcriber: new FakeTranscriber("plain words"), clock: () => new Date(NOW.getTime() + 60_000) });
    const plain = await librarian.captureAudio(write(tmp(), "other.wav", "audio"), { source: "audio" });
    expect(read(plain!.path)).not.toContain("heard:");
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

  it("keeps what was heard of a spoken comment the dictionary corrected", () => {
    const capture = librarian.captureScreen({
      image: write(tmp(), "shot.png", "PNG"),
      comment: "Ask Kowalczyk about this",
      transcriber: "fake:asr",
      context: { app: "Preview", heard: "Ask Kowalkzik about this" },
    });
    const text = read(capture.path);
    expect(text).toMatch(/^app: Preview\nheard: Ask Kowalkzik about this\n/m);
    expect(text).toContain("---\n\nAsk Kowalczyk about this\n");
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

describe("captureCall", () => {
  const transcript = "You: Shall we ship on Friday?\n\nThem: Yes, I will send the contract tomorrow.";

  it("writes the transcript as a call capture, with the app and the length", () => {
    const capture = librarian.captureCall({ transcript, app: "Zoom", startedAt: NOW, seconds: 1834.6 });
    expect(capture).toEqual({
      id: "2026-10-20-140312-you-shall-we-ship-on",
      path: join(vault.inbox, "2026-10-20-140312-you-shall-we-ship-on.md"),
      source: "call",
    });
    expect(read(capture.path)).toBe(
      "---\n" +
        "id: 2026-10-20-140312-you-shall-we-ship-on\n" +
        "type: capture\n" +
        "source: call\n" +
        "created: 2026-10-20T14:03:12+04:00\n" +
        "app: Zoom\n" +
        "seconds: 1835\n" +
        "---\n" +
        "\n" +
        `${transcript}\n`,
    );
    expect(vault.pending()).toEqual([capture.path]);
  });

  it("leaves the app out when the call is everything the Mac plays, and dates the capture from the call's start", () => {
    const startedAt = new Date(NOW.getTime() - 3_600_000);
    const capture = librarian.captureCall({ transcript, startedAt, seconds: 90 });
    const text = read(capture.path);
    expect(text).toContain("created: 2026-10-20T13:03:12+04:00\nseconds: 90\n---\n");
    expect(text).not.toContain("app:");
    expect(text).not.toContain("audio:");
    expect(text).not.toContain("attachments:");
  });

  it("refuses an empty transcript", () => {
    expect(() => librarian.captureCall({ transcript: "  \n", startedAt: NOW, seconds: 5 })).toThrow(AvanzelError);
    expect(vault.pending()).toEqual([]);
  });

  it("asks the agent to file it as a call", async () => {
    const runs = recordRuns();
    librarian.captureCall({ transcript, app: "Zoom", startedAt: NOW, seconds: 60 });
    librarian.captureText("A plain thought");
    await librarian.file();
    const prompts = runs().map((run) => run.prompt);
    expect(prompts.filter((prompt) => prompt.includes("This capture is a call."))).toHaveLength(1);
    expect(prompts).toHaveLength(2); // the plain thought's prompt has no call note
  });
});
