// Captures and shadow tasks start with a small YAML frontmatter block of one-line `key: value`
// pairs. Avanzel writes and reads only that subset, so it needs no YAML library.

/** [frontmatter, body] of a Markdown file; the frontmatter is "" when there is none. */
export function splitFrontmatter(text: string): [string, string] {
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 3);
    if (end !== -1) return [text.slice(4, end), text.slice(end + 5)];
  }
  return ["", text];
}

/** The `key: value` lines of a frontmatter block, values unquoted (other lines are ignored). */
export function frontmatterFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (match?.[1]) fields.set(match[1], scalarValue(match[2] ?? ""));
  }
  return fields;
}

/** The items of a one-line flow sequence such as `[library, "web search"]`; a bare value is one item. */
export function flowItems(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return trimmed ? [trimmed] : [];
  const items: string[] = [];
  let current = "";
  let quote = "";
  for (let i = 1; i < trimmed.length - 1; i++) {
    const char = trimmed[i] ?? "";
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"') current += trimmed[++i] ?? "";
      else if (char === quote) quote = "";
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else {
      if (char === '"' || char === "'") quote = char;
      current += char;
    }
  }
  items.push(current);
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map(scalarValue);
}

/** `value` as a YAML scalar: plain when that reads back as the same string, double-quoted otherwise. */
export function yamlScalar(value: string, inFlow = false): string {
  const plain =
    value !== "" &&
    value === value.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/: |\s#|:$|[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value) &&
    !(inFlow && /[,[\]{}]/.test(value)) &&
    !/^(?:true|false|yes|no|on|off|null|~|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)$/i.test(value);
  if (plain) return value;
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function scalarValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw.slice(1, -1);
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
  return raw.replace(/\s+#.*$/, "");
}
