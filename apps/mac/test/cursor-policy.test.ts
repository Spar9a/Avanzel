import { describe, expect, it } from "vitest";
import type { Target } from "../src/main/cursor-helper.ts";
import { DEFAULT_SKIP_APPS, siteOf, storagePolicy } from "../src/main/cursor-policy.ts";

const target = (over: { bundleId?: string; secure?: boolean; element?: Target["element"]; window?: Target["window"] } = {}): Target => ({
  app: { name: "Some app", bundleId: over.bundleId ?? "com.example.notes", pid: 1 },
  window: over.window === undefined ? { title: "A window" } : over.window,
  element: over.element === undefined ? { role: "AXTextArea", secure: over.secure ?? false, takesText: "yes" } : over.element,
});

const nothing = { apps: [] as string[], sites: [] as string[] };

describe("default skip list", () => {
  it("names the password managers by bundle id", () => {
    expect(DEFAULT_SKIP_APPS).toEqual([
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
    ]);
  });
});

describe("siteOf", () => {
  it("keeps only the host, lower-cased and without www", () => {
    expect(siteOf("https://a.example.com/x?token=1#frag")).toBe("a.example.com");
    expect(siteOf("https://WWW.Example.COM/")).toBe("example.com");
    expect(siteOf("http://example.com")).toBe("example.com");
  });

  it("drops the port, the user and the password", () => {
    expect(siteOf("https://me:hunter2@example.com:8443/path")).toBe("example.com");
    expect(siteOf("http://localhost:3001/board")).toBe("localhost");
  });

  it("keeps an IPv4 or IPv6 host whole", () => {
    expect(siteOf("http://192.168.0.1:8080/admin")).toBe("192.168.0.1");
    expect(siteOf("http://[::1]:3000/")).toBe("[::1]");
  });

  it("ignores a trailing dot in the host", () => {
    expect(siteOf("https://example.com./x")).toBe("example.com");
  });

  it("is null for an empty, missing or unparsable address", () => {
    expect(siteOf(undefined)).toBeNull();
    expect(siteOf("")).toBeNull();
    expect(siteOf("   ")).toBeNull();
    expect(siteOf("not a url")).toBeNull();
    expect(siteOf("example.com/path")).toBeNull();
    expect(siteOf("https://")).toBeNull();
  });

  it("is null for addresses that name no website", () => {
    expect(siteOf("file:///Users/me/secret.html")).toBeNull();
    expect(siteOf("about:blank")).toBeNull();
    expect(siteOf("chrome://settings/passwords")).toBeNull();
    expect(siteOf("javascript:alert(1)")).toBeNull();
  });
});

