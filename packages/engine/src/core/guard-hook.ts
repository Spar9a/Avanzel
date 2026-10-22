// The write guard of Claude Code's write runs: a write to the owner's words (inbox/, raw/), their scheduled tasks or
// the library's settings, or anywhere outside the library, is refused before it happens. Every such run gets
// `--settings` with deny rules for the paths in KEEP_OUT, and a PreToolUse hook that refuses the same writes and any
// outside the library, and tells the agent why. The deny rules hold in every permission mode, `--bare` included (which
// skips hooks); the hook adds the reasons and the check for outside, and follows symlinks before it decides. It is a
// small Node program written into the run's own temp folder, and Avanzel's own binary runs it as Node: nothing is
// installed in the library or anywhere else on the Mac. What any agent still changes among the protected paths is put
// back after every run (guard.ts).

import { realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

/** The reason for a write anywhere outside the library. */
function outsideReason(root: string): string {
  return `This run may only write inside the library, ${root}.`;
}

// The hook (guard-hook.mjs). Claude Code runs it through `sh -c` with the tool call as JSON on stdin, and reads what it
// prints. It imports only node:fs and node:path, and its rules come from guard-rules.json, its one argument. (No
// backtick or dollar-brace in it: it sits in a template literal.)
const HOOK = String.raw`// Avanzel's write guard, a PreToolUse hook. Claude Code runs it before each Write, Edit and
// NotebookEdit of a write run, with the tool call as JSON on stdin; its one argument is its rules (guard-rules.json).
// A write to a path the rules keep out, or outside the library, is refused: it prints the deny with the reason, which
// the agent reads. Anything else it lets through without a word, input it can't read included; the deny rules in the
// run's settings still hold.
import { readFileSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

// How many more links followed() may follow that realpath couldn't: a loop of links stops there.
let linksLeft = 40;

// Where a write to the absolute path would really go, every link on the way followed: the real path of the deepest
// part that exists, with the rest appended. A link to something that isn't there yet is followed too, since the write
// would create what it points to. (The native realpath also spells each name as the disk does, letter case included.)
function followed(path) {
  if (dirname(path) === path) return path; // the disk's root
  try {
    return realpathSync.native(path);
  } catch {
    const folder = followed(dirname(path));
    const target = linksLeft > 0 ? linkTarget(path) : null;
    if (target === null) return join(folder, basename(path));
    linksLeft -= 1;
    return followed(resolve(folder, target));
  }
}

function linkTarget(path) {
  try {
    return readlinkSync(path);
  } catch {
    return null; // not a link, or not there
  }
}

// Why the write is refused, or null when it may go ahead.
function refusal(input, guard) {
  const tool = input?.tool_input;
  const path = tool?.file_path ?? tool?.notebook_path;
  if (typeof path !== "string") return null;
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : guard.root;
  const rel = relative(guard.root, followed(resolve(cwd, path)));
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return guard.outside;
  const lower = rel.toLowerCase(); // the disk doesn't tell RAW/ from raw/
  const rule = guard.rules.find((kept) => {
    const name = kept.path.toLowerCase();
    return lower === name || lower.startsWith(name + "/");
  });
  return rule ? rule.reason : null;
}

let input, guard;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  guard = JSON.parse(readFileSync(process.argv[2], "utf8"));
} catch {
  process.exit(0); // input it can't read: nothing to say
}
const reason = refusal(input, guard);
if (reason) {
  const decision = { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: decision }));
}
`;

/** Writes the hook's program and its rules into `dir`; returns the shell command Claude Code runs for it. */
export function installHook(dir: string, root: string, interpreter: string = process.execPath): string {
  const real = realPath(root);
  const program = join(dir, "guard-hook.mjs");
  const rules = join(dir, "guard-rules.json");
  writeFileSync(program, HOOK);
  writeFileSync(rules, JSON.stringify({ root: real, rules: KEEP_OUT, outside: outsideReason(real) }));
  // In the app, process.execPath is Avanzel's own binary, and the variable makes it run as Node (the app removes it
  // from its own environment at startup, so only the hook gets it). In tests it is Node itself, which ignores it.
  return `ELECTRON_RUN_AS_NODE=1 ${shellWord(interpreter)} ${shellWord(program)} ${shellWord(rules)}`;
}

/** The `--settings` JSON for a write run: deny rules for KEEP_OUT, and the PreToolUse hook. */
export function guardSettings(root: string, hookCommand: string): string {
  const given = resolve(root);
  // `Edit(//<absolute path>)` covers Edit, Write and NotebookEdit. The root comes in both forms when its real path
  // differs: the agent may give a path through either.
  const deny = [...new Set([given, realPath(given)])].flatMap((form) => {
    const base = `//${patternText(form.slice(1))}`;
    return KEEP_OUT.flatMap(({ path }) => [`Edit(${base}/${path})`, `Edit(${base}/${path}/**)`]);
  });
  const hook = { type: "command", command: hookCommand, timeout: 10 };
  // Nothing else: -p silently ignores a settings value that fails validation, and the guard with it.
  return JSON.stringify({
    permissions: { deny },
    hooks: { PreToolUse: [{ matcher: "Write|Edit|NotebookEdit", hooks: [hook] }] },
  });
}

/** The library's real path, spelled as the disk spells it (as the hook's realpath is), else its absolute path. */
function realPath(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return resolve(root);
  }
}

/** `text` as one shell word: single-quoted, with each ' in it written as '\''. */
function shellWord(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/** `text` with what a permission rule's pattern reads as special (\, *, ?, [ and ]) escaped by a backslash. */
function patternText(text: string): string {
  return text.replace(/[\\*?[\]]/g, "\\$&");
}
