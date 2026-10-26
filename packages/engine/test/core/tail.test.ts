// What tailKeeper keeps of what a process prints: the last bytes, begun at a whole character, and never much more than that
// while the chunks come. The chunks here are staged, so that the cut falls where each test says.
import { describe, expect, it } from "vitest";
import { tailKeeper } from "../../src/core/tail.ts";

/** A keeper that has been written `chunks`, in order. */
function kept(limit: number, chunks: readonly (string | Buffer)[]) {
  const keeper = tailKeeper(limit);
  for (const chunk of chunks) keeper.write(Buffer.from(chunk));
  return keeper;
}

/** `text` as bytes, cut into chunks of `size` bytes wherever that falls, inside a character or not. */
function inChunks(text: string, size: number): Buffer[] {
  const bytes = Buffer.from(text);
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
}

describe("tailKeeper", () => {
  it("keeps all of what is written, up to the limit", () => {
    expect(kept(10, []).text()).toBe("");
    expect(kept(10, ["abc", "def"]).text()).toBe("abcdef");
    expect(kept(10, ["abcde", "fghij"]).text()).toBe("abcdefghij"); // exactly the limit
  });

  it("lets go of the first byte as soon as there is one over the limit", () => {
    expect(kept(5, ["abcdef"]).text()).toBe("bcdef");
    expect(kept(5, ["abc", "def"]).text()).toBe("bcdef");
    expect(kept(5, ["abcde", "f"]).text()).toBe("bcdef");
    expect(kept(5, ["a", "b", "c", "d", "e", "f"]).text()).toBe("bcdef");
  });

  it("keeps the last bytes of a long stream, however the chunks come", () => {
    const limit = 64;
    const stream = Array.from({ length: 5000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    for (const size of [1, 2, 3, 7, 63, 64, 65, 200, 4999, 5000]) {
      expect(kept(limit, inChunks(stream, size)).text(), `chunks of ${size}`).toBe(stream.slice(-limit));
    }
    // And chunks of every size in turn, empty ones among them.
    const sizes = [5, 0, 1, 90, 2, 64, 3, 0, 65, 7];
    const chunks: Buffer[] = [];
    for (let at = 0, i = 0; at < stream.length; i++) {
      const size = sizes[i % sizes.length] ?? 1;
      chunks.push(Buffer.from(stream.slice(at, at + size)));
      at += size;
    }
    expect(kept(limit, chunks).text()).toBe(stream.slice(-limit));
  });

  it("can be read at any time, and goes on", () => {
    const keeper = kept(4, ["abc"]);
    expect(keeper.text()).toBe("abc");
    keeper.write(Buffer.from("def"));
    expect(keeper.text()).toBe("cdef");
    expect(keeper.text()).toBe("cdef");
  });

  describe("begins at a whole character", () => {
    // 2, 3 and 4 bytes to a character. The limit takes each value over the length of one, so the cut falls at each byte of
    // the character, and the chunks are cut in every place, inside the characters too.
    for (const [character, width] of [["é", 2], ["€", 3], ["😀", 4]] as const) {
      it(`${character}, ${width} bytes, whichever of them the cut falls at`, () => {
        const stream = `ab${character.repeat(20)}`;
        for (let limit = 10; limit < 10 + width; limit++) {
          // The last `limit` bytes are some whole characters, and the end of the one before them.
          const whole = character.repeat(Math.floor(limit / width));
          for (const size of [1, 2, 3, 5, Buffer.byteLength(stream)]) {
            expect(kept(limit, inChunks(stream, size)).text(), `${limit} bytes, in chunks of ${size}`).toBe(whole);
          }
        }
      });
    }

    it("keeps a character that the cut leaves whole", () => {
      expect(kept(8, ["ab😀😀😀"]).text()).toBe("😀😀"); // 14 bytes; the last 8 are two emoji
      expect(kept(6, ["ab€€€"]).text()).toBe("€€");
      expect(kept(4, ["abéééé"]).text()).toBe("éé");
    });
  });

  describe("while the chunks come", () => {
    const limit = 100;
    // Chunks smaller than the limit, a part of it that makes it exactly, at it, and bigger than it; and sizes mixed.
    const shapes = [[1], [7], [30], [50], [99], [100], [101], [250], [1, 50, 3, 200, 17]];

    it("holds no more than the limit and the oldest chunk it holds, and no fewer bytes than it needs", () => {
      for (const sizes of shapes) {
        const keeper = tailKeeper(limit);
        const biggest = Math.max(...sizes);
        let written = 0;
        for (let i = 0; i < 1000; i++) {
          const size = sizes[i % sizes.length] ?? 1;
          keeper.write(Buffer.alloc(size, i % 251));
          written += size;
          expect(keeper.held, `chunk ${i} of sizes ${sizes}`).toBeLessThan(limit + biggest);
          expect(keeper.held, `chunk ${i} of sizes ${sizes}`).toBeGreaterThanOrEqual(Math.min(written, limit));
        }
      }
    });

    it("is read as the last bytes after any of it", () => {
      for (const sizes of shapes) {
        const keeper = tailKeeper(limit);
        const all: Buffer[] = [];
        for (let i = 0; i < 300; i++) {
          const chunk = Buffer.alloc(sizes[i % sizes.length] ?? 1, 97 + (i % 26));
          all.push(chunk);
          keeper.write(chunk);
          if (i % 7 === 0) expect(keeper.text(), `chunk ${i} of sizes ${sizes}`).toBe(Buffer.concat(all).subarray(-limit).toString());
        }
      }
    });
  });
});
