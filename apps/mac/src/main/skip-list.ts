// The skip list of dictating into any app as Settings → Voice saves it: the apps (by bundle id) and the websites whose dictations are
// pasted but never kept. Entries are stored as the privacy rule compares them (cursor-policy.ts), so what the person typed is what skips.
import { AvanzelError, MAX_DICTIONARY_ENTRIES, MAX_DICTIONARY_LINE_LENGTH, plainLine } from "@avanzel/engine";
import { skipSiteOf } from "./cursor-policy.ts";

/** Letters, digits and hyphens, in at least two parts joined by single dots: what macOS allows in a bundle id. */
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** How much of a refused line its message quotes: enough to find it in the field. */
const QUOTED = 40;

const LIST_NAME = { apps: "apps to skip", sites: "sites to skip" } as const;

/** A line as a refusal quotes it: its first 40 characters, with an ellipsis when there was more. */
function quoted(line: string): string {
  const characters = Array.from(line);
  return `"${characters.length <= QUOTED ? line : `${characters.slice(0, QUOTED).join("")}…`}"`;
}

/**
 * Whether `site`, what `line` became, is a website the person could mean. A single name would skip every site under it: `www.com`
 * becomes `com`, and `com` matches every .com site, so only `localhost` (and an IPv6 address, in brackets) may be one. And an address
 * the parser made up is refused: it reads `12345` or `0x7f.1` as numbers (`0.0.48.57`, `127.0.0.1`), which the person never wrote.
 */
function readsAsWritten(site: string, line: string): boolean {
  if (!site.includes(".")) return site === "localhost" || site.startsWith("[");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(site)) return line.toLowerCase().includes(site);
  return true;
}

/**
 * The lines of a skip-list field, as the library keeps them: each one plain line (`plainLine`), blank ones and repeats dropped, in
 * the order typed. A site is kept as its host (`skipSiteOf`: `https://Example.com/login`, `example.com:8080` and `www.example.com`
 * are all `example.com`); a bundle id as typed, and a repeat of it in other capitals is dropped, as the rule ignores case. Refuses,
 * in plain words for the Settings window's Notice, a line that is no website or bundle id, naming it, and more entries or a longer
 * one than config.toml takes (the dictionary's limits, which config loading checks too).
 */
export function cleanSkipList(typed: readonly string[], kind: "apps" | "sites"): string[] {
  const name = LIST_NAME[kind];
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of typed.entries()) {
    const line = plainLine(raw);
    if (line === "") continue;
    let entry: string;
    if (kind === "sites") {
      const site = skipSiteOf(line);
      if (site === null || !readsAsWritten(site, line)) {
        throw new AvanzelError(`Line ${index + 1} of the ${name}, ${quoted(line)}, isn't a website. Write it as its address, such as example.com.`);
      }
      entry = site;
    } else {
      if (!BUNDLE_ID.test(line)) {
        throw new AvanzelError(
          `Line ${index + 1} of the ${name}, ${quoted(line)}, isn't a bundle id. ` +
            "A bundle id is letters, digits and hyphens joined by dots, such as com.apple.Passwords.",
        );
      }
      entry = line;
    }
    if (entry.length > MAX_DICTIONARY_LINE_LENGTH) {
      throw new AvanzelError(`Line ${index + 1} of the ${name} is ${entry.length} characters, and ${MAX_DICTIONARY_LINE_LENGTH} is the most. Shorten it.`);
    }
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  if (kept.length > MAX_DICTIONARY_ENTRIES) {
    throw new AvanzelError(
      `The ${name} are ${kept.length} lines, and ${MAX_DICTIONARY_ENTRIES} is the most the list can hold. Remove the ones you need least.`,
    );
  }
  return kept;
}
