import { AvanzelError } from "@avanzel/engine";
import { describe, expect, it } from "vitest";
import type { Target } from "../src/main/cursor-helper.ts";
import { skipSiteOf, storagePolicy } from "../src/main/cursor-policy.ts";
import { cleanSkipList } from "../src/main/skip-list.ts";

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AvanzelError);
    return (error as Error).message;
  }
  throw new Error("it was not refused");
};

describe("cleanSkipList: sites", () => {
  it("keeps a site however it was typed as its host alone: no scheme, path, port, user, www or capitals", () => {
    expect(
      cleanSkipList(["https://Example.com/login", "example.com/login", "example.com:8080", "www.example.com", "http://me:pw@Bank.test:444/x?token=1"], "sites"),
    ).toEqual(["example.com", "bank.test"]);
  });

  it("writes a host with letters beyond ASCII as the browser reports it, in punycode", () => {
    expect(cleanSkipList(["bücher.de", "https://www.Bücher.de/a"], "sites")).toEqual(["xn--bcher-kva.de"]);
  });

  it("drops blank lines and repeats, flattens a line's spaces, and keeps the order typed", () => {
    expect(cleanSkipList(["", "  b.test  ", "a.test", "\t", "B.test", "a.test."], "sites")).toEqual(["b.test", "a.test"]);
  });

  it("takes a leading *. as the site itself, whose subdomains are skipped anyway", () => {
    expect(cleanSkipList(["*.example.com"], "sites")).toEqual(["example.com"]);
  });

  it("refuses a line that can't be read as a website, naming it", () => {
    expect(refusal(() => cleanSkipList(["example.com", "not a site"], "sites"))).toBe(
      'Line 2 of the sites to skip, "not a site", isn\'t a website. Write it as its address, such as example.com.',
    );
    expect(refusal(() => cleanSkipList(["file:///Users/me/notes.md"], "sites"))).toContain("Line 1 of the sites to skip");
    expect(refusal(() => cleanSkipList(["ftp://example.com"], "sites"))).toContain("Line 1 of the sites to skip");
  });

  it("names a long bad line by its start only", () => {
    const message = refusal(() => cleanSkipList([`bad site ${"x".repeat(100)}`], "sites"));
    expect(message).toContain(`"bad site ${"x".repeat(31)}…"`);
  });

  it("refuses more entries than the list holds, and a site longer than it takes, in plain words", () => {
    const many = Array.from({ length: 501 }, (_, i) => `site${i}.test`);
    expect(refusal(() => cleanSkipList(many, "sites"))).toBe(
      "The sites to skip are 501 lines, and 500 is the most the list can hold. Remove the ones you need least.",
    );
    expect(cleanSkipList(many.slice(0, 500), "sites")).toHaveLength(500);
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(30)}.test`;
    expect(refusal(() => cleanSkipList(["ok.test", long], "sites"))).toBe(
      `Line 2 of the sites to skip is ${long.length} characters, and 200 is the most. Shorten it.`,
    );
  });
});

describe("cleanSkipList: apps", () => {
  it("keeps bundle ids trimmed, drops blank lines and repeats however they are cased, and keeps the first spelling", () => {
    expect(cleanSkipList(["  com.apple.Passwords ", "", "com.apple.passwords", "org.keepassxc.keepassxc", "com.my-app.x2"], "apps")).toEqual([
      "com.apple.Passwords",
      "org.keepassxc.keepassxc",
      "com.my-app.x2",
    ]);
  });

  it("refuses a line that doesn't look like a bundle id, naming it", () => {
    expect(refusal(() => cleanSkipList(["com.apple.Passwords", "1Password"], "apps"))).toBe(
      'Line 2 of the apps to skip, "1Password", isn\'t a bundle id. A bundle id is letters, digits and hyphens joined by dots, such as com.apple.Passwords.',
    );
    for (const bad of ["com apple", "com..apple", ".com.apple", "com.apple.", "com/apple", "com.apple_x"]) {
      expect(refusal(() => cleanSkipList([bad], "apps"))).toContain("Line 1 of the apps to skip");
    }
  });

  it("refuses more entries than the list holds, and one longer than it takes", () => {
    const many = Array.from({ length: 501 }, (_, i) => `com.example.app${i}`);
    expect(refusal(() => cleanSkipList(many, "apps"))).toBe(
      "The apps to skip are 501 lines, and 500 is the most the list can hold. Remove the ones you need least.",
    );
    const long = `com.${"a".repeat(200)}`;
    expect(refusal(() => cleanSkipList([long], "apps"))).toBe(`Line 1 of the apps to skip is ${long.length} characters, and 200 is the most. Shorten it.`);
  });
});

describe("a skipped site the person wrote by hand in config.toml", () => {
  const browserTarget: Target = { app: { name: "Chrome", bundleId: "com.google.Chrome", pid: 1 }, window: { title: "x" }, element: null };

  it("is read as cleanSkipList would keep it, so host/path, host:port and unicode entries still skip their site", () => {
    expect(skipSiteOf("example.com/login")).toBe("example.com");
    expect(skipSiteOf("example.com:8080")).toBe("example.com");
    expect(skipSiteOf("bücher.de")).toBe("xn--bcher-kva.de");
    expect(skipSiteOf("not a site")).toBeNull();
    for (const listed of ["example.com/login", "example.com:8080", "https://Example.com/x"]) {
      expect(storagePolicy(browserTarget, { address: "https://example.com/a" }, { apps: [], sites: [listed] }).reason).toBe("skipped-site");
    }
    expect(storagePolicy(browserTarget, { address: "https://xn--bcher-kva.de/" }, { apps: [], sites: ["bücher.de"] }).reason).toBe("skipped-site");
  });
});
