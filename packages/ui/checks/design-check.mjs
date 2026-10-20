#!/usr/bin/env node
// design-check: Avanzel's design rules (rules.mjs) applied to window code and to @avanzel/ui.
//
//   node packages/ui/checks/design-check.mjs [files…]   the files given, or every file in scope
//     --changed           only files changed since HEAD, and new files
//     --staged            only staged files (the git pre-commit hook)
//     --json              machine-readable output
//     --update-baseline   lower checks/baseline.json to what is left; it never raises a count
//     --init-baseline     write the first baseline (once, by the owner, when the checks arrive)
//
// Window files that predate @avanzel/ui are listed in checks/baseline.json with how many of each
// problem they had. They pass while they have no more than that, and the count only goes down.
import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { parseAst } from "rolldown/parseAst";
import { tokenCatalog } from "../scripts/tokens-lib.mjs";
import { ALLOWED_CAPS, EXEMPT, IGNORED, PROPER_NOUNS, SYSTEM, VOICE_FILES, WINDOWS } from "./config.mjs";
import { ARRANGE, COMPONENT_FOR, COPY_PROPS, DOC, EMOJI, FILLER, FIRST_PERSON, LABEL_PROPS, PRONOUNS, RULES, SPACING_PROPS } from "./rules.mjs";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const BASELINE = path.join(REPO, "packages", "ui", "checks", "baseline.json");

// ---------- paths ----------

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += glob[i + 2] === "/" ? 2 : 1; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") { const end = glob.indexOf("}", i); re += `(?:${glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`; i = end; }
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
const matcher = (globs) => { const res = globs.map(globToRegExp); return (rel) => res.some((r) => r.test(rel)); };
const isWindow = matcher(WINDOWS), isSystem = matcher(SYSTEM), isIgnored = matcher(IGNORED), isVoiceFile = matcher(VOICE_FILES);

/** "windows", "system", or null when design-check has nothing to say about the file. */
export function scopeOf(rel) {
  const p = rel.split(path.sep).join("/");
  if (isIgnored(p)) return null;
  if (isSystem(p)) return "system";
  if (isWindow(p)) return "windows";
  return null;
}

const exempt = (rule, rel) => Boolean(EXEMPT[rule]?.[rel]);

// ---------- shared helpers ----------

let catalog;
const tokens = () => (catalog ??= tokenCatalog());

function nearestToken(name) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best = null;
  for (const candidate of tokens().keys()) { const score = dist(name, candidate); if (!best || score < best.score) best = { candidate, score }; }
  return best?.candidate;
}

const SPACE_STEPS = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48];
function nearestSpace(px) {
  const below = [...SPACE_STEPS].reverse().find((s) => s <= px);
  const above = SPACE_STEPS.find((s) => s >= px);
  return [...new Set([below, above].filter(Boolean))].map((s) => `var(--av-space-${s})`).join(" or ");
}

const NAMED_COLOURS = /(^|[\s,(])(white|black|red|green|blue|yellow|orange|purple|pink|gr[ae]y|silver|gold|navy|teal|maroon|lime|aqua|fuchsia|olive|brown|cyan|magenta|violet|indigo|beige|ivory|coral|crimson|salmon|tomato|turquoise|khaki|lavender|plum|orchid|tan|wheat|snow|azure)(?=$|[\s,)])/i;
const RAW_COLOUR = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const hasRawColour = (value) => RAW_COLOUR.test(stripVars(value)) || NAMED_COLOURS.test(stripVars(value));
/** The value without var(…) references, so a token's name never reads as a colour. */
function stripVars(value) { let v = value, prev; do { prev = v; v = v.replace(/var\([^()]*\)/g, "var()"); } while (v !== prev); return v; }

const COLOUR_PROPS = /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline))?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration(-color)?|column-rule(-color)?|stop-color|flood-color|lighting-color|(-webkit-)?mask(-image)?|filter|scrollbar-color)$/;
const RADIUS_PROPS = /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/;
const DURATION = /(?<![\w-])(\d*\.?\d+)(ms|s)\b/;
const RAW_EASING = /\b(cubic-bezier|steps)\(|(?<![\w-])(ease|ease-in|ease-out|ease-in-out|step-start|step-end)(?![\w-])/;

function inReducedMotion(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && p.name === "media" && /prefers-reduced-motion:\s*reduce/.test(p.params)) return true;
  return false;
}

