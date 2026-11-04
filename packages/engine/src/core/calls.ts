// A call is two streams of speech: the microphone ("you") and the call app's sound ("them"). Merged by time they read
// as the transcript of the conversation.
import type { TimedText } from "../types.ts";

export type Speaker = "you" | "them";

export interface CallLine extends TimedText {
  speaker: Speaker;
}

/** How much of a "you" segment another side's segment must cover for it to count as the same sound. */
const ECHO_OVERLAP = 0.5;
/** The share of a "you" segment's words that must occur in the covering segment. */
const ECHO_WORDS = 0.6;

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/**
 * The "you" segments without those that are the call app's sound picked up again by the microphone: a segment goes
 * when a "them" segment covers at least half its length and says at least 60 % of its words. Without headphones the
 * same sentence would otherwise be in both streams.
 */
export function dropEcho(you: readonly TimedText[], them: readonly TimedText[]): TimedText[] {
  return you.filter((segment) => {
    const length = segment.end - segment.start;
    const spoken = words(segment.text);
    if (length <= 0 || spoken.length === 0) return true;
    return !them.some((other) => {
      const overlap = Math.min(segment.end, other.end) - Math.max(segment.start, other.start);
      if (overlap < length * ECHO_OVERLAP) return false;
      const heard = new Set(words(other.text));
      return spoken.filter((word) => heard.has(word)).length >= spoken.length * ECHO_WORDS;
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
