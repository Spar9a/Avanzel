// Reads Avanzel's design tokens (W3C design-token JSON in tokens/) and turns them into CSS custom
// properties. The token build, the design checks and the tests all read tokens through this file,
// so a token's name means the same thing everywhere.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UI_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const TOKENS_DIR = path.join(UI_ROOT, "tokens");

/** Which files make each mode. Later files override earlier ones. */
export const MODES = {
  light: ["base", "light"],
  dark: ["base", "dark"],
  "contrast-light": ["base", "light", "contrast-light"],
  "contrast-dark": ["base", "dark", "contrast-dark"],
};

/** Groups whose values are the same in every mode; everything else is a light/dark role. */
export const SHARED_GROUPS = ["space", "radius", "size", "font", "text", "duration", "ease", "layer"];

const GENERIC_FAMILIES = new Set(["-apple-system", "BlinkMacSystemFont", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "sans-serif", "serif", "monospace"]);

export function readTokenFile(name) {
  return JSON.parse(readFileSync(path.join(TOKENS_DIR, `${name}.tokens.json`), "utf8"));
}

/** Every token in a file, as path → { type, value, description }, with $type inherited from groups. */
export function flatten(tree, prefix = [], inherited = undefined, out = new Map()) {
  const type = tree.$type ?? inherited;
  for (const [key, node] of Object.entries(tree)) {
    if (key.startsWith("$") || node === null || typeof node !== "object") continue;
    const at = [...prefix, key];
    if ("$value" in node) out.set(at.join("."), { type: node.$type ?? type, value: node.$value, description: node.$description });
    else flatten(node, at, type, out);
  }
  return out;
}

/** The tokens of a mode: its files merged in order. */
export function loadMode(mode) {
  const merged = new Map();
  for (const file of MODES[mode]) for (const [k, v] of flatten(readTokenFile(file))) merged.set(k, { ...merged.get(k), ...v, type: v.type ?? merged.get(k)?.type });
  return merged;
}

export const isEmitted = (tokenPath) => !tokenPath.startsWith("palette.");
export const isShared = (tokenPath) => SHARED_GROUPS.includes(tokenPath.split(".")[0]);

/** `ink.default` → `--av-ink`, `text.words-small` → `--av-text-words-small`. */
export function cssName(tokenPath) {
  const parts = tokenPath.split(".");
  if (parts.length > 1 && parts.at(-1) === "default") parts.pop();
  return `--av-${parts.join("-")}`;
}

const ALIAS = /^\{([^{}]+)\}$/;

/** A value with every alias replaced: by var() when it points at an emitted token, else by the value. */
export function resolve(tokens, value, { literal = false, seen = [] } = {}) {
  if (typeof value === "string") {
    const m = ALIAS.exec(value);
    if (!m) return value;
    const target = m[1];
    if (seen.includes(target)) throw new Error(`Token alias loop: ${[...seen, target].join(" → ")}`);
    const token = tokens.get(target);
    if (!token) throw new Error(`Unknown token {${target}}${seen.length ? ` (from ${seen.at(-1)})` : ""}`);
    if (!literal && isEmitted(target)) return { var: cssName(target) };
    return resolve(tokens, token.value, { literal, seen: [...seen, target] });
  }
  if (Array.isArray(value)) return value.map((v) => resolve(tokens, v, { literal, seen }));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(tokens, v, { literal, seen })]));
  return value;
}

const round = (n, places = 3) => Number(n.toFixed(places)).toString();

/** "#RRGGBB" or "#RRGGBBAA" (or a 2025.10 colour object) → [r, g, b, a] with a in 0–1. */
export function rgba(color) {
  if (color && typeof color === "object" && !("var" in color)) {
    if (color.hex) return rgba(color.hex.length === 7 && color.alpha !== undefined ? color.hex + Math.round(color.alpha * 255).toString(16).padStart(2, "0") : color.hex);
    const [r, g, b] = color.components.map((c) => Math.round(c * 255));
    return [r, g, b, color.alpha ?? 1];
  }
  const m = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(color);
  if (!m) throw new Error(`Not a colour: ${JSON.stringify(color)}`);
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
}