// ---------- CSS ----------

function checkCss(rel, text, scope, report) {
  let root;
  try { root = postcss.parse(text, { from: rel }); } catch (e) { report("windows-arrange", e.line ?? 1, e.column ?? 1, "stylesheet", `The stylesheet doesn't parse: ${e.reason ?? e.message}.`); return; }
  root.walkDecls((decl) => {
    if (decl.parent?.type === "atrule" && decl.parent.name === "font-face") return;
    const prop = decl.prop.toLowerCase();
    const value = decl.value;
    const at = decl.source?.start ?? { line: 1, column: 1 };
    const found = `${decl.prop}: ${value}${decl.important ? " !important" : ""}`;
    const say = (rule, message) => report(rule, at.line, at.column, found, message);

    if (decl.important && !(scope === "system" && inReducedMotion(decl))) say("no-important", "`!important` overrides the system instead of using it.");
    for (const m of value.matchAll(/var\(\s*(--av-[\w-]+)/g)) {
      if (!tokens().has(m[1])) say("known-token", `\`${m[1]}\` isn't a token${nearestToken(m[1]) ? `; the closest is \`${nearestToken(m[1])}\`` : ""}.`);
    }

    if (scope === "windows") {
      if (prop.startsWith("--")) { say("windows-arrange", "Windows don't define their own variables: layout values come from the spacing scale and everything else from components."); return; }
      if (!ARRANGE.has(prop)) { say("windows-arrange", `\`${decl.prop}\` paints, and windows only arrange.`); return; }
      if (SPACING_PROPS.test(prop)) {
        for (const part of stripVars(value).replace(/calc\([^)]*\)/g, " ").split(/\s+/).filter(Boolean)) {
          if (/^(0|auto|inherit|initial|unset|var\(\))$/.test(part) || /%$/.test(part)) continue;
          const px = /^(-?\d*\.?\d+)px$/.exec(part);
          say("space-scale", `\`${part}\` is off the spacing scale${px ? `; use ${nearestSpace(Math.abs(Number(px[1])))}` : ""}.`);
        }
        if (/var\(\s*--av-(?!space-)/.test(value)) say("space-scale", "Only --av-space-* tokens set spacing.");
      }
      if (prop === "z-index" && !/^(auto|var\(\s*--av-layer-[\w-]+\s*\))$/.test(value.trim())) say("layer-scale", `\`z-index: ${value}\` isn't a layer token.`);
      return;
    }

    // The design system: paint is allowed, with tokens only.
    if (prop.startsWith("--")) {
      if (!prop.startsWith("--_") && !prop.startsWith("--av-")) say("tokens-only", "Custom properties in @avanzel/ui are tokens (--av-*) or private (--_*).");
      if (hasRawColour(value) && !exempt("tokens-only", rel)) say("tokens-only", "A raw colour in a custom property; point it at a colour token.");
      return;
    }
    if (COLOUR_PROPS.test(prop) && hasRawColour(value)) say("tokens-only", `\`${decl.prop}\` has a raw colour.`);
    if (prop === "font-family" && !/^(inherit|var\(\s*--av-font-[\w-]+\s*\))$/.test(value.trim())) say("tokens-only", "Font families come from the --av-font-* tokens.");
    if (prop === "font" && !/^(inherit|var\(\s*--av-text-[\w-]+\s*\))$/.test(value.trim())) say("tokens-only", "The font shorthand takes one --av-text-* token.");
    if (prop === "font-size") say("tokens-only", "Sizes come with their role: use font: var(--av-text-…) instead of font-size.");
    if (prop === "letter-spacing" && !/^(0|normal|inherit|var\(\s*--av-text-[\w-]+-tracking\s*\))$/.test(value.trim())) say("tokens-only", "Tracking comes from the --av-text-*-tracking tokens.");
    if (RADIUS_PROPS.test(prop)) {
      const raw = value.split(/\s+/).filter((part) => !/^(0|50%|inherit|var\(\s*--av-radius-[\w-]+\s*\))$/.test(part));
      if (raw.length) say("tokens-only", `${[...new Set(raw)].map((r) => `\`${r}\``).join(", ")} ${raw.length === 1 ? "isn't a radius token" : "aren't radius tokens"}.`);
    }
    if (prop === "z-index" && !/^(auto|var\(\s*--av-layer-[\w-]+\s*\))$/.test(value.trim())) say("layer-scale", `\`z-index: ${value}\` isn't a layer token.`);
    if (/^(transition|animation)(-duration|-timing-function|-delay)?$/.test(prop) && !exempt("motion-tokens", rel) && !inReducedMotion(decl)) {
      const loop = /\binfinite\b/.test(value);
      const bare = stripVars(value);
      if (!loop && DURATION.test(bare)) say("motion-tokens", `\`${DURATION.exec(bare)[0]}\` isn't a duration token.`);
      if (!loop && RAW_EASING.test(bare)) say("motion-tokens", "Easing comes from the --av-ease-* tokens (or linear).");
    }
    if (/^(-webkit-)?backdrop-filter$/.test(prop) && value.trim() !== "none" && rel !== "packages/ui/src/components/hud.css") say("glass-in-hud", "Glass outside the capsule.");
    if (prop === "text-transform" && value.trim() === "uppercase" && rel !== "packages/ui/src/components/stamp.css") say("capitals-in-stamp", "Capitals outside the stamp.");
  });

  if (scope === "windows") {
    root.walkRules((rule) => {
      if (/\.av-|\[data-(variant|tone|size|mood|look|shelf|surface|shape|flow|animate)\b|--_/.test(rule.selector)) {
        const at = rule.source?.start ?? { line: 1, column: 1 };
        report("ui-internals", at.line, at.column, rule.selector, "This selector reaches into @avanzel/ui.");
      }
    });
    root.walkAtRules((atRule) => {
      if (["keyframes", "font-face", "-webkit-keyframes"].includes(atRule.name)) {
        const at = atRule.source?.start ?? { line: 1, column: 1 };
        report("windows-arrange", at.line, at.column, `@${atRule.name}`, atRule.name === "font-face" ? "Fonts come from @avanzel/ui." : "Motion comes from components.");
      }
    });
  }
}

