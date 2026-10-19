// The library scaffold, the task prompts and the default shadow tasks ship as text templates.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** `$AVANZEL_TEMPLATES` when set (a bundled app points it at its resources), else the package's `templates/`. */
export function templatesDir(): string {
  return process.env.AVANZEL_TEMPLATES || fileURLToPath(new URL("../../templates/", import.meta.url));
}

/** A template's text, by its path inside the templates folder (e.g. "prompts/file.md"). */
export function template(name: string): string {
  return readFileSync(join(templatesDir(), ...name.split("/")), "utf8");
}

// Python's string.Template: `$$`, `$name`, `${name}`; any other `$` is an error.
const PLACEHOLDER = /\$(?:(\$)|([_a-z][_a-z0-9]*)|\{([_a-z][_a-z0-9]*)\}|())/gi;

/** Fill every placeholder in one pass (inserted values are never re-read); a placeholder without a value is an error. */
export function substitute(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(
    PLACEHOLDER,
    (match: string, escaped?: string, named?: string, braced?: string, _invalid?: string, offset = 0) => {
      if (escaped) return "$";
      const key = named ?? braced;
      if (key === undefined) {
        throw new Error(`Invalid placeholder at offset ${offset}: ${JSON.stringify(text.slice(offset, offset + 12))}`);
      }
      if (!Object.hasOwn(values, key)) throw new Error(`No value for the template placeholder ${match}`);
      return values[key] ?? "";
    },
  );
}

export function render(name: string, values: Readonly<Record<string, string>>): string {
  return substitute(template(name), values);
}
