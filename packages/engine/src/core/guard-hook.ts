// The write guard of Claude Code's write runs: a write to the owner's words (inbox/, raw/), their scheduled tasks or
// the library's settings, to any dot path (a file or folder whose name starts with ".", at any depth, such as
// .obsidian/, which holds plugins Obsidian runs), to a file Claude Code reads as instructions (INSTRUCTION_FILES, in
// any folder), or anywhere outside the library, is refused before it happens. Every such run gets `--settings` with
// deny rules for KEEP_OUT, dot paths and INSTRUCTION_FILES, and a PreToolUse hook that refuses the same writes and any
// outside the library, and tells the agent why. The deny rules hold in every permission mode, `--bare` included (which
// skips hooks, as `disableAllHooks` does); the hook adds the reasons and the check for outside, and follows symlinks
// before it decides.
//
// The hook is Claude Code's HTTP hook. Whatever starts the run serves the guard (`serveGuard`) on 127.0.0.1, at a port
// of its own, for as long as the run lasts, and refuses any request without the run's token. Claude Code posts each
// write to it and reads the answer. When the guard can't be reached, answers with an error or answers too late, Claude
// Code refuses the write (`onFailure: "block"`, from Claude Code 2.1.295). No program is installed or run for it, so
// nothing has to run Avanzel's own binary as Node. What any agent still changes among the protected paths is put back
// after every run (guard.ts).

import { randomBytes, timingSafeEqual } from "node:crypto";
import { readlinkSync, realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AvanzelError } from "../types.ts";

// The reasons are what the agent reads when it tries; they aren't UI copy.
const WORDS =
  "This file keeps the owner's own words exactly as they said them, and Avanzel archives the capture itself. " +
  "Leave inbox/ and raw/ as they are, and file into pages on the shelves.";
const TASKS = "tasks/ holds the owner's scheduled instructions, and only the owner changes them.";
const SETUP =
  "This is part of how the library is set up, and only its owner changes it. Write pages, index.md and log.md instead.";
const SETUP_PATHS = [
  ".avanzel", ".git", "AGENTS.md", "CLAUDE.md", "opencode.json", ".mcp.json",
  ".agents", ".claude", ".codex", ".cursor", ".gemini", ".opencode",
];

/** What no writing agent run may change, as library paths, each with the reason Claude Code reads when it tries. */
export const KEEP_OUT: readonly { path: string; reason: string }[] = [
  { path: "inbox", reason: WORDS },
  { path: "raw", reason: WORDS },
  { path: "tasks", reason: TASKS },
  ...SETUP_PATHS.map((path) => ({ path, reason: SETUP })),
];

/**
 * Files Claude Code reads as instructions, wherever they are: the library's own, and one in any folder it reads files
 * in. A writing run may not make or change one, so a capture can't plant instructions for later runs.
 */
export const INSTRUCTION_FILES: readonly string[] = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"];
/** The reason Claude Code reads when it tries to write one of INSTRUCTION_FILES that KEEP_OUT doesn't name. */
export const INSTRUCTION_REASON =
  "Claude Code reads a file with this name as instructions, so a page can't use it. Name the page differently.";

/** The reason for a write anywhere outside the library. */
function outsideReason(root: string): string {
  return `This run may only write inside the library, ${root}.`;
}

/** The path Claude Code posts the hook to, on the guard's own port. */
const HOOK_PATH = "/guard";
/** How long Claude Code waits for the guard's answer, in seconds, before it refuses the write. */
const HOOK_TIMEOUT_SECONDS = 10;
/** The most a request may carry: far more than any write Claude Code makes. A larger one is refused. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** The PreToolUse hook a write run's `--settings` carry, in the shape Claude Code reads. */
export interface GuardHook {
  type: "http";
  /** The guard's address: 127.0.0.1, its port, and HOOK_PATH. */
  url: string;
  /** The run's token, as `Authorization: Bearer <token>`. */
  headers: { Authorization: string };
  timeout: number;
  /** Claude Code refuses the write when the hook fails: no connection, an answer that isn't 2xx or JSON, or none in time. */
  onFailure: "block";
}