// ---------- TSX ----------

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };
}

const nameOf = (n) => (!n ? "" : n.type === "JSXIdentifier" ? n.name : n.type === "JSXMemberExpression" ? `${nameOf(n.object)}.${nameOf(n.property)}` : n.type === "JSXNamespacedName" ? `${n.namespace.name}:${n.name.name}` : "");
const attr = (opening, name) => opening.attributes.find((a) => a.type === "JSXAttribute" && nameOf(a.name) === name);
const literalOf = (v) => (!v ? undefined : v.type === "Literal" && typeof v.value === "string" ? v.value : v.type === "JSXExpressionContainer" ? literalOf(v.expression) : v.type === "TemplateLiteral" ? v.quasis.map((q) => q.value.cooked ?? q.value.raw).join("…") : undefined);
const PROPER = new Set(PROPER_NOUNS);
const CAPS = new Set(ALLOWED_CAPS);

function titleCase(text) {
  const words = text.replace(/[“”"'’()…:;,.?]/g, " ").split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length < 2) return false;
  const rest = words.slice(1);
  const capped = rest.filter((w) => /^\p{Lu}/u.test(w) && !PROPER.has(w) && !CAPS.has(w));
  return capped.length >= 2 && capped.length >= rest.length / 2;
}

/** The copy rules for one string people will read. */
function checkCopy(text, ctx, report) {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s || ctx.code) return;
  const say = (rule, message) => report(rule, ctx.line, ctx.column, `"${s.length > 60 ? `${s.slice(0, 57)}…` : s}"`, message);
  if (s.includes("!")) say("no-exclamation", "An exclamation mark.");
  for (const re of FILLER) if (re.test(s)) { say("no-filler", `“${re.exec(s)[0]}” is filler.`); break; }
  if (s.includes("...")) say("real-ellipsis", "Three dots instead of “…”.");
  for (const w of s.match(/\b[A-Z]{3,}\b(?![._]\w)/g) ?? []) if (!CAPS.has(w)) { say("no-shouting", `“${w}” is in capitals.`); break; }
  if (PRONOUNS.test(s)) say("they-them", `“${PRONOUNS.exec(s)[0]}” assumes a gender.`);
  if (FIRST_PERSON.test(s) && !ctx.voice) say("zel-says-i", "Zel speaking in the first person outside its own moments.");
  if (EMOJI.test(s)) say("no-emoji", "An emoji.");
  if (ctx.label && titleCase(s)) say("sentence-case", "Title Case.");
}

function checkTsx(rel, text, scope, report) {
  let ast;
  try { ast = parseAst(text, { lang: rel.endsWith(".tsx") ? "tsx" : "ts" }); } catch { return; } // TypeScript reports syntax errors.
  const where = lineIndex(text);
  const ui = new Set();
  const voiceFile = isVoiceFile(rel);
  const stack = [];

  const visit = (node, parentKey) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) visit(n, parentKey); return; }
    const at = () => where(node.start ?? 0);

    switch (node.type) {
      case "ImportDeclaration": {
        const source = node.source.value;
        if (source === "@avanzel/ui") for (const sp of node.specifiers) ui.add(sp.local.name);
        if (scope === "windows") {
          const deep = (source.startsWith("@avanzel/ui/") && !["@avanzel/ui/base.css", "@avanzel/ui/menu-bar"].includes(source)) || /(^|\/)packages\/ui\//.test(source);
          if (deep) { const p = at(); report("ui-entry", p.line, p.column, `import "${source}"`, "This import reaches inside @avanzel/ui."); }
        }
        break;
      }
      case "JSXElement": {
        const opening = node.openingElement;
        const name = nameOf(opening.name);
        const variant = literalOf(attr(opening, "variant")?.value);
        stack.push({ name, variant });
        const p = where(opening.start);
        const intrinsic = /^[a-z]/.test(name);
        if (scope === "windows" && intrinsic && COMPONENT_FOR[name]) report("use-components", p.line, p.column, `<${name}>`, `<${name}> is a raw control; use ${COMPONENT_FOR[name]} from @avanzel/ui.`);
        for (const a of opening.attributes) {
          if (a.type !== "JSXAttribute") continue;
          const an = nameOf(a.name);
          const ap = where(a.start);
          const value = literalOf(a.value);
          if (an === "style") {
            if (scope === "windows") report("no-style-prop", ap.line, ap.column, "style={…}", "An inline style in a window.");
            else {
              const obj = a.value?.type === "JSXExpressionContainer" ? (a.value.expression.type === "TSAsExpression" ? a.value.expression.expression : a.value.expression) : null;
              const keys = obj?.type === "ObjectExpression" ? obj.properties.map((pr) => pr.key?.value ?? pr.key?.name ?? "") : [];
              const bad = keys.filter((k) => !String(k).startsWith("--"));
              if (bad.length) report("style-vars-only", ap.line, ap.column, `style={{ ${bad.join(", ")} }}`, `style sets ${bad.join(", ")} directly.`);
            }
          }
          if (scope === "windows" && (an === "className" || an === "style") && ui.has(name.split(".")[0])) report("no-overrides", ap.line, ap.column, `<${name} ${an}>`, `<${name}> from @avanzel/ui takes no ${an}.`);
          if (["fill", "stroke", "color", "stopColor", "floodColor"].includes(an) && value && hasRawColour(value) && !exempt("raw-colour", rel)) report("raw-colour", ap.line, ap.column, `${an}="${value}"`, `A raw colour in \`${an}\`.`);
          if (COPY_PROPS.has(an) && value !== undefined && !(an === "children" && !value)) {
            checkCopy(value, { line: ap.line, column: ap.column, label: LABEL_PROPS.has(an), voice: voiceFile || inVoice(stack), code: inCode(stack) }, report);
          }
        }
        visit(node.children, "children");
        visit(opening.attributes.map((a) => (a.type === "JSXAttribute" ? a.value : a.argument)), "attr");
        stack.pop();
        return;
      }
      case "JSXText": {
        const p = at();
        const top = stack.at(-1);
        const label = top && (top.name === "Button" || (top.name === "Text" && ["title", "heading", "headline", "voice"].includes(top.variant ?? "")));
        checkCopy(node.value, { line: p.line, column: p.column, label, voice: voiceFile || inVoice(stack), code: inCode(stack) }, report);
        return;
      }
      case "JSXExpressionContainer": {
        if (parentKey === "children") {
          const value = literalOf(node.expression);
          if (value !== undefined) { const p = at(); checkCopy(value, { line: p.line, column: p.column, label: stack.at(-1)?.name === "Button", voice: voiceFile || inVoice(stack), code: inCode(stack) }, report); return; }
        }
        break;
      }
      case "Property": {
        const key = node.key?.name ?? node.key?.value;
        const value = literalOf(node.value);
        if (stack.length && ["label", "title", "description", "placeholder"].includes(key) && value !== undefined) {
          const p = at();
          checkCopy(value, { line: p.line, column: p.column, label: key !== "description", voice: voiceFile || inVoice(stack), code: inCode(stack) }, report);
        }
        break;
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== "type" && child && typeof child === "object") visit(child, key);
  };
  visit(ast.body ?? ast.program?.body ?? [], "body");
}

