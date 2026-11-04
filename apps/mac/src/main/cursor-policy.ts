import type { Target } from "./cursor-helper.ts";

/**
 * Password managers, by bundle id: what is said while one is in front is never kept (it still goes in). Enpass under both ids it has
 * shipped with. The engine keeps the same list (`DEFAULT_DICTATION_SKIP_APPS`); a library's config.toml written before an id was
 * added keeps the list it wrote, so the person adds a new id by hand in Settings → Voice.
 */
export const DEFAULT_SKIP_APPS: string[] = [
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.bitwarden.desktop",
  "com.apple.keychainaccess",
  "com.apple.Passwords",
  "org.keepassxc.keepassxc",
  "com.lastpass.LastPass",
  "com.dashlane.Dashlane",
  "com.enpass.Enpass",
  "in.sinew.Enpass-Desktop",
];

/**
 * The website an address belongs to: its host in lower case, without a leading `www.`, port, user, password, path or query.
 * Only http and https addresses name a website; anything else (a file, `about:blank`, a browser's own page) and anything that does not parse gives null.
 */
export function siteOf(address: string | undefined): string | null {
  const text = address?.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A trailing dot is a valid way to write the same host, so it must not make a listed site miss.
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return host || null;
}

/**
 * A site as the person listed it, as the host `siteOf` gives for a browser's address, so the two can be compared: they may type it
 * with `www.`, capitals, spaces, a path or a port, a leading `*.`, letters beyond ASCII (made punycode, as browsers report them), or
 * paste a whole address. Null for an entry that can't be read as a website, which then matches nothing. Settings saves entries through
 * this (`cleanSkipList`); it is read here again for entries written into config.toml by hand.
 */
export function skipSiteOf(entry: string): string | null {
  const text = entry.trim().replace(/^\*\./, "");
  if (!text) return null;
  // Without a scheme, "example.com:8080" would parse as the scheme "example.com:", so a bare entry is read as a web address.
  return siteOf(text.includes("://") ? text : `http://${text}`);
}

/** The site is a listed one, or a subdomain of it; `notexample.com` is not a subdomain of `example.com`, so the dot is part of the match. */
function onList(site: string, sites: readonly string[]): boolean {
  return sites.some((entry) => {
    const listed = skipSiteOf(entry);
    return listed !== null && (site === listed || site.endsWith(`.${listed}`));
  });
}

export interface StoragePolicy {
  store: boolean;
  reason: "skipped-app" | "skipped-site" | "secure-field" | "private-window" | null;
  /** The domain only, and only when the dictation may be stored; null when unknown, not a browser, or not kept. */
  site: string | null;
}

/**
 * Whether a dictation may be kept anywhere (history and day file), and which site to record with it. The text is inserted either way; this only decides storage.
 * A target is a browser exactly when the caller passes a non-null `browser`: the host fills it from front-app.ts, which knows the browsers it can ask for a tab (its CHROMIUM set and Safari), so this module keeps no list of its own.
 * A browser whose address could not be read (Firefox, or a tab that gave nothing) is stored with no site rather than refused, because nothing says it is private.
 * Order: a secure field, then a skipped app, then a private window, then a skipped site.
 */
export function storagePolicy(
  target: Target,
  browser: { address?: string; privateWindow?: boolean } | null,
  skip: { apps: readonly string[]; sites: readonly string[] },
): StoragePolicy {
  const refuse = (reason: NonNullable<StoragePolicy["reason"]>): StoragePolicy => ({ store: false, reason, site: null });

  // No element means Accessibility could not read one, which is not the same as a password field.
  if (target.element?.secure === true) return refuse("secure-field");

  const bundleId = target.app.bundleId.toLowerCase();
  if (bundleId && skip.apps.some((app) => app.toLowerCase() === bundleId)) return refuse("skipped-app");

  if (!browser) return { store: true, reason: null, site: null };
  if (browser.privateWindow === true) return refuse("private-window");

  const site = siteOf(browser.address);
  if (site && onList(site, skip.sites)) return refuse("skipped-site");
  return { store: true, reason: null, site };
}
