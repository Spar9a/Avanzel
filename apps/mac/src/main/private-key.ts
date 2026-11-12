// The key for the person's private model server, kept by the app and not by the library: the library's settings can be committed to
// git, so a key never goes there. The key lives in one file in the app's own data, encrypted with the Mac's Keychain (Electron's
// safeStorage). Settings never gets the key back: it learns only whether there is one, and Copy puts it on the clipboard from here.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AvanzelError } from "@avanzel/engine";

/** What turns a key into bytes for the file and back: the Keychain in the app, a stand-in in tests. */
export interface KeyCipher {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(bytes: Buffer): string;
}

/** The shortest and longest key kept: a key of a server is far from either. */
const MIN_LENGTH = 8;
const MAX_LENGTH = 4096;

/** A new key: 32 random bytes in URL-safe letters, with a prefix that says what it is for if it turns up in a server's settings. */
export function generatePrivateKey(): string {
  return `avz-${randomBytes(32).toString("base64url")}`;
}

/**
 * The key a person copied, as it is kept: trimmed. Refused, in plain words, when there is nothing on the clipboard, it has
 * white space inside (so it is some text and not a key), or it is shorter or longer than a key is.
 */
export function cleanPastedKey(text: string): string {
  const key = text.trim();
  if (!key) throw new AvanzelError("The clipboard has no key. Copy the key from your server's settings first.");
  if (/\s/.test(key)) throw new AvanzelError("What is on the clipboard has spaces or lines in it, so it isn't a key. Copy just the key.");
  if (key.length < MIN_LENGTH || key.length > MAX_LENGTH) {
    throw new AvanzelError(`A key is between ${MIN_LENGTH} and ${MAX_LENGTH} characters, and what is on the clipboard isn't.`);
  }
  return key;
}

export class PrivateKeyStore {
  readonly #file: string;
  readonly #cipher: KeyCipher;

  constructor(file: string, cipher: KeyCipher) {
    this.#file = file;
    this.#cipher = cipher;
  }

  /** Whether a key is kept. */
  has(): boolean {
    return existsSync(this.#file);
  }

  /** The key, or null when none is kept or the file can't be read back (the Keychain item went, say). */
  get(): string | null {
    try {
      if (!this.has() || !this.#cipher.available()) return null;
      return this.#cipher.decrypt(readFileSync(this.#file)) || null;
    } catch {
      return null;
    }
  }

  /** Keeps `key`, replacing any. Throws, in plain words, when this Mac can't keep it safely. */
  set(key: string): void {
    if (!this.#cipher.available()) {
      throw new AvanzelError("This Mac can't keep a key safely right now. Unlock your Keychain and try again.");
    }
    mkdirSync(dirname(this.#file), { recursive: true });
    const partial = `${this.#file}.partial`;
    writeFileSync(partial, this.#cipher.encrypt(key), { mode: 0o600 });
    renameSync(partial, this.#file);
  }

  /** Forgets the key. */
  clear(): void {
    rmSync(this.#file, { force: true });
  }
}

/** A cipher that keeps text as it is, for tests that must not ask the Keychain for access. Never used outside them. */
export const PLAIN_CIPHER: KeyCipher = {
  available: () => true,
  encrypt: (text) => Buffer.from(text, "utf8"),
  decrypt: (bytes) => bytes.toString("utf8"),
};