const VOICE_COMPONENTS = new Set(["Bubble", "Letter", "PermissionPrimer"]);
const inVoice = (stack) => stack.some((s) => VOICE_COMPONENTS.has(s.name) || (s.name === "Text" && s.variant === "voice"));
const inCode = (stack) => stack.some((s) => s.name === "code" || s.name === "pre" || s.name === "kbd" || s.name === "Kbd" || (s.name === "Text" && s.variant === "code"));

// ---------- HTML ----------

function checkHtml(rel, text, scope, report) {
  if (scope !== "windows") return;
  const where = lineIndex(text);
  for (const m of text.matchAll(/\sstyle\s*=/g)) { const p = where(m.index); report("no-style-prop", p.line, p.column, "style=\"…\"", "An inline style in a window's HTML."); }
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) checkCss(rel, m[1], scope, (rule, line, column, found, message) => report(rule, where(m.index).line + line - 1, column, found, message));
}

// ---------- entry points ----------

/** Every problem in one file's text, as { rule, line, column, found, message, fix }. */
export function checkSource(rel, text) {
  rel = rel.split(path.sep).join("/");
  const scope = scopeOf(rel);
  if (!scope) return [];
  const problems = [];
  const report = (rule, line, column, found, message) => {
    if (exempt(rule, rel)) return;
    problems.push({ file: rel, rule, line, column, found, message, fix: RULES[rule].fix });
  };
  if (rel.endsWith(".css")) checkCss(rel, text, scope, report);
  else if (rel.endsWith(".tsx") || rel.endsWith(".ts")) checkTsx(rel, text, scope, report);
  else if (rel.endsWith(".html")) checkHtml(rel, text, scope, report);
  return problems;
}

