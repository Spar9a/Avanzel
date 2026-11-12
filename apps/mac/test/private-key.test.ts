import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanPastedKey, generatePrivateKey, PLAIN_CIPHER, PrivateKeyStore, type KeyCipher } from "../src/main/private-key.ts";

const file = () => path.join(mkdtempSync(path.join(tmpdir(), "avz-key-")), "private-key.bin");

/** A cipher that scrambles, so a test can tell the file is not the key as it was. */
const scrambling: KeyCipher = {
  available: () => true,
  encrypt: (text) => Buffer.from(Buffer.from(text).reverse()),
  decrypt: (bytes) => Buffer.from(bytes).reverse().toString("utf8"),
};

describe("generatePrivateKey", () => {
  it("makes a long, URL-safe key with a prefix, and a different one each time", () => {
    const key = generatePrivateKey();
    expect(key).toMatch(/^avz-[A-Za-z0-9_-]{43}$/);
    expect(generatePrivateKey()).not.toBe(key);
  });
});

describe("cleanPastedKey", () => {
  it("trims the clipboard's text", () => {
    expect(cleanPastedKey("  sk-abcdef123456\n")).toBe("sk-abcdef123456");
  });

  it("refuses nothing at all, text with spaces or lines in it, and a key that is too short or too long, in plain words", () => {
    expect(() => cleanPastedKey("  \n")).toThrow("The clipboard has no key.");
    expect(() => cleanPastedKey("two words")).toThrow(/spaces or lines/);
    expect(() => cleanPastedKey("a\nb")).toThrow(/spaces or lines/);
    expect(() => cleanPastedKey("short")).toThrow(/between 8 and 4096/);
    expect(() => cleanPastedKey("x".repeat(5000))).toThrow(/between 8 and 4096/);
  });
});

describe("PrivateKeyStore", () => {
  it("keeps a key, gives it back, replaces it and forgets it", () => {
    const store = new PrivateKeyStore(file(), PLAIN_CIPHER);
    expect(store.has()).toBe(false);
    expect(store.get()).toBeNull();
    store.set("first-key-123");
    expect(store.has()).toBe(true);
    expect(store.get()).toBe("first-key-123");
    store.set("second-key-456");
    expect(store.get()).toBe("second-key-456");
    store.clear();
    expect(store.has()).toBe(false);
    expect(store.get()).toBeNull();
  });

  it("writes what the cipher made and not the key, readable by its owner alone", () => {
    const where = file();
    new PrivateKeyStore(where, scrambling).set("a-secret-key-1");
    expect(readFileSync(where, "utf8")).not.toContain("a-secret-key-1");
    expect(statSync(where).mode & 0o777).toBe(0o600);
    expect(new PrivateKeyStore(where, scrambling).get()).toBe("a-secret-key-1");
  });

  it("refuses to keep a key, in plain words, when the Keychain can't, and gives none back", () => {
    const locked: KeyCipher = { ...scrambling, available: () => false };
    const where = file();
    expect(() => new PrivateKeyStore(where, locked).set("a-secret-key-1")).toThrow(/Unlock your Keychain/);
    new PrivateKeyStore(where, scrambling).set("a-secret-key-1");
    expect(new PrivateKeyStore(where, locked).get()).toBeNull();
  });

  it("gives none back for a file it can't read as its own", () => {
    const where = file();
    new PrivateKeyStore(where, PLAIN_CIPHER).set("a-secret-key-1");
    const broken: KeyCipher = { ...scrambling, decrypt: () => { throw new Error("bad item"); } };
    expect(new PrivateKeyStore(where, broken).get()).toBeNull();
  });
});
