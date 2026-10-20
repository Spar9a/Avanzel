#!/usr/bin/env node
// The design rules inside coding agents' hooks. An agent learns a rule the moment it breaks it, in
// words that say what to use instead; it can't finish with problems left, and it can't approve its
// own visual changes or loosen the rules.
//
//   node packages/ui/checks/guard.mjs <agent> <event>     (hook JSON on stdin)
//     agent  claude | codex | gemini | opencode
//     event  before-edit   a file is about to be written: refuse an edit that adds problems
//            after-edit    a file was written (Codex's apply_patch): send problems back as the result
//            before-shell  a command is about to run: refuse ones that approve looks, skip checks or
//                          write interface files from the shell, where the edit check can't see them
//            after-shell   a command ran: check any interface file it changed anyway
//            stop          the agent wants to finish: send it back while problems remain
//
// It fails open: if the guard itself breaks, the edit goes ahead and the git hook still checks.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO, filesInScope, format, introduced, run, scopeOf } from "./design-check.mjs";

/** Paths an agent may not change on its own, and why. */
const PROTECTED = [
  { test: /^packages\/ui\/tokens\//, ask: true, why: "Tokens are the brand: changing one changes every window. Say which token you'd change and why; the owner makes or approves the change." },
  { test: /^packages\/ui\/src\/generated\//, ask: false, why: "This file is generated from packages/ui/tokens/ by `npm run ui:tokens`. Don't edit it." },
  { test: /^packages\/ui\/e2e\/.*-snapshots\//, ask: false, why: "Screenshots are the approved look. Only the owner approves a new one, with `npm run ui:approve`. Tell them what changed and why." },
  { test: /^packages\/ui\/checks\/(config|rules|design-check|guard)\.mjs$|^packages\/ui\/checks\/baseline\.json$/, ask: true, why: "These are the design rules and their exceptions. Changing them changes what every agent is held to, so the owner decides. To shrink the baseline after a migration, run `npm run design:check -- --update-baseline` instead." },
  { test: /^(\.claude\/settings\.json|\.codex\/hooks\.json|\.gemini\/settings\.json|\.githooks\/|\.opencode\/plugins\/avanzel-ui-guard)/, ask: true, why: "These files connect the design rules to the agents. The owner decides." },
];

/** Shell commands that would approve looks, skip the checks or rewrite protected files. */
const SHELL = [
  { test: /--update-snapshots|\bplaywright\b[^|;&]*\s-u\b|\bui:approve\b|\brun\s+approve\b/, why: "Approving screenshots is the owner's call. Run `npm run ui:e2e` to see the differences, then tell the owner what changed and why." },
  { test: /\bgit\b[^|;&]*\bcommit\b[^|;&]*(--no-verify|\s-n\b)/, why: "Commits go through the design check. Fix what it reports instead of skipping it." },
  { test: /\bcore\.hooksPath\b|--init-baseline/, why: "That changes how the design rules are enforced; the owner decides." },
  { test: /(>>?|\btee\b|\bsed\s+-i|\bperl\s+-i|\bcp\b|\bmv\b|\brm\b|\bln\b|writeFile)[^|;&]*(packages\/ui\/(tokens|src\/generated|checks)\/|-snapshots\/|\.claude\/settings\.json)/, why: "That writes to a protected design file from the shell. Use the edit tools, which go through the design check." },
];

/** A shell command that writes an interface file: the edit tools are the only way in. */
const INTERFACE_PATH = /apps\/[^/\s'"]+\/src\/renderer|\/renderer\/|packages\/ui\/(src|gallery)\//;
const INTERFACE_FILE = /\.(tsx|css|html)\b/;
const SHELL_WRITE = /\bopen\([^)]*['"][wa]\+?['"]|\.write(Text)?\(|writeFile(Sync)?\(|\bsed\s+-i|\bperl\s+-i|\btee\b|\bcat\s*>|>>?\s*['"]?[^\s'"&|;>]*\.(tsx|css|html)\b|\bpatch\b|\bgit\s+apply\b/;

const MAX_STOPS = 3;

function relInRepo(file, cwd) {
  if (!file) return null;
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd ?? REPO, file);
  const rel = path.relative(REPO, abs);
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel.split(path.sep).join("/");
}

const readOr = (rel, fallback = "") => { try { return readFileSync(path.join(REPO, rel), "utf8"); } catch { return fallback; } };
const atHead = (rel) => { try { return execFileSync("git", ["show", `HEAD:${rel}`], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };

/** The file as the edit would leave it. */
function proposed(input, before) {
  if (typeof input.content === "string") return input.content;
  const oldText = input.old_string ?? input.oldString;
  const newText = input.new_string ?? input.newString;
  if (typeof oldText !== "string" || typeof newText !== "string") return null;
  if (!before.includes(oldText)) return null; // the edit tool will refuse it anyway
  return input.replace_all || input.replaceAll || input.allow_multiple ? before.split(oldText).join(newText) : before.replace(oldText, () => newText);
}

const lead = (what) => `${what} Avanzel's design rules (packages/ui/DESIGN.md) are checked on every edit. Fix these and try again:\n\n`;

function beforeEdit(hook) {
  const input = hook.tool_input ?? hook.toolInput ?? hook.args ?? {};
  const rel = relInRepo(input.file_path ?? input.filePath ?? input.path, hook.cwd);
  if (!rel) return { verdict: "allow" };
  const guard = PROTECTED.find((p) => p.test.test(rel));
  if (guard) return { verdict: guard.ask ? "ask" : "deny", reason: `${rel}: ${guard.why}` };
  if (!scopeOf(rel)) return { verdict: "allow" };
  const before = readOr(rel);
  const after = proposed(input, before);
  if (after === null) return { verdict: "allow" };
  const problems = introduced(rel, before, after);
  return problems.length ? { verdict: "deny", reason: lead("This edit wasn't applied.") + format(problems) } : { verdict: "allow" };
}

/** Files named in a Codex apply_patch. */
function patchedFiles(patch) {
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map((m) => (m[1] ?? m[2]).trim());
}

function afterEdit(hook) {
  const input = hook.tool_input ?? hook.toolInput ?? {};
  const patch = typeof input.command === "string" ? input.command : Array.isArray(input.command) ? input.command.join(" ") : input.patch ?? input.patchText ?? "";
  const files = [...patchedFiles(patch), input.file_path, input.filePath].filter(Boolean).map((f) => relInRepo(f, hook.cwd)).filter(Boolean);
  const touched = files.map((rel) => ({ rel, guard: PROTECTED.find((p) => p.test.test(rel)) })).filter((f) => f.guard);
  if (touched.length) return { verdict: "deny", reason: `Undo your change to ${touched.map((t) => t.rel).join(", ")}. ${touched[0].guard.why}` };
  const problems = files.filter((rel) => scopeOf(rel) && existsSync(path.join(REPO, rel))).flatMap((rel) => introduced(rel, atHead(rel), readOr(rel)));
  return problems.length ? { verdict: "deny", reason: lead("This change broke the design rules.") + format(problems) } : { verdict: "allow" };
}

function beforeShell(hook) {
  const input = hook.tool_input ?? hook.toolInput ?? {};
  const command = Array.isArray(input.command) ? input.command.join(" ") : String(input.command ?? input.cmd ?? "");
  const hit = SHELL.find((s) => s.test.test(command));
  if (hit) return { verdict: "deny", reason: hit.why };
  if (INTERFACE_PATH.test(command) && INTERFACE_FILE.test(command) && SHELL_WRITE.test(command)) {
    return { verdict: "deny", reason: "Change interface files with the Edit or Write tool, not from the shell: the design check reads each edit before it lands, and it can't see inside a script. Reading files from the shell is fine." };
  }
  remember(hook, "shell", fingerprints());
  return { verdict: "allow" };
}

/** Hashes of the interface files that differ from HEAD, to see what one command changed. */
function fingerprints() {
  return Object.fromEntries(changedPaths().filter((rel) => scopeOf(rel) && existsSync(path.join(REPO, rel))).map((rel) => [rel, createHash("sha1").update(readOr(rel)).digest("hex")]));
}

function afterShell(hook) {
  const before = recall(hook, "shell") ?? {};
  const now = fingerprints();
  const touched = Object.keys(now).filter((rel) => now[rel] !== before[rel]);
  const problems = touched.flatMap((rel) => introduced(rel, atHead(rel), readOr(rel)));
  return problems.length ? { verdict: "deny", reason: lead("That command left design problems in interface files.") + format(problems) } : { verdict: "allow" };
}

/** Per-session notes, kept in the temp folder between one hook call and the next. */
function stateFile(hook) {
  return path.join(tmpdir(), `avanzel-design-guard-${String(hook.session_id ?? hook.sessionId ?? "default").replace(/[^\w-]/g, "")}.json`);
}
function recall(hook, key) {
  try { return JSON.parse(readFileSync(stateFile(hook), "utf8"))[key]; } catch { return undefined; }
}
function remember(hook, key, value) {
  let all = {};
  try { all = JSON.parse(readFileSync(stateFile(hook), "utf8")); } catch {}
  all[key] = value;
  writeFileSync(stateFile(hook), JSON.stringify(all));
}

const git = (args) => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); } catch { return []; } };
const changedPaths = () => [...new Set([...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])])];
const isLook = (rel) => /^packages\/ui\/(src|gallery|tokens)\//.test(rel) && !rel.includes("/dist/");

/** The gallery's screenshot tests: the titles of the sections that no longer look as approved. */
function changedLooks() {
  const ui = path.join(REPO, "packages", "ui");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    execFileSync("node", ["scripts/build-gallery.mjs"], { cwd: ui, env, stdio: "ignore" });
    execFileSync("npx", ["--no-install", "playwright", "test", "--reporter=json"], { cwd: ui, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 150_000, maxBuffer: 64 * 1024 * 1024 });
    return [];
  } catch (error) {
    const failed = [];
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) if (!spec.ok) failed.push(spec.title.replace(/^looks right: /, ""));
      for (const child of suite.suites ?? []) walk(child);
    };
    try { walk({ suites: JSON.parse(error.stdout ?? "{}").suites ?? [] }); } catch { failed.push("the gallery (its tests didn't run)"); }
    return failed;
  }
}