export function readBaseline() {
  return existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
}

const countByRule = (problems) => problems.reduce((acc, p) => ((acc[p.rule] = (acc[p.rule] ?? 0) + 1), acc), {});

/** The problems the baseline doesn't cover: for each rule, all of a file's instances once it has more than its allowance. */
export function overBaseline(rel, problems, baseline = readBaseline()) {
  const allowed = baseline[rel] ?? {};
  const counts = countByRule(problems);
  return problems
    .filter((p) => counts[p.rule] > (allowed[p.rule] ?? 0))
    .map((p) => (allowed[p.rule] ? { ...p, message: `${p.message} (${counts[p.rule]} in this file; the baseline allows ${allowed[p.rule]})` } : p));
}

/** Problems in `after` that `before` didn't have: what an edit adds. */
export function introduced(rel, before, after) {
  const old = checkSource(rel, before ?? "");
  const seen = new Map();
  for (const p of old) seen.set(`${p.rule}\u0000${p.found}`, (seen.get(`${p.rule}\u0000${p.found}`) ?? 0) + 1);
  const added = [];
  for (const p of checkSource(rel, after)) {
    const key = `${p.rule}\u0000${p.found}`;
    if (seen.get(key)) seen.set(key, seen.get(key) - 1);
    else added.push(p);
  }
  return added;
}