function cssColor(value) {
  if (value && typeof value === "object" && "var" in value) return `var(${value.var})`;
  const [r, g, b, a] = rgba(value);
  if (a === 1) return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return `rgb(${r} ${g} ${b} / ${round(a, 2)})`;
}

const dim = (v) => (v && typeof v === "object" ? ("var" in v ? `var(${v.var})` : `${v.value}${v.unit}`) : String(v));

function family(v) {
  if (v && typeof v === "object" && "var" in v) return `var(${v.var})`;
  return (Array.isArray(v) ? v : [v]).map((f) => (GENERIC_FAMILIES.has(f) ? f : `"${f}"`)).join(", ");
}

function shadow(v) {
  return (Array.isArray(v) ? v : [v]).map((s) => [s.inset ? "inset" : "", dim(s.offsetX), dim(s.offsetY), dim(s.blur), dim(s.spread), cssColor(s.color)].filter(Boolean).join(" ")).join(", ");
}

/** CSS declarations for one token: usually one, two for typography (the font, then its tracking). */
export function cssDeclarations(tokenPath, token, tokens) {
  const name = cssName(tokenPath);
  const v = resolve(tokens, token.value);
  if (v && typeof v === "object" && "var" in v) return [[name, `var(${v.var})`]];
  switch (token.type) {
    case "color": return [[name, cssColor(v)]];
    case "dimension": case "duration": return [[name, dim(v)]];
    case "number": case "fontWeight": return [[name, String(v)]];
    case "fontFamily": return [[name, family(v)]];
    case "cubicBezier": return [[name, `cubic-bezier(${v.join(", ")})`]];
    case "shadow": return [[name, shadow(v)]];
    case "typography": {
      const size = dim(v.fontSize);
      return [[name, `${v.fontWeight} ${size}/${v.lineHeight} ${family(v.fontFamily)}`], [`${name}-tracking`, dim(v.letterSpacing ?? "0px")]];
    }
    default: throw new Error(`${tokenPath}: no CSS for token type "${token.type}"`);
  }
}

/** Every CSS custom property the build writes, with what kind of value it holds. */
export function tokenCatalog() {
  const light = loadMode("light");
  const catalog = new Map();
  for (const [p, t] of light) {
    if (!isEmitted(p)) continue;
    for (const [name] of cssDeclarations(p, t, light)) catalog.set(name, { path: p, type: name.endsWith("-tracking") && t.type === "typography" ? "dimension" : t.type, group: p.split(".")[0], description: t.description });
  }
  return catalog;
}

/**
 * Text colour on its background, both opaque or the text laid over the background. WCAG 2 ratio.
 * @param {string} fg
 * @param {string} bg
 * @returns {number}
 */
export function contrast(fg, bg) {
  const [br, bgG, bb] = rgba(bg);
  const [r, g, b, a] = rgba(fg);
  const mixed = [r * a + br * (1 - a), g * a + bgG * (1 - a), b * a + bb * (1 - a)];
  const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const lum = ([x, y, z]) => 0.2126 * lin(x) + 0.7152 * lin(y) + 0.0722 * lin(z);
  const [hi, lo] = [lum(mixed), lum([br, bgG, bb])].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A colour role's literal value in a mode, flattened over an opaque base when it is translucent.
 * @param {string} mode
 * @param {string} tokenPath
 * @param {string} [over]
 * @returns {string}
 */
export function literalColor(mode, tokenPath, over) {
  const tokens = loadMode(mode);
  const token = tokens.get(tokenPath);
  if (!token) throw new Error(`No token ${tokenPath} in ${mode}`);
  const value = resolve(tokens, token.value, { literal: true });
  if (!over) return value;
  const [r, g, b, a] = rgba(value);
  const [br, bg, bb] = rgba(over);
  const mix = (c, d) => Math.round(c * a + d * (1 - a)).toString(16).padStart(2, "0");
  return `#${mix(r, br)}${mix(g, bg)}${mix(b, bb)}`;
}
