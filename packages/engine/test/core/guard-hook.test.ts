// The write guard of Claude Code's write runs: the guard a run serves on 127.0.0.1, which Claude Code's HTTP hook asks
// before each Write, Edit and NotebookEdit, and the --settings that carry the hook with the deny rules. Each question
// here is put as Claude Code puts it: a POST of the tool call to the hook's url, with the hook's headers.
import { mkdirSync, symlinkSync } from "node:fs";
import { Agent, request, type OutgoingHttpHeaders } from "node:http";
import type { Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTRUCTION_FILES,
  INSTRUCTION_REASON,
  KEEP_OUT,
  guardSettings,
  serveGuard,
  type Guard,
  type GuardHook,
} from "../../src/core/guard-hook.ts";
import { useTmp } from "./helpers.ts";

const tmp = useTmp();

/** The guards a test started: each is closed after it, as a run closes its own. */
const started: Guard[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((guard) => guard.close()));
});

interface Answer {
  status: number;
  body: string;
}

/**
 * The answer to a POST of `body` to `url` with `headers`, over a connection of its own (or `agent`'s). Rejects when no
 * connection can be made.
 */
function post(url: string, headers: OutgoingHttpHeaders, body: string, agent: Agent | false = false): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const asked = request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, agent }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    asked.on("error", reject);
    asked.end(body);
  });
}

/** A library at `<tmp>/<name>` with a few of its folders, and the guard of a run in it. */
async function library(name = "lib"): Promise<{ root: string; guard: Guard }> {
  const root = join(tmp(), name);
  for (const folder of ["inbox", "raw", "ideas", "reviews", "tasks", ".avanzel"]) {
    mkdirSync(join(root, folder), { recursive: true });
  }
  const guard = await serveGuard(root);
  started.push(guard);
  return { root, guard };
}

/** The guard's answer to `body`, posted as Claude Code posts it: to the hook's url, with the hook's headers. */
function ask(hook: GuardHook, body: string): Promise<Answer> {
  return post(hook.url, hook.headers, body);
}

/** The guard's answer to a Write of `filePath` by an agent working in `cwd`. */
function write(guard: Guard, filePath: string, cwd: string): Promise<Answer> {
  return ask(guard.hook, JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: filePath, content: "x" }, cwd }));
}

