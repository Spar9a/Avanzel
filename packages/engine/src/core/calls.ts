// A call is two streams of speech: the microphone ("you") and the call app's sound ("them"). Merged by time they read
// as the transcript of the conversation.
import type { TimedText } from "../types.ts";

export type Speaker = "you" | "them";

export interface CallLine extends TimedText {
  speaker: Speaker;
}

/** How much of a "you" segment another side's segment must cover for it to count as the same sound. */
const ECHO_OVERLAP = 0.5;
/** The covering segment may be at most this many times as long as the "you" one: a short reply inside a long speech is not its echo. */
const ECHO_LENGTH = 1.5;
/** The share of a "you" segment's words that must occur, in the same order, in the covering segment. */
const ECHO_WORDS = 0.6;
/** A "you" segment of fewer words is never taken for an echo: "Okay, sure." is said on both sides of every call. */
const ECHO_MIN_WORDS = 3;

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/** How many words of `a` occur in `b` in the same order (the longest common subsequence). */
function inOrder(a: readonly string[], b: readonly string[]): number {
  let row = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const next = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) next[j] = word === b[j - 1] ? row[j - 1]! + 1 : Math.max(row[j]!, next[j - 1]!);
    row = next;
  }
  return row[b.length]!;
}

/**
 * The "you" segments without those that are the call app's sound picked up again by the microphone (without headphones
 * the same sentence would otherwise be in both streams). A segment of three words or more goes when a "them" segment
 * covers at least half its length, is no more than 1.5 times as long, and says at least 60 % of its words in their order.
 * When either side is a single segment (a transcriber that gives the whole stream as one, or a short call) times say
 * nothing about which sentence is which, and every segment stays.
 */
export function dropEcho(you: readonly TimedText[], them: readonly TimedText[]): TimedText[] {
  if (you.length <= 1 || them.length <= 1) return [...you];
  return you.filter((segment) => {
    const length = segment.end - segment.start;
    const spoken = words(segment.text);
    if (length <= 0 || spoken.length < ECHO_MIN_WORDS) return true;
    return !them.some((other) => {
      const overlap = Math.min(segment.end, other.end) - Math.max(segment.start, other.start);
      if (overlap < length * ECHO_OVERLAP || other.end - other.start > length * ECHO_LENGTH) return false;
      return inOrder(spoken, words(other.text)) >= spoken.length * ECHO_WORDS;
    });
  });
}

/** Both sides in one list ordered by start; when two begin together, "them" comes first. */
export function mergeCall(you: readonly TimedText[], them: readonly TimedText[]): CallLine[] {
  const lines: CallLine[] = [
    ...them.map((segment): CallLine => ({ ...segment, speaker: "them" })),
    ...you.map((segment): CallLine => ({ ...segment, speaker: "you" })),
  ];
  return lines.sort((a, b) => a.start - b.start);
}

function stamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `[${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}]`;
}

/** One paragraph per line, `[mm:ss] You: …`; minutes keep counting past 59 rather than adding hours. */
export function callTranscript(lines: readonly CallLine[]): string {
  return lines.map((line) => `${stamp(line.start)} ${line.speaker === "you" ? "You" : "Them"}: ${line.text}\n`).join("\n");
}
