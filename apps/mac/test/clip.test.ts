import { describe, expect, it } from "vitest";
import { ownLine, shortened, shortenedKeepingPaths, shortReason } from "../src/shared/clip.ts";

const WAV = "raw/audio/2026/10/2026-10-27-101500.wav";
const INBOX_WAV = "inbox/2026-10-27-101500.wav";

/** What Node says when a file can't be moved into a folder it may not write to, for a library at `root`. */
const renameRefused = (root: string) => `EACCES: permission denied, rename '${root}/${WAV}' -> '${root}/${INBOX_WAV}'`;

/**
 * A library in a deep folder with no space in its path, one whose folder has a space, one in iCloud Drive, which has one too, and
 * one whose folder has an apostrophe in its name as well, which is no quote.
 */
const DEEP = renameRefused("/Users/ana/Documents/Notes/Avanzel");
const MY_NOTES = renameRefused("/Users/ana/Documents/My Notes/Avanzel");
const MOBILE = renameRefused("/Users/ana/Library/Mobile Documents/com~apple~CloudDocs/Avanzel");
const ANTONS = renameRefused("/Users/anton/Documents/Anton's Notes/Avanzel");

/** The words of `text`, as a person reads them: what is between white space. */
const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** How many quotes `text` has: an apostrophe between two letters, as in "Anton's", is none. */
const quotesIn = (text: string) => (text.replace(/(?<=\p{L})'(?=\p{L})/gu, "").match(/'/g) ?? []).length;

describe("ownLine", () => {
  it("is an agent's line as a sentence", () => {
    expect(ownLine("Error: usage limit reached")).toBe("Usage limit reached.");
    expect(ownLine("agent crashed: not logged in")).toBe("Agent crashed: not logged in.");
    expect(ownLine("Is it on?")).toBe("Is it on?");
    expect(ownLine("ERROR: the model is not supported with this account")).toBe("The model is not supported with this account.");
    expect(ownLine("Still starting…")).toBe("Still starting…");
    expect(ownLine("")).toBe("");
  });
});

describe("shortened", () => {
  it("is whole when it fits, or when no limit is given", () => {
    expect(shortened("a line that fits", 16)).toBe("a line that fits");
    expect(shortened("a line that fits", undefined)).toBe("a line that fits");
  });

  it("is cut after a word that ends in the last 40% of what fits, with no space or stop before the ellipsis", () => {
    expect(shortened("one two three four five six seven eight nine ten", 30)).toBe("one two three four five six…");
    expect(shortened("a first sentence, and then a second one that goes on and on.", 30)).toBe("a first sentence, and then a…");
    expect(shortened("a first sentence. And then a second one that goes on and on.", 20)).toBe("a first sentence…");
  });

  it("is cut at the character when no word ends there, and never splits a character in two", () => {
    expect(shortened(`aaaa ${"b".repeat(34)}`, 20)).toBe(`aaaa ${"b".repeat(14)}…`);
    const wide = shortened("💥".repeat(80), 20);
    expect(Array.from(wide)).toHaveLength(20);
    expect(Array.from(wide).slice(0, 19).every((char) => char === "💥")).toBe(true);
  });
});

describe("shortenedKeepingPaths", () => {
  it("is whole when it fits, or when no limit is given", () => {
    expect(shortenedKeepingPaths(DEEP, undefined)).toBe(DEEP);
    expect(shortenedKeepingPaths("EACCES: permission denied", 25)).toBe("EACCES: permission denied");
    expect(shortenedKeepingPaths("", 10)).toBe("");
  });

  it("is cut after the last whole word that fits, with no space or stop before the ellipsis", () => {
    const long = "The model could not be reached because the network went away while the audio was on its way to it, ".repeat(3).trim();
    const line = shortenedKeepingPaths(long, 80);
    expect(Array.from(line).length).toBeLessThanOrEqual(80);
    expect(Array.from(line).length).toBeGreaterThan(60);
    expect(line).toBe("The model could not be reached because the network went away while the audio…");
    expect(line).not.toMatch(/[\s,]…$/);
  });

  it("keeps the white space it is given, so a line break stays where it was", () => {
    expect(shortenedKeepingPaths("one two\nthree four five six seven eight", 30)).toBe("one two\nthree four five six…");
  });

  it("cuts before a path that doesn't fit, and takes the word that led up to it along", () => {
    expect(shortenedKeepingPaths(DEEP, 100)).toBe("EACCES: permission denied…");
  });

  it("keeps a path that fits whole, and cuts after it", () => {
    const near = renameRefused("/tmp/lib");
    expect(shortenedKeepingPaths(near, 100)).toBe(`EACCES: permission denied, rename '/tmp/lib/${WAV}'…`);
  });

  it("cuts before a path that has a space in a folder's name, which no word-by-word cut can see: its quote is open", () => {
    // "'/Users/ana/Documents/My" fits, and "Notes/Avanzel/…" does not: the cut must not land between them.
    expect(shortenedKeepingPaths(MY_NOTES, 100)).toBe("EACCES: permission denied…");
    // iCloud Drive's folder is "Mobile Documents".
    expect(shortenedKeepingPaths(MOBILE, 100)).toBe("EACCES: permission denied…");
    // A folder named with several words.
    expect(shortenedKeepingPaths(renameRefused("/Users/ana/Documents/Notes and thoughts/Avanzel"), 100)).toBe("EACCES: permission denied…");
  });

  it("keeps a spaced path that fits whole, and cuts after its closing quote", () => {
    const near = "EACCES: permission denied, rename '/tmp/My Notes/raw/x.wav' -> '/tmp/My Notes/inbox/x.wav'";
    expect(shortenedKeepingPaths(near, 60)).toBe("EACCES: permission denied, rename '/tmp/My Notes/raw/x.wav'…");
  });

  it("treats any quote as the start of a path: a double quote too", () => {
    const text = 'Failed to move "/Users/ana/Documents/My Notes/Avanzel/raw/audio/x.wav" into the inbox because the folder is read only';
    expect(shortenedKeepingPaths(text, 60)).toBe("Failed to…");
  });

  it("leaves a word that only has an apostrophe in it alone", () => {
    const text = "The agent couldn't write what it hadn't been told to, so it stopped and said so in the log it keeps for such things";
    expect(shortenedKeepingPaths(text, 60)).toBe("The agent couldn't write what it hadn't been told to, so it…");
  });

  it("falls back to the plain cut for a path that opens the line, since nothing comes before it to keep", () => {
    const text = "'/Users/ana/Documents/My Notes/Avanzel/x.wav' could not be moved";
    expect(shortenedKeepingPaths(text, 30)).toBe(shortened(text, 30));
  });

  it("never cuts through a path, with or without a space or an apostrophe in it, whatever the room", () => {
    for (const text of [DEEP, MY_NOTES, MOBILE, ANTONS]) {
      const whole = wordsOf(text);
      for (let room = 12; room <= 260; room++) {
        const line = shortenedKeepingPaths(text, room);
        expect(Array.from(line).length, `room ${room}`).toBeLessThanOrEqual(room);
        const kept = line.replace(/…$/, "");
        // Each quote that is opened is closed, so no path is half there ...
        expect(quotesIn(kept) % 2, `room ${room}: ${line}`).toBe(0);
        // ... and a word with a slash in it is a whole word of the message.
        for (const word of wordsOf(kept)) if (word.includes("/") && !word.startsWith("'")) expect(whole, `room ${room}: ${line}`).toContain(word);
      }
    }
  });

  it("cuts a first word that is longer than the room at the character, and never splits a character in two", () => {
    const line = shortenedKeepingPaths("/a/very/long/path/".repeat(10), 30);
    expect(Array.from(line)).toHaveLength(30);
    expect(line.endsWith("…")).toBe(true);
    const wide = shortenedKeepingPaths("💥".repeat(80), 20);
    expect(Array.from(wide)).toHaveLength(20);
    expect(Array.from(wide).slice(0, 19).every((char) => char === "💥")).toBe(true);
  });
});

