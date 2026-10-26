// Keeping the end of what a process prints, however much it prints.

/** A chunk that is held, and the one written after it. */
interface Link {
  chunk: Buffer;
  next: Link | null;
}

export interface TailKeeper {
  /** Keeps `chunk`, and lets go of the oldest chunks that the ones after them make no use of. */
  write(chunk: Buffer): void;
  /**
   * The last `limit` bytes written, as text, from the first whole character: where the cut falls inside a character, the
   * rest of it isn't kept, which is up to 3 bytes fewer than `limit`.
   */
  text(): string;
  /** How many bytes of chunks are held now, counted from the chunks. Between writes, fewer than `limit` plus the oldest chunk. */
  readonly held: number;
}

/**
 * Keeps the end of what a process prints: the last `limit` bytes of the chunks written to it, however many come. The
 * oldest chunk is let go as soon as the chunks after it hold `limit` bytes without it. So, while the chunks come, what is
 * held is less than `limit` bytes and the oldest chunk (a chunk is held whole, or let go whole), and a write costs the same
 * however small the chunks are, a byte each or more. `text()` gives the last `limit` bytes as text, from the first whole
 * character: up to 3 bytes fewer, where the cut falls inside one.
 */
export function tailKeeper(limit: number): TailKeeper {
  let oldest: Link | null = null;
  let newest: Link | null = null;
  let size = 0; // the bytes held
  let total = 0; // the bytes written
  return {
    get held() {
      let bytes = 0;
      for (let link = oldest; link; link = link.next) bytes += link.chunk.length;
      return bytes;
    },
    write(chunk) {
      const link: Link = { chunk, next: null };
      if (newest) newest.next = link;
      else oldest = link;
      newest = link;
      size += chunk.length;
      total += chunk.length;
      // The oldest chunk goes as soon as the ones after it hold the last `limit` bytes without it.
      while (oldest?.next && size - oldest.chunk.length >= limit) {
        size -= oldest.chunk.length;
        oldest = oldest.next;
      }
    },
    text() {
      const chunks: Buffer[] = [];
      for (let link = oldest; link; link = link.next) chunks.push(link.chunk);
      const bytes = Buffer.concat(chunks);
      // What is held is at least `limit` bytes once more than that has been written.
      let start = Math.max(0, bytes.length - limit);
      if (total > limit) {
        // Bytes were cut off, and the cut may fall inside a character: the rest of it isn't kept. (A character has at
        // most 3 UTF-8 continuation bytes after its first, and each is 10xxxxxx.)
        for (let rest = 0; rest < 3 && ((bytes[start] ?? 0) & 0xc0) === 0x80; rest++) start += 1;
      }
      return bytes.subarray(start).toString("utf8");
    },
  };
}