/** One run's guard while it listens. */
export interface Guard {
  /** The hook for the run's `--settings` (guardSettings), pointed at this guard and carrying its token. */
  readonly hook: GuardHook;
  /** Stops listening and drops every connection; nothing listens once it has resolved. Closing again does nothing. */
  close(): Promise<void>;
}

/**
 * Serves the guard of one write run in `root` on 127.0.0.1, at a port the system picks, with a token of its own, until
 * `close()`. Claude Code posts each Write, Edit and NotebookEdit of the run to it, as its hook. A request that isn't a
 * POST to HOOK_PATH with the run's token is refused and told nothing. The guard decides by the library's real path,
 * read now, and answers a write it refuses with Claude Code's deny and the reason; anything else it lets through without
 * a word, input it can't read included (the deny rules in the run's settings still hold). If its decision fails, it
 * answers with an error, and Claude Code refuses the write.
 */
export async function serveGuard(root: string): Promise<Guard> {
  const real = realPath(root);
  const outside = outsideReason(real);
  const token = randomBytes(32).toString("base64url");
  const authorization = `Bearer ${token}`;
  const server = createServer((request, response) => {
    void answer(request, response, authorization, (input) => refusal(input, real, outside));
  });
  // The guard never closes an idle connection itself, so no write can meet a connection it is closing (which Claude Code
  // would take as a failure, and refuse the write). Claude Code closes its own, and close() drops whatever is left.
  server.keepAliveTimeout = 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch((error: unknown) => {
    throw new AvanzelError(`Avanzel's write guard couldn't start: ${error instanceof Error ? error.message : String(error)}`);
  });
  // Whatever goes wrong once it listens (the system's limit on open files, say) fails only the request at hand, which
  // Claude Code then refuses. It never stops the process the guard runs in.
  server.on("error", () => {});
  server.unref(); // a run that never closes its guard doesn't keep the process alive
  const { port } = server.address() as AddressInfo;
  let closing: Promise<void> | null = null;
  return {
    hook: {
      type: "http",
      url: `http://127.0.0.1:${port}${HOOK_PATH}`,
      headers: { Authorization: authorization },
      timeout: HOOK_TIMEOUT_SECONDS,
      onFailure: "block",
    },
    close: () =>
      (closing ??= new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      })),
  };
}

/**
 * Answers one request to the guard: refused (404, or 403 without the run's token) before its body is read; else the
 * decision on the tool call it carries.
 */
async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  authorization: string,
  decide: (input: unknown) => string | null,
): Promise<void> {
  const refuse = (status: number) => void response.writeHead(status, { Connection: "close" }).end();
  if (request.method !== "POST" || request.url !== HOOK_PATH) return refuse(404);
  if (!sameText(request.headers.authorization, authorization)) return refuse(403);
  if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return refuse(413);
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return refuse(413); // a body sent without its length: what has come is let go
      chunks.push(chunk);
    }
    const reason = decide(parsed(Buffer.concat(chunks).toString("utf8")));
    if (reason === null) return void response.writeHead(200).end(); // nothing to say: the write may go ahead
    const decision = { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason };
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ hookSpecificOutput: decision }));
  } catch {
    // The request broke off, or the decision failed: an error, which Claude Code takes as a refusal.
    if (!response.headersSent) refuse(500);
    else response.destroy();
  }
}

/** Whether `given` is `expected`, compared in constant time. */
function sameText(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `text` as JSON, or undefined when it isn't JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Why the tool call `input` (the hook's JSON) is refused, or null when it may go ahead: a write to a path KEEP_OUT names,
 * to a dot path, to a file Claude Code reads as instructions, or outside the library, whose real path is `root`. A path
 * that isn't there gives no reason.
 */