function stop(hook) {
  const state = recall(hook, "stop") ?? { stops: 0 };
  const save = () => remember(hook, "stop", state);
  const changed = changedPaths();

  const problems = run(changed.filter((rel) => scopeOf(rel) && existsSync(path.join(REPO, rel))));
  if (problems.length) {
    if (state.stops >= MAX_STOPS) {
      return { verdict: "allow", message: `Avanzel design check: ${problems.length} problem${problems.length === 1 ? "" : "s"} left after ${MAX_STOPS} tries. Run \`npm run design:check\` to see them.` };
    }
    state.stops += 1;
    save();
    return { verdict: "deny", reason: lead("Not finished yet: your changes leave design problems.") + format(problems) };
  }

  // A change to the system's look is checked once per version of the change, and only the owner approves it.
  const looks = changed.filter(isLook).sort();
  if (looks.length) {
    const fingerprint = createHash("sha1").update(looks.map((rel) => `${rel}\0${readOr(rel)}`).join("\0")).digest("hex");
    if (state.fingerprint !== fingerprint) {
      state.fingerprint = fingerprint;
      state.looks = changedLooks();
      save();
      if (state.looks.length) {
        return { verdict: "deny", reason: `Your change alters how these gallery sections look: ${state.looks.join(", ")}. If you meant it, finish and tell the owner which sections changed and why: they review it with \`npm run ui:e2e\` and approve it with \`npm run ui:approve\`. You can't approve it yourself. If you didn't mean it, fix it.` };
      }
    }
    if (state.looks?.length) return { verdict: "allow", message: `Avanzel design check: the look of ${state.looks.join(", ")} changed and needs your approval. Review it with \`npm run ui:e2e\` and approve it with \`npm run ui:approve\`.` };
  }
  return { verdict: "allow" };
}