/** The reason the guard gave for a deny (the test fails for any other answer). */
async function refusal(answer: Promise<Answer>): Promise<string> {
  const { status, body } = await answer;
  expect(status).toBe(200);
  const { hookSpecificOutput } = JSON.parse(body) as { hookSpecificOutput: Record<string, unknown> };
  expect(hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
  return String(hookSpecificOutput.permissionDecisionReason);
}

/** A write the guard lets through: an empty 200, which Claude Code reads as nothing to say. */
const LET_THROUGH: Answer = { status: 200, body: "" };

/** The reason for a write to how the library is set up. */
const SETUP_REASON =
  "This is part of how the library is set up, and only its owner changes it. Write pages, index.md and log.md instead.";

describe("the guard's hook", () => {
  it("refuses a write to the owner's words, with the reason", async () => {
    const { root, guard } = await library();
    expect(await refusal(write(guard, join(root, "raw/2026/10/x.md"), root))).toContain("own words");
    expect(await refusal(write(guard, join(root, "inbox/2026-10-22-140312-x.md"), root))).toContain("own words");
  });

  it("refuses the library's settings", async () => {
    const { root, guard } = await library();
    for (const rel of [".avanzel/config.toml", "AGENTS.md", ".claude/settings.json"]) {
      expect(await refusal(write(guard, join(root, rel), root)), rel).toContain("only its owner changes it");
    }
    expect(await refusal(write(guard, join(root, "tasks/weekly.md"), root))).toContain("scheduled instructions");
  });

  it("lets pages, the index, the log and reviews through", async () => {
    const { root, guard } = await library();
    for (const rel of ["ideas/a.md", "index.md", "log.md", "reviews/2026-10-22-evening.md"]) {
      expect(await write(guard, join(root, rel), root), rel).toEqual(LET_THROUGH);
    }
  });

  it("refuses a write outside the library", async () => {
    const { root, guard } = await library();
    const reason = await refusal(write(guard, "/tmp/elsewhere.md", root));
    expect(reason).toBe(`This run may only write inside the library, ${root}.`);
  });

  it("follows a symlink before deciding", async () => {
    const { root, guard } = await library();
    symlinkSync(join(root, "raw"), join(root, "ideas/link"));
    expect(await refusal(write(guard, join(root, "ideas/link/x.md"), root))).toContain("own words");
    // A link to a file that isn't there yet: the write would create it in raw/.
    symlinkSync("../raw/new.md", join(root, "ideas/new.md"));
    expect(await refusal(write(guard, join(root, "ideas/new.md"), root))).toContain("own words");
    // Such a link whose target goes through another link before its "..": the disk follows that link first, so the
    // write would land in raw/, not in ideas/.
    mkdirSync(join(root, "raw/2026"));
    symlinkSync(join(root, "raw/2026"), join(root, "ideas/sub"));
    symlinkSync("sub/../planted.md", join(root, "ideas/a.md"));
    expect(await refusal(write(guard, join(root, "ideas/a.md"), root))).toContain("own words");
    // A link that leads out of the library.
    mkdirSync(join(tmp(), "elsewhere"));
    symlinkSync(join(tmp(), "elsewhere"), join(root, "ideas/out"));
    expect(await refusal(write(guard, join(root, "ideas/out/x.md"), root))).toContain(`inside the library, ${root}`);
    // A loop of links: the walk stops, and the write is decided by where it got to.
    symlinkSync("loop-b", join(root, "ideas/loop-a"));
    symlinkSync("loop-a", join(root, "ideas/loop-b"));
    expect(await write(guard, join(root, "ideas/loop-a"), root)).toEqual(LET_THROUGH);
  });

  it("refuses files Claude Code reads as instructions, in any folder", async () => {
    const { root, guard } = await library();
    for (const rel of ["ideas/CLAUDE.md", "topics/agents.md", "CLAUDE.local.md"]) {
      expect(await refusal(write(guard, join(root, rel), root)), rel).toBe(INSTRUCTION_REASON);
    }
    // Through a link: by the name the write lands on, and by the name the agent gave.
    symlinkSync("CLAUDE.md", join(root, "ideas/notes.md"));
    expect(await refusal(write(guard, join(root, "ideas/notes.md"), root))).toBe(INSTRUCTION_REASON);
    symlinkSync("page.md", join(root, "ideas/AGENTS.md"));
    expect(await refusal(write(guard, join(root, "ideas/AGENTS.md"), root))).toBe(INSTRUCTION_REASON);
  });

  it("refuses any dot path, at any depth", async () => {
    // .obsidian/ holds plugins Obsidian runs, with Node access, on its next launch.
    const { root, guard } = await library();
    for (const rel of [".obsidian/plugins/x/main.js", ".obsidian/community-plugins.json", ".gitignore", "ideas/.x/y.md"]) {
      expect(await refusal(write(guard, join(root, rel), root)), rel).toBe(SETUP_REASON);
    }
    // A dot inside a name doesn't count.
    expect(await write(guard, join(root, "ideas/a.b.md"), root)).toEqual(LET_THROUGH);
  });

  it("takes a relative path from the agent's folder", async () => {
    const { root, guard } = await library();
    expect(await refusal(write(guard, "raw/x.md", root))).toContain("own words");
    expect(await write(guard, "ideas/a.md", root)).toEqual(LET_THROUGH);
  });

  it("matches in any letter case", async () => {
    const { root, guard } = await library();
    expect(await refusal(write(guard, join(root, "RAW/x.md"), root))).toContain("own words");
    // A name not on disk yet, so the disk can't give its letter case: the rule still matches.
    expect(await refusal(write(guard, join(root, "Agents.md"), root))).toContain("only its owner changes it");
  });

  it("refuses a NotebookEdit by its notebook's path", async () => {
    const { root, guard } = await library();
    const body = JSON.stringify({ tool_name: "NotebookEdit", tool_input: { notebook_path: join(root, "raw/n.ipynb") }, cwd: root });
    expect(await refusal(ask(guard.hook, body))).toContain("own words");
  });

  it("stays quiet about input it doesn't understand", async () => {
    const { guard } = await library();
    expect(await ask(guard.hook, "not json")).toEqual(LET_THROUGH);
    expect(await ask(guard.hook, '{"tool_input":{}}')).toEqual(LET_THROUGH);
    expect(await ask(guard.hook, "null")).toEqual(LET_THROUGH);
  });

  it("works for a library with spaces, a quote and brackets in its path", async () => {
    const { root, guard } = await library("My Notes [Kate's]");
    expect(await refusal(write(guard, "raw/x.md", root))).toContain("own words");
    expect(await write(guard, join(root, "ideas/a.md"), root)).toEqual(LET_THROUGH);
  });

  it("decides by the library's real path, for a library reached through a link", async () => {
    const real = join(tmp(), "real");
    mkdirSync(join(real, "raw"), { recursive: true });
    const linked = join(tmp(), "linked");
    symlinkSync(real, linked);
    const guard = await serveGuard(linked);
    started.push(guard);
    expect(await refusal(write(guard, join(linked, "raw/x.md"), linked))).toContain("own words");
    expect(await write(guard, join(linked, "ideas/a.md"), linked)).toEqual(LET_THROUGH);
    expect(await refusal(write(guard, "/tmp/elsewhere.md", linked))).toBe(`This run may only write inside the library, ${real}.`);
  });
});

describe("the guard's server", () => {
  /** The port of a hook's url. */
  const portOf = (hook: GuardHook) => Number(new URL(hook.url).port);

  it("listens on 127.0.0.1 only, at a port and with a token of its own for each run", async () => {
    const first = await library("first");
    const second = await library("second");
    for (const { guard } of [first, second]) {
      const url = new URL(guard.hook.url);
      expect(url.protocol).toBe("http:");
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.pathname).toBe("/guard");
      expect(guard.hook.headers.Authorization).toMatch(/^Bearer [\w-]{43}$/); // 32 random bytes
    }
    expect(portOf(first.guard.hook)).not.toBe(portOf(second.guard.hook));
    expect(first.guard.hook.headers.Authorization).not.toBe(second.guard.hook.headers.Authorization);
    // Each answers its own run: the other's token is refused.
    const raw = JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(first.root, "raw/x.md") }, cwd: first.root });
    expect(await post(first.guard.hook.url, second.guard.hook.headers, raw)).toEqual({ status: 403, body: "" });
  });

  it("refuses a request without the run's token, and says nothing about the write", async () => {
    const { root, guard } = await library();
    const raw = JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(root, "raw/x.md") }, cwd: root });
    const token = guard.hook.headers.Authorization;
    for (const headers of [{}, { Authorization: "Bearer " }, { Authorization: `${token}x` }, { Authorization: token.toLowerCase() }, { "X-Token": token }]) {
      expect(await post(guard.hook.url, headers, raw), JSON.stringify(headers)).toEqual({ status: 403, body: "" });
    }
    // Only a POST to its own path is answered at all, token or not.
    const { origin } = new URL(guard.hook.url);
    expect(await post(`${origin}/other`, guard.hook.headers, raw)).toEqual({ status: 404, body: "" });
    const asGet = await new Promise<number>((resolve, reject) => {
      request(guard.hook.url, { headers: guard.hook.headers, agent: false }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      })
        .on("error", reject)
        .end();
    });
    expect(asGet).toBe(404);
    // With its token, the same request is answered.
    expect(await refusal(ask(guard.hook, raw))).toContain("own words");
  });

  it("refuses a request too large to be a write, before reading it", async () => {
    const { guard } = await library();
    const status = await new Promise<number>((resolve, reject) => {
      const asked = request(guard.hook.url, {
        method: "POST",
        headers: { ...guard.hook.headers, "Content-Length": String(64 * 1024 * 1024 + 1) },
        agent: false,
      }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      asked.on("error", reject);
      asked.write("{"); // the rest never comes: the answer doesn't wait for it
    });
    expect(status).toBe(413);
  });

  it("nothing listens once it is closed, and closing again does nothing", async () => {
    const { root, guard } = await library();
    expect(await write(guard, join(root, "ideas/a.md"), root)).toEqual(LET_THROUGH);
    await guard.close();
    await expect(write(guard, join(root, "ideas/a.md"), root)).rejects.toMatchObject({ code: "ECONNREFUSED" });
    await guard.close();
  });

  it("closing drops a connection Claude Code keeps open", async () => {
    const { root, guard } = await library();
    const agent = new Agent({ keepAlive: true });
    try {
      const body = JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(root, "ideas/a.md") }, cwd: root });
      expect(await post(guard.hook.url, guard.hook.headers, body, agent)).toEqual(LET_THROUGH);
      const kept = Object.values(agent.freeSockets).flat() as Socket[];
      expect(kept).toHaveLength(1); // the guard itself never closes an idle connection
      const dropped = new Promise((resolve) => kept[0]?.once("close", resolve));
      await guard.close();
      await dropped;
    } finally {
      agent.destroy();
    }
  });

  it("the hook it gives fails closed: Claude Code refuses the write when the guard doesn't answer", async () => {
    const { guard } = await library();
    expect(guard.hook).toEqual({
      type: "http",
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/guard$/),
      headers: { Authorization: expect.stringMatching(/^Bearer /) },
      timeout: 10,
      onFailure: "block",
    });
  });
});