function refusal(input: unknown, root: string, outside: string): string | null {
  const call = typeof input === "object" && input !== null ? (input as { tool_input?: unknown; cwd?: unknown }) : {};
  const tool = typeof call.tool_input === "object" && call.tool_input !== null ? (call.tool_input as Record<string, unknown>) : {};
  const path = tool.file_path ?? tool.notebook_path;
  if (typeof path !== "string") return null;
  const cwd = typeof call.cwd === "string" && call.cwd ? call.cwd : root;
  const given = resolve(cwd, path);
  const rel = relative(root, followed(given, { links: 40 }));
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return outside;
  const lower = rel.toLowerCase(); // the disk doesn't tell RAW/ from raw/
  const rule = KEEP_OUT.find((kept) => {
    const name = kept.path.toLowerCase();
    return lower === name || lower.startsWith(`${name}/`);
  });
  if (rule) return rule.reason;
  // Any other dot path, at any depth: a segment that starts with "." (a dot inside a name doesn't count, and a leading
  // dot has no letter case). No agent is asked to write one, and .obsidian/ holds plugins Obsidian runs.
  if (rel.split("/").some((segment) => segment.startsWith("."))) return SETUP;
  // A file Claude Code reads as instructions, in any folder: by the name the agent gave, or the one the write lands on.
  const names = [basename(given), basename(rel)].map((name) => name.toLowerCase());
  return INSTRUCTION_FILES.some((file) => names.includes(file.toLowerCase())) ? INSTRUCTION_REASON : null;
}

/**
 * Where a write to the absolute `path` would really go, every link on the way followed: the real path of the deepest part
 * that exists, with the rest appended. A link to something that isn't there yet is followed too, since the write would
 * create what it points to. (The native realpath also spells each name as the disk does, letter case included.) Each
 * decision may follow `budget.links` more links that realpath couldn't: a loop of links stops there.
 */
function followed(path: string, budget: { links: number }): string {
  if (dirname(path) === path) return path; // the disk's root
  try {
    return realpathSync.native(path);
  } catch {
    const folder = followed(dirname(path), budget);
    const target = budget.links > 0 ? linkTarget(path) : null;
    if (target === null) return join(folder, basename(path));
    budget.links -= 1;
    // Not resolve(), which settles ".." on paper: the disk takes a ".." in the target after the links before it, and
    // so does this walk (realpath, else the folder followed first).
    return followed(isAbsolute(target) ? target : `${folder}/${target}`, budget);
  }
}

function linkTarget(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null; // not a link, or not there
  }
}

/**
 * The `--settings` JSON for a write run: deny rules for KEEP_OUT, for every dot path and for INSTRUCTION_FILES, and
 * the PreToolUse hook (a guard's `hook`).
 */
export function guardSettings(root: string, hook: GuardHook): string {
  const given = resolve(root);
  // `Edit(//<absolute path>)` covers Edit, Write and NotebookEdit, and `<root>/**/<name>` is a file of that name in any
  // folder, the root's own included: `<root>/**/.*` is any dot file or folder, and `<root>/**/.*/**` what is in one.
  // The root comes in both forms when its real path differs: the agent may give a path through either.
  const deny = [...new Set([given, realPath(given)])].flatMap((form) => {
    const base = `//${patternText(form.slice(1))}`;
    return [
      ...KEEP_OUT.flatMap(({ path }) => [`Edit(${base}/${path})`, `Edit(${base}/${path}/**)`]),
      `Edit(${base}/**/.*)`,
      `Edit(${base}/**/.*/**)`,
      ...INSTRUCTION_FILES.map((name) => `Edit(${base}/**/${name})`),
    ];
  });
  // Nothing else: -p silently drops settings that fail validation, deny rules and all (an unknown hook type does that).
  return JSON.stringify({
    permissions: { deny },
    hooks: { PreToolUse: [{ matcher: "Write|Edit|NotebookEdit", hooks: [hook] }] },
  });
}

/** The library's real path, spelled as the disk spells it (as the guard's realpath is), else its absolute path. */
function realPath(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return resolve(root);
  }
}

/** `text` with what a permission rule's pattern reads as special (\, *, ?, [ and ]) escaped by a backslash. */
function patternText(text: string): string {
  return text.replace(/[\\*?[\]]/g, "\\$&");
}