describe("storagePolicy", () => {
  it("stores a dictation in an app that is neither listed nor a browser, with no site", () => {
    expect(storagePolicy(target(), null, nothing)).toEqual({ store: true, reason: null, site: null });
  });

  it("stores nothing from a secure field", () => {
    expect(storagePolicy(target({ secure: true }), null, nothing)).toEqual({ store: false, reason: "secure-field", site: null });
  });

  it("treats a missing element as not secure, and never throws on missing parts", () => {
    expect(storagePolicy(target({ element: null }), null, nothing)).toEqual({ store: true, reason: null, site: null });
    expect(storagePolicy(target({ element: { role: null, secure: false, takesText: "unknown" }, window: null }), null, nothing).store).toBe(true);
    expect(storagePolicy(target({ bundleId: "" }), null, { apps: [""], sites: [""] }).store).toBe(true);
  });

  it("stores nothing from a skipped app, and matches the bundle id however it is cased", () => {
    const skip = { apps: ["com.1password.1password"], sites: [] };
    expect(storagePolicy(target({ bundleId: "com.1password.1password" }), null, skip)).toEqual({ store: false, reason: "skipped-app", site: null });
    expect(storagePolicy(target({ bundleId: "COM.1Password.1password" }), null, skip).reason).toBe("skipped-app");
    expect(storagePolicy(target({ bundleId: "com.1password.other" }), null, skip).store).toBe(true);
  });

  it("applies the default list as given by the caller", () => {
    const skip = { apps: DEFAULT_SKIP_APPS, sites: [] };
    for (const bundleId of DEFAULT_SKIP_APPS) expect(storagePolicy(target({ bundleId }), null, skip).reason).toBe("skipped-app");
  });

  it("stores nothing from a private browser window", () => {
    const result = storagePolicy(target(), { address: "https://example.com/", privateWindow: true }, nothing);
    expect(result).toEqual({ store: false, reason: "private-window", site: null });
  });

  it("stores nothing from a skipped site, or from a subdomain of one", () => {
    const skip = { apps: [], sites: ["example.com"] };
    expect(storagePolicy(target(), { address: "https://example.com/a" }, skip)).toEqual({ store: false, reason: "skipped-site", site: null });
    expect(storagePolicy(target(), { address: "https://www.example.com/a" }, skip).reason).toBe("skipped-site");
    expect(storagePolicy(target(), { address: "https://a.b.example.com:444/a" }, skip).reason).toBe("skipped-site");
  });

  it("does not match a site that merely ends with the listed name", () => {
    const skip = { apps: [], sites: ["example.com"] };
    expect(storagePolicy(target(), { address: "https://notexample.com/" }, skip)).toEqual({ store: true, reason: null, site: "notexample.com" });
    expect(storagePolicy(target(), { address: "https://example.com.evil.net/" }, skip).store).toBe(true);
  });

  it("does not let a listed subdomain skip its parent", () => {
    const skip = { apps: [], sites: ["mail.example.com"] };
    expect(storagePolicy(target(), { address: "https://example.com/" }, skip).store).toBe(true);
    expect(storagePolicy(target(), { address: "https://mail.example.com/" }, skip).reason).toBe("skipped-site");
  });

  it("reads a listed site however the person typed it", () => {
    const skip = { apps: [], sites: ["  WWW.Example.COM ", "https://bank.test/login?x=1", ""] };
    expect(storagePolicy(target(), { address: "https://example.com/" }, skip).reason).toBe("skipped-site");
    expect(storagePolicy(target(), { address: "https://my.bank.test/" }, skip).reason).toBe("skipped-site");
    expect(storagePolicy(target(), { address: "https://other.test/" }, skip).store).toBe(true);
  });

  it("returns only the host of a browser address, never the path, query or password", () => {
    const result = storagePolicy(target(), { address: "https://a.example.com/x?token=1" }, nothing);
    expect(result).toEqual({ store: true, reason: null, site: "a.example.com" });
    const leaky = storagePolicy(target(), { address: "https://me:hunter2@example.com:8443/secret?token=abc" }, nothing);
    expect(leaky.site).toBe("example.com");
    expect(JSON.stringify(leaky)).not.toMatch(/hunter2|secret|token|8443/);
  });

  it("stores with no site when the browser's address could not be read", () => {
    expect(storagePolicy(target(), {}, nothing)).toEqual({ store: true, reason: null, site: null });
    expect(storagePolicy(target(), { address: "" }, { apps: [], sites: ["example.com"] })).toEqual({ store: true, reason: null, site: null });
    expect(storagePolicy(target(), { address: "garbage" }, nothing)).toEqual({ store: true, reason: null, site: null });
    expect(storagePolicy(target(), { address: "file:///tmp/x.html" }, nothing)).toEqual({ store: true, reason: null, site: null });
  });

  it("does not look at the site of an app that is not a browser", () => {
    expect(storagePolicy(target(), null, { apps: [], sites: ["example.com"] }).store).toBe(true);
  });

  it("puts the secure field first, then the skipped app, then the private window, then the skipped site", () => {
    const skip = { apps: ["com.example.notes"], sites: ["example.com"] };
    const browser = { address: "https://example.com/", privateWindow: true };
    expect(storagePolicy(target({ secure: true }), browser, skip).reason).toBe("secure-field");
    expect(storagePolicy(target(), browser, skip).reason).toBe("skipped-app");
    expect(storagePolicy(target(), browser, { apps: [], sites: ["example.com"] }).reason).toBe("private-window");
    expect(storagePolicy(target(), { address: "https://example.com/" }, { apps: [], sites: ["example.com"] }).reason).toBe("skipped-site");
  });
});
