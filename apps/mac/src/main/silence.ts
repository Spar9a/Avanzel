// When a recording that made no words says so, and when it just goes.

/** A wordless recording longer than this (in seconds of audio) says nothing was heard: someone spoke, or meant to, and wasn't heard. */
export const NOTHING_HEARD_AFTER_S = 5;

/** Below this peak (about -80 dBFS) the microphone gave nothing at all: no input, not a quiet room, whose noise is louder. */
const NO_INPUT_PEAK = 1e-4;

/**
 * Whether a recording of `samples` that made no words says so (`NOTHING_HEARD`): when the microphone gave no input at all, or when it ran
 * past `NOTHING_HEARD_AFTER_S`. A shorter one, with sound in it, was a press and a stop: it goes quietly.
 */
export function saysNothingHeard(samples: Float32Array): boolean {
  if (samples.length / 16000 > NOTHING_HEARD_AFTER_S) return true;
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak < NO_INPUT_PEAK;
}