describe("guardSettings", () => {
  const hook: GuardHook = { type: "http", url: "http://127.0.0.1:1/guard", headers: { Authorization: "Bearer t" }, timeout: 10, onFailure: "block" };
  const denyOf = (root: string): string[] => (JSON.parse(guardSettings(root, hook)) as { permissions: { deny: string[] } }).permissions.deny;

  it("denies the same paths to Edit, for the root and its real path", async () => {
    const { root, guard } = await library();
    const settings = JSON.parse(guardSettings(root, guard.hook)) as Record<string, unknown>;
    // Nothing else: -p silently drops settings that fail validation.
    expect(Object.keys(settings)).toEqual(["permissions", "hooks"]);
    expect(settings.permissions).toEqual({ deny: expect.any(Array) });
    const deny = denyOf(root);
    expect(deny).toContain(`Edit(//${root.slice(1)}/raw/**)`);
    expect(deny).toContain(`Edit(//${root.slice(1)}/raw)`);
    expect(deny).toContain(`Edit(//${root.slice(1)}/.claude/**)`);
    expect(deny).toContain(`Edit(//${root.slice(1)}/**/CLAUDE.md)`);
    // Every dot path, at any depth: a dot file or folder, and anything in a dot folder.
    expect(deny).toContain(`Edit(//${root.slice(1)}/**/.*)`);
    expect(deny).toContain(`Edit(//${root.slice(1)}/**/.*/**)`);
    expect(deny).toHaveLength(KEEP_OUT.length * 2 + 2 + INSTRUCTION_FILES.length);
    expect(settings.hooks).toEqual({ PreToolUse: [{ matcher: "Write|Edit|NotebookEdit", hooks: [guard.hook] }] });

    // A root reached through a symlink has its rules in both forms.
    const linked = join(tmp(), "linked");
    symlinkSync(root, linked);
    const both = denyOf(linked);
    expect(both).toContain(`Edit(//${linked.slice(1)}/AGENTS.md)`);
    expect(both).toContain(`Edit(//${root.slice(1)}/AGENTS.md)`);
    expect(both).toContain(`Edit(//${linked.slice(1)}/**/.*)`);
    expect(both).toHaveLength((KEEP_OUT.length * 2 + 2 + INSTRUCTION_FILES.length) * 2);

    // What a pattern reads as a wildcard is escaped in the root, and only there.
    const odd = join(tmp(), "My Notes [Kate's] *?");
    mkdirSync(odd);
    expect(denyOf(odd)).toContain(`Edit(//${tmp().slice(1)}/My Notes \\[Kate's\\] \\*\\?/raw/**)`);
    expect(denyOf(odd)).toContain(`Edit(//${tmp().slice(1)}/My Notes \\[Kate's\\] \\*\\?/**/.*/**)`);
  });
});