/** Each agent's way of saying allow, ask or deny. */
function respond(agent, event, decision) {
  const { verdict, reason = "", message } = decision;
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  if (agent === "opencode") return out(verdict === "allow" ? { allow: true } : { allow: false, reason });
  if (agent === "gemini") {
    if (verdict !== "allow") out({ decision: "deny", reason });
    return;
  }
  if (event === "stop") {
    if (verdict === "deny") out({ decision: "block", reason });
    else if (message) out({ systemMessage: message });
    else if (agent === "codex") out({});
    return;
  }
  if (event === "after-edit" || event === "after-shell") {
    if (verdict !== "allow") out({ decision: "block", reason });
    return;
  }
  if (verdict === "allow") return;
  // Codex has no "ask" for tools: what would ask the owner is refused, with the reason.
  const permission = verdict === "ask" && agent === "claude" ? "ask" : "deny";
  out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: permission, permissionDecisionReason: reason } });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const [agent = "claude", event = "before-edit"] = process.argv.slice(2);
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    try {
      const hook = raw.trim() ? JSON.parse(raw) : {};
      const handle = { "before-edit": beforeEdit, "after-edit": afterEdit, "before-shell": beforeShell, "after-shell": afterShell, stop }[event];
      respond(agent, event, handle ? handle(hook) : { verdict: "allow" });
    } catch (error) {
      process.stderr.write(`avanzel design guard: ${error instanceof Error ? error.message : error} (allowed)\n`);
    }
  });
}

export { beforeEdit, afterEdit, beforeShell, afterShell, stop, respond, patchedFiles };