/** Problems grouped by file, then how to fix each kind once. */
export function format(problems) {
  if (!problems.length) return "";
  const lines = [];
  for (const [file, list] of Map.groupBy(problems, (p) => p.file)) {
    lines.push(file);
    for (const p of list) lines.push(`  ${p.line}:${p.column}  ${p.rule}  ${p.found}\n      ${p.message}`);
  }
  const rules = [...new Set(problems.map((p) => p.rule))];
  lines.push("", "How to fix:");
  for (const rule of rules) lines.push(`  ${rule}: ${RULES[rule].fix}`);
  lines.push("", `${problems.length} design problem${problems.length === 1 ? "" : "s"}. The rules and the components: ${DOC}.`);
  return lines.join("\n");
}

function git(args) {
  try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean); } catch { return []; }
}

export function filesInScope({ changed = false, staged = false } = {}) {
  const list = staged ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    : changed ? [...git(["diff", "--name-only", "HEAD", "--diff-filter=ACMR"]), ...git(["ls-files", "--others", "--exclude-standard"])]
    : [...WINDOWS, ...SYSTEM].flatMap((g) => globSync(g, { cwd: REPO }));
  return [...new Set(list)].filter((f) => scopeOf(f) && existsSync(path.join(REPO, f))).sort();
}

export function run(files, { baseline = readBaseline() } = {}) {
  const all = [];
  for (const rel of files) all.push(...overBaseline(rel, checkSource(rel, readFileSync(path.join(REPO, rel), "utf8")), baseline));
  return all;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const named = args.filter((a) => !a.startsWith("--")).map((f) => path.relative(REPO, path.resolve(f)));
  const files = named.length ? named.filter((f) => scopeOf(f)) : filesInScope({ changed: flags.has("--changed"), staged: flags.has("--staged") });

  if (flags.has("--init-baseline")) {
    if (existsSync(BASELINE)) { console.error("checks/baseline.json exists; it only goes down now (--update-baseline)."); process.exit(1); }
    const next = {};
    for (const rel of filesInScope().filter((f) => scopeOf(f) === "windows")) {
      const counts = countByRule(checkSource(rel, readFileSync(path.join(REPO, rel), "utf8")));
      if (Object.keys(counts).length) next[rel] = counts;
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Baseline written for ${Object.keys(next).length} window files that predate @avanzel/ui.`);
  } else if (flags.has("--update-baseline")) {
    const old = readBaseline();
    const next = {};
    for (const rel of Object.keys(old)) {
      if (!existsSync(path.join(REPO, rel))) continue;
      const counts = countByRule(checkSource(rel, readFileSync(path.join(REPO, rel), "utf8")));
      const kept = Object.fromEntries(Object.entries(old[rel]).map(([rule, n]) => [rule, Math.min(n, counts[rule] ?? 0)]).filter(([, n]) => n > 0));
      if (Object.keys(kept).length) next[rel] = kept;
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Baseline lowered: ${Object.keys(old).length} → ${Object.keys(next).length} legacy files.`);
  } else {

  const problems = run(files);
  if (flags.has("--json")) console.log(JSON.stringify({ files: files.length, problems }, null, 2));
  else if (problems.length) console.error(format(problems));
  else console.log(`design-check: ${files.length} file${files.length === 1 ? "" : "s"}, no problems.`);
  process.exitCode = problems.length ? 1 : 0; // not process.exit(): a pipe would lose the end of the output
  }
}
