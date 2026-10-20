import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { defaultSettings, loadSettings } from "../../src/core/config.ts";
import * as git from "../../src/core/git.ts";
import { SHELVES, Vault, isoLocal, parseElapsed, slugify } from "../../src/core/vault.ts";
import { AvanzelError } from "../../src/types.ts";
import { NOW, binScripts, envHome, gitIdentity, thrownBy, useTmp, write } from "./helpers.ts";

const tmp = useTmp();
let vault: Vault;

beforeEach(async () => {
  vault = await Vault.init(join(tmp(), "lib"), { git: false });
});

const read = (path: string) => readFileSync(path, "utf8");
const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory();
const names = (paths: string[]) => paths.map((path) => path.split("/").at(-1));

describe("Vault.init", () => {
  it("creates the layout, the rendered config and the default shadow tasks", () => {
    const root = vault.root;
    for (const name of ["AGENTS.md", "index.md", "log.md", "opencode.json", ".gitignore", ".avanzel/config.toml"]) {
      expect(statSync(join(root, name)).isFile(), name).toBe(true);
    }
    expect(read(join(root, "CLAUDE.md"))).toBe("@AGENTS.md\n");
    for (const folder of ["inbox", "raw", "reviews", "tasks", ...SHELVES]) expect(isDir(join(root, folder)), folder).toBe(true);
    expect(vault.exists()).toBe(true);
    expect(loadSettings(root)).toEqual(defaultSettings());
    expect(read(join(root, ".avanzel/config.toml"))).not.toContain("$");
    expect(JSON.parse(read(join(root, "opencode.json"))).permission.bash).toBe("deny");
    expect(readdirSync(join(root, "tasks")).sort()).toEqual(["evening-review.md", "weekly-review.md"]);
  });

  it("is idempotent and keeps the owner's edits", async () => {
    writeFileSync(join(vault.root, "AGENTS.md"), "my rules");
    writeFileSync(join(vault.root, "goals", "x.md"), "x");
    const again = await Vault.init(vault.root, { git: false });
    expect(read(join(again.root, "AGENTS.md"))).toBe("my rules");
    expect(read(join(again.root, "goals", "x.md"))).toBe("x");
  });

  it("is required before use", () => {
    const error = thrownBy(() => new Vault(join(tmp(), "nothing")).require());
    expect(error).toBeInstanceOf(AvanzelError);
    expect(error.message).toContain("avanzel init");
  });
});