describe("shortReason", () => {
  it("is an error's message as a sentence, whole when it fits or when no limit is given", () => {
    expect(shortReason("Error: boom", 100)).toBe("Boom.");
    expect(shortReason(DEEP)).toBe(`${DEEP}.`);
    expect(shortReason("")).toBe("");
    expect(shortReason("EACCES: permission denied", 100)).toBe("EACCES: permission denied.");
  });

  it("cuts a long message after a whole word, with no space before the ellipsis", () => {
    const long = "the model could not be reached because the network went away while the audio was on its way to it, ".repeat(3);
    const line = shortReason(long, 80);
    expect(Array.from(line).length).toBeLessThanOrEqual(80);
    expect(Array.from(line).length).toBeGreaterThan(60);
    expect(line.endsWith("…")).toBe(true);
    expect(line).not.toMatch(/[\s,]…$/);
    expect(ownLine(long).startsWith(line.slice(0, -1))).toBe(true);
    expect(ownLine(long).charAt(line.length - 1)).toBe(" "); // a word ended there
  });

  it("cuts before a path that doesn't fit, and takes the word that led up to it along", () => {
    expect(shortReason(DEEP, 100)).toBe("EACCES: permission denied…");
    expect(shortReason(MY_NOTES, 100)).toBe("EACCES: permission denied…");
  });

  it("keeps a path that fits whole, and cuts after it", () => {
    const near = renameRefused("/tmp/lib");
    expect(shortReason(near, 100)).toBe(`EACCES: permission denied, rename '/tmp/lib/${WAV}'…`);
  });

  it("never cuts through a path, with or without a space or an apostrophe in it, whatever the room", () => {
    for (const text of [DEEP, MY_NOTES, MOBILE, ANTONS]) {
      for (let room = 12; room <= 260; room++) {
        const line = shortReason(text, room);
        expect(Array.from(line).length, `room ${room}`).toBeLessThanOrEqual(room);
        expect(quotesIn(line.replace(/…$/, "")) % 2, `room ${room}: ${line}`).toBe(0);
      }
    }
  });

  it("takes an apostrophe in a quoted path for part of the path, not for the quote that closes it", () => {
    const refused = "EACCES: permission denied, open '/Users/anton/Documents/Anton's Notes/inbox/x.md'";
    expect(shortReason(refused, 80)).toBe("EACCES: permission denied…");
    expect(shortReason(refused, 100)).toBe(`${refused}.`); // whole when it fits
    // A quoted word that closes its own quote opens none, before a comma or a stop as well, and a word with an apostrophe inside opens
    // none either: the cut falls before the path, and the word that led up to it goes too.
    expect(shortReason("Can't open 'x', 'y'. The folder '/Users/anton/Documents/Anton's Notes/inbox' is read-only", 60)).toBe(
      "Can't open 'x', 'y'. The…",
    );
  });

  it("cuts a first word that is longer than the room at the character, and never splits a character in two", () => {
    const line = shortReason("/a/very/long/path/".repeat(10), 30);
    expect(Array.from(line)).toHaveLength(30);
    expect(line.endsWith("…")).toBe(true);
    const wide = shortReason("💥".repeat(80), 20);
    expect(Array.from(wide)).toHaveLength(20);
    expect(Array.from(wide).slice(0, 19).every((char) => char === "💥")).toBe(true);
  });
});