describe("captures", () => {
  it("are Markdown with frontmatter in the inbox", () => {
    const capture = vault.newCapture("  I want to run a marathon next spring  ", { source: "text", now: NOW });
    expect(capture.id).toBe("2026-10-20-140312-i-want-to-run-a");
    expect(capture.source).toBe("text");
    expect(capture.path).toBe(join(vault.root, "inbox", `${capture.id}.md`));
    expect(read(capture.path)).toBe(
      "---\n" +
        `id: ${capture.id}\n` +
        "type: capture\n" +
        "source: text\n" +
        "created: 2026-10-20T14:03:12+04:00\n" +
        "---\n" +
        "\n" +
        "I want to run a marathon next spring\n",
    );
  });

  it("keep non-Latin words, with a timestamp-only id", () => {
    const text = "Хочу пробежать марафон весной";
    const capture = vault.newCapture(text, { source: "voice", now: NOW });
    expect(capture.id).toBe("2026-10-20-140312");
    expect(read(capture.path)).toContain(text);
  });

  it("are all kept when several processes capture in the same second", async () => {
    // Several captures in the same second (an agent noting two things in parallel, the app and the
    // CLI) compete for one id; non-Latin notes always do, because their ids are timestamp-only.
    // Large notes widen the window between choosing an id and the file appearing.
    const words = ["первая", "вторая", "третья", "четвёртая", "пятая", "шестая", "седьмая", "восьмая"];
    const texts = words.map((word) => `Мысль ${word}`); // no Latin letters or digits: every id is timestamp-only
    const vaultModule = new URL("../../src/core/vault.ts", import.meta.url).href;
    const racer = `
      const [root, text, startAt] = process.argv.slice(1);
      const { Vault } = await import(${JSON.stringify(vaultModule)});
      const now = new Date("2026-10-20T14:03:12+04:00");
      while (Date.now() < Number(startAt)) {} // spin, not sleep: macOS coalesces timer wake-ups
      new Vault(root).newCapture(text + " " + "ж".repeat(200_000), { source: "text", now });
    `;
    const startAt = Date.now() + 2000;
    const failures = await Promise.all(
      texts.map(
        (text) =>
          new Promise<string>((resolve) => {
            const child = spawn(process.execPath, ["--input-type=module", "-e", racer, vault.root, text, String(startAt)], {
              stdio: ["ignore", "ignore", "pipe"],
            });
            let stderr = "";
            child.stderr.on("data", (chunk) => (stderr += chunk));
            child.on("close", (code) => resolve(code === 0 ? "" : stderr || `exit ${code}`));
          }),
      ),
    );
    expect(failures.filter(Boolean)).toEqual([]);
    const bodies = vault.pending().map((path) => read(path).split("---\n\n")[1]);
    expect(bodies.sort()).toEqual(texts.map((text) => `${text} ${"ж".repeat(200_000)}\n`).sort());
    expect(readdirSync(vault.inbox).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("refuse empty text", () => {
    expect(() => vault.newCapture("   \n ", { source: "text", now: NOW })).toThrow(AvanzelError);
  });

  it("get a numbered id when the name is taken, in the inbox or the archive", () => {
    const first = vault.newCapture("same words", { source: "text", now: NOW });
    vault.archive(first.path);
    const second = vault.newCapture("same words", { source: "text", now: NOW });
    const third = vault.newCapture("same words", { source: "text", now: NOW });
    expect([first.id, second.id, third.id]).toEqual([
      "2026-10-20-140312-same-words",
      "2026-10-20-140312-same-words-2",
      "2026-10-20-140312-same-words-3",
    ]);
  });

  it("embed their recording", () => {
    const audio = vault.newAudioPath(NOW);
    expect(audio).toBe(join(vault.root, "raw", "audio", "2026", "10", "2026-10-20-140312.wav"));
    writeFileSync(audio, "RIFF");
    const capture = vault.newCapture("hello", {
      source: "voice",
      audio,
      transcriber: "onnx-asr:nemo-parakeet-tdt-0.6b-v3",
      now: NOW,
    });
    const text = read(capture.path);
    expect(text).toContain("audio: raw/audio/2026/10/2026-10-20-140312.wav\n");
    expect(text).toContain("transcriber: onnx-asr:nemo-parakeet-tdt-0.6b-v3\n");
    expect(text.endsWith("hello\n\n![[2026-10-20-140312.wav]]\n")).toBe(true);
  });

  it("embed screenshots and record where they came from", () => {
    const image = vault.newAttachmentPath(NOW, ".png");
    const capture = vault.newCapture("", {
      source: "screen",
      attachments: [image],
      context: { app: "Safari", title: "Avanzel: docs #1", url: "https://example.com/a?b=c" },
      now: NOW,
    });
    expect(capture.id).toBe("2026-10-20-140312");
    expect(read(capture.path)).toBe(
      "---\n" +
        "id: 2026-10-20-140312\n" +
        "type: capture\n" +
        "source: screen\n" +
        "created: 2026-10-20T14:03:12+04:00\n" +
        "app: Safari\n" +
        'title: "Avanzel: docs #1"\n' +
        "url: https://example.com/a?b=c\n" +
        "attachments: [raw/attachments/2026/10/2026-10-20-140312.png]\n" +
        "---\n" +
        "\n" +
        "(no comment)\n" +
        "\n" +
        "![[2026-10-20-140312.png]]\n",
    );
  });
});

describe("recordings and attachments", () => {
  it("get unique, claimed paths", () => {
    writeFileSync(vault.newAudioPath(NOW), "x");
    expect(vault.newAudioPath(NOW).split("/").at(-1)).toBe("2026-10-20-140312-2.wav");
    expect(vault.newAudioPath(NOW, ".m4a").split("/").at(-1)).toBe("2026-10-20-140312.m4a");
    const paths = Array.from({ length: 8 }, () => vault.newAudioPath(NOW));
    expect(new Set(paths).size).toBe(8);
    expect(paths.every((path) => existsSync(path))).toBe(true);
  });

  it("put screenshots under raw/attachments by year and month", () => {
    const first = vault.newAttachmentPath(NOW, ".png");
    expect(first).toBe(join(vault.root, "raw", "attachments", "2026", "10", "2026-10-20-140312.png"));
    expect(existsSync(first)).toBe(true);
    expect(vault.newAttachmentPath(NOW, ".png").split("/").at(-1)).toBe("2026-10-20-140312-2.png");
  });

  it("never claims a recording or screenshot path through a linked folder", () => {
    const outside = join(tmp(), "outside");
    mkdirSync(outside);
    mkdirSync(join(vault.raw, "audio"));
    symlinkSync(outside, join(vault.raw, "audio", "2026"));
    const recording = thrownBy(() => vault.newAudioPath(NOW));
    expect(recording).toBeInstanceOf(AvanzelError);
    expect(recording.message).toContain("raw/audio/2026");
    mkdirSync(join(vault.raw, "attachments", "2026"), { recursive: true });
    symlinkSync(outside, join(vault.raw, "attachments", "2026", "10"));
    const screenshot = thrownBy(() => vault.newAttachmentPath(NOW, ".png"));
    expect(screenshot).toBeInstanceOf(AvanzelError);
    expect(screenshot.message).toContain("raw/attachments/2026/10");
    expect(readdirSync(outside)).toEqual([]);
  });

  it("says what is wrong, and what to do, in words that hold for a file in the way as for a link", () => {
    writeFileSync(join(vault.raw, "audio"), "a file where the recordings' folder goes");
    const refused = thrownBy(() => vault.newAudioPath(NOW));
    expect(refused).toBeInstanceOf(AvanzelError);
    expect(refused.message).toBe(
      "Avanzel saves only into plain folders, and raw/audio/2026/10 isn't one: a link or a file is on its path. Remove it, then try again.",
    );
  });
});

describe("inbox and archive", () => {
  it("list text and audio waiting in the inbox, sorted", () => {
    for (const name of ["b.txt", "a.md", "memo.m4a", ".hidden.md", "notes.pdf", ".x.md.tmp"]) {
      writeFileSync(join(vault.inbox, name), "x");
    }
    expect(names(vault.pending())).toEqual(["a.md", "b.txt", "memo.m4a"]);
  });

  it("archive captures by year and month", () => {
    const capture = vault.newCapture("hello", { source: "text", now: NOW });
    const dest = vault.archive(capture.path);
    expect(dest).toBe(join(vault.root, "raw", "2026", "10", `${capture.id}.md`));
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(capture.path)).toBe(false);
  });

  it("archive an undated file under the current month", () => {
    const note = join(vault.inbox, "groceries.txt");
    writeFileSync(note, "milk");
    expect(vault.archive(note, NOW)).toBe(join(vault.root, "raw", "2026", "10", "groceries.txt"));
  });

  it("archive refuses a destination that is a folder with an AvanzelError", () => {
    const capture = vault.newCapture("hello", { source: "text", now: NOW });
    const taken = join(vault.raw, "2026", "10", `${capture.id}.md`);
    mkdirSync(taken, { recursive: true });
    const error = thrownBy(() => vault.archive(capture.path));
    expect(error).toBeInstanceOf(AvanzelError);
    expect(error.message).toContain(`raw/2026/10/${capture.id}.md`);
    expect(existsSync(capture.path)).toBe(true); // the capture stays in the inbox
    expect(isDir(taken)).toBe(true); // and the folder is left as it was
  });
});

describe("log", () => {
  it("appends lines and finds mentions", () => {
    expect(vault.logMentions("2026-10-20-140312")).toBe(false);
    vault.appendLog("file", "[[2026-10-20-140312]] → [[run-a-marathon]]", NOW);
    expect(read(vault.logPath).endsWith("\n- 2026-10-20 14:03 | file | [[2026-10-20-140312]] → [[run-a-marathon]]\n")).toBe(true);
    expect(vault.logMentions("2026-10-20-140312")).toBe(true);
    expect(vault.logMentions("2026-10-20-1403")).toBe(false);
  });

  it("copes with a missing trailing newline or a missing log", () => {
    writeFileSync(vault.logPath, "# Log\n- old line");
    vault.appendLog("review", "[[2026-10-20]]", NOW);
    expect(read(vault.logPath)).toBe("# Log\n- old line\n- 2026-10-20 14:03 | review | [[2026-10-20]]\n");
    rmSync(vault.logPath);
    vault.appendLog("review", "[[2026-10-20]]", NOW);
    expect(read(vault.logPath)).toBe("# Log\n- 2026-10-20 14:03 | review | [[2026-10-20]]\n");
  });
});

describe("shelfCounts", () => {
  it("counts pages per shelf, the standard shelves first", () => {
    write(vault.root, "goals/a.md", "a");
    write(vault.root, "goals/sub/b.md", "b");
    write(vault.root, "recipes/soup.md", "s");
    write(vault.root, "inbox/x.md", "x");
    const counts = vault.shelfCounts();
    expect(counts.goals).toBe(2);
    expect(counts.ideas).toBe(0);
    expect(counts.recipes).toBe(1);
    expect(Object.keys(counts).slice(0, SHELVES.length)).toEqual([...SHELVES]);
  });

  it("leaves out the inbox, sources, reviews and the tasks folder (tasks_folder_is_not_a_shelf)", () => {
    write(vault.root, "tasks/x.md", "x");
    write(vault.root, "reviews/2026-10-20.md", "r");
    write(vault.root, ".obsidian/y.md", "y");
    const counts = vault.shelfCounts();
    for (const special of ["inbox", "raw", "reviews", "tasks", ".obsidian"]) expect(counts).not.toHaveProperty(special);
  });
});

describe("withLock", () => {
  const owner = () => join(vault.lockDir, "owner");
  // This boot and this process's start, to the second, as an owner line records them.
  const bootSeconds = Math.round(Date.now() / 1000 - uptime());
  const startSeconds = Math.round(Date.now() / 1000 - process.uptime());
  function holdLock(content: string): void {
    mkdirSync(vault.lockDir, { recursive: true });
    writeFileSync(owner(), content);
  }

  async function deadPid(): Promise<number> {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((resolve) => child.on("exit", resolve));
    return child.pid ?? 999_999;
  }

  it("waits for another holder, says so once, then runs", async () => {
    holdLock(`${process.pid}\n`);
    const events: string[] = [];
    const run = vault.withLock(
      async () => {
        events.push("acquired");
        return 42;
      },
      () => events.push("waiting"),
    );
    await sleep(500);
    expect(events).toEqual(["waiting"]);
    rmSync(vault.lockDir, { recursive: true });
    expect(await run).toBe(42);
    expect(events).toEqual(["waiting", "acquired"]);
    expect(existsSync(vault.lockDir)).toBe(false);
  });

  it("waits while another process holds the lock, and takes it once that process lets go", async () => {
    const vaultModule = new URL("../../src/core/vault.ts", import.meta.url).href;
    const holder = `
      const { Vault } = await import(${JSON.stringify(vaultModule)});
      await new Vault(process.argv[1]).withLock(() => new Promise((resolve) => process.stdin.once("data", resolve)));
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", holder, vault.root], { stdio: ["pipe", "ignore", "pipe"] });
    onTestFinished(() => void child.kill());
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const exit = new Promise((resolve) => child.on("close", resolve));
    const holderPid = () => (existsSync(owner()) ? read(owner()).split(" ")[0] : "");
    await vi.waitFor(() => expect(holderPid(), stderr).toBe(String(child.pid)), { timeout: 10_000 });
    const onWait = vi.fn();
    const run = vault.withLock(() => "ran", onWait);
    await vi.waitFor(() => expect(onWait).toHaveBeenCalledTimes(1));
    child.stdin.end("done\n");
    expect(await run).toBe("ran");
    expect(await exit, stderr).toBe(0);
    expect(existsSync(vault.lockDir)).toBe(false);
  });

  it("holds the lock with this process's pid and releases it when the work fails", async () => {
    await expect(
      vault.withLock(() => {
        const fields = read(owner()).trim().split(" ");
        expect(fields).toHaveLength(4);
        expect(fields[0]).toBe(String(process.pid));
        expect(fields[3]).toHaveLength(36);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(vault.lockDir)).toBe(false);
  });

  it("leaves a lock that someone else took over in place", async () => {
    const theirs = `${process.pid} ${bootSeconds} ${startSeconds} ${randomUUID()}\n`;
    await vault.withLock(() => {
      rmSync(vault.lockDir, { recursive: true });
      holdLock(theirs);
    });
    expect(read(owner())).toBe(theirs);
  });

  it("takes over a lock whose holder is gone", async () => {
    holdLock(`${await deadPid()}\n`);
    const onWait = vi.fn();
    expect(await vault.withLock(() => "ran", onWait)).toBe("ran");
    expect(onWait).not.toHaveBeenCalled();
  });

  it("takes over a lock taken before the machine restarted (its pid may belong to someone else now)", async () => {
    holdLock(`${process.pid} 1\n`);
    const onWait = vi.fn();
    expect(await vault.withLock(() => "ran", onWait)).toBe("ran");
    expect(onWait).not.toHaveBeenCalled();
  });

  it("takes over a lock whose pid now belongs to a process started after the lock was taken", async () => {
    holdLock(`${process.pid} ${bootSeconds} ${startSeconds - 3600} ${randomUUID()}\n`);
    const onWait = vi.fn();
    expect(await vault.withLock(() => "ran", onWait)).toBe("ran");
    expect(onWait).not.toHaveBeenCalled();
  });

  it("waits on a lock held by a live process that started when it says", async () => {
    holdLock(`${process.pid} ${bootSeconds} ${startSeconds} ${randomUUID()}\n`);
    const events: string[] = [];
    const run = vault.withLock(
      () => events.push("acquired"),
      () => events.push("waiting"),
    );
    await sleep(500); // a few polls: a waiter that took the holder for a reused pid would have run the work by now
    expect(events).toEqual(["waiting"]);
    rmSync(vault.lockDir, { recursive: true });
    await run;
    expect(events).toEqual(["waiting", "acquired"]);
  });

  it("asks ps once per owner line, and counts the lock as held when ps fails or prints something it can't read", async () => {
    const calls = join(tmp(), "ps-calls");
    for (const ps of ["exit 1", "echo soon"]) {
      writeFileSync(calls, "");
      vi.stubEnv("PATH", binScripts(tmp(), { ps: `echo called >> '${calls}'\n${ps}` }));
      holdLock(`${process.pid} ${bootSeconds} ${startSeconds - 3600} ${randomUUID()}\n`);
      const onWait = vi.fn();
      const run = vault.withLock(() => "ran", onWait);
      await sleep(500); // a few polls, each of which could have asked ps again
      expect(onWait).toHaveBeenCalledTimes(1);
      expect(read(calls)).toBe("called\n");
      rmSync(vault.lockDir, { recursive: true });
      expect(await run).toBe("ran");
    }
  });

  it("waits on a lock folder whose owner is still being written, and takes it over once abandoned", async () => {
    mkdirSync(vault.lockDir, { recursive: true });
    const onWait = vi.fn();
    const run = vault.withLock(() => "ran", onWait);
    await sleep(300);
    expect(onWait).toHaveBeenCalledTimes(1);
    const longAgo = new Date(Date.now() - 60_000);
    utimesSync(vault.lockDir, longAgo, longAgo);
    expect(await run).toBe("ran");
  });

  it.skipIf(!git.available())("never ends up in git, even with a v0.1 .gitignore", async () => {
    envHome(tmp());
    gitIdentity();
    const root = join(tmp(), "versioned");
    const versioned = await Vault.init(root, { git: true });
    writeFileSync(join(root, ".gitignore"), ".avanzel/logs/\n.avanzel/lock\n");
    await versioned.withLock(async () => {
      writeFileSync(join(root, "goals", "a.md"), "a");
      expect(await git.commitAll(root, "while locked")).not.toBeNull();
    });
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
    expect(tracked).toContain("goals/a.md");
    expect(tracked).not.toContain("lock.d");
  });
});

describe("helpers", () => {
  it("slugify keeps Latin words and drops the rest", () => {
    expect(slugify("Café: déjà vu, again & again!")).toBe("cafe-deja-vu-again-again");
    expect(slugify("Привет мир")).toBe("");
  });

  it("isoLocal is exported for apps", () => {
    expect(isoLocal(NOW)).toBe("2026-10-20T14:03:12+04:00");
  });

  it("parseElapsed reads ps's elapsed time, [[dd-]hh:]mm:ss, in seconds", () => {
    expect(parseElapsed("05:07")).toBe(307);
    expect(parseElapsed("01:02:03")).toBe(3723);
    expect(parseElapsed("2-01:02:03")).toBe(176523);
    for (const text of ["", "soon", "7", "05:07:", "2-05:07", "1:02:03:04"]) expect(parseElapsed(text), text).toBeNull();
  });
});
