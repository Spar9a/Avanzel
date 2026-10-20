import "../foundations.css";
import "./zel.css";

/** Zel's six moods. Each is a state, so its face says what is happening before anyone reads a word. */
export type ZelMood = "idle" | "listening" | "thinking" | "filed" | "needs-you" | "asleep";

/** Fixed sizes keep the strokes right; Zel is never scaled freely. */
export type ZelSize = "tiny" | "small" | "medium" | "large";

/** Where the eyes look. Zel looks at the card or the words, never at the person. */
export type ZelLook = "ahead" | "up" | "down" | "left" | "right";

const LOOK: Record<ZelMood, ZelLook> = { idle: "ahead", listening: "up", thinking: "down", filed: "ahead", "needs-you": "down", asleep: "ahead" };

export interface ZelProps {
  mood: ZelMood;
  size?: ZelSize;
  look?: ZelLook;
  /** Motion for the mood: a loop while listening or thinking, which is the status itself; a hop,
      a shiver or a few floating z's for the rest, never more than five seconds. */
  animate?: boolean;
  /** Give a label only when Zel is the only thing saying what is happening. */
  label?: string;
}

/** Zel, the librarian: a rubber stamp with a violet knob for a head. It appears only in Avanzel's own
    windows. Quiet mode (<html data-zel="quiet">) leaves a plain stamp without a face. */
export function Zel({ mood, size = "medium", look, animate = true, label }: ZelProps) {
  return (
    <svg
      className="av-zel"
      data-mood={mood}
      data-size={size}
      data-look={look ?? LOOK[mood]}
      data-animate={animate ? "" : undefined}
      viewBox="0 0 120 140"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <ellipse className="av-zel-shadow" cx="60" cy="133" rx="31" ry="4.5" />
      <g className="av-zel-body">
        <rect className="av-zel-base" x="20" y="97" width="80" height="27" rx="9" />
        <rect className="av-zel-pad" x="24" y="119.5" width="72" height="8" rx="3.5" />
        <rect className="av-zel-neck" x="47" y="76" width="26" height="25" rx="7" />
        <g className="av-zel-head">
          <circle className="av-zel-knob" cx="60" cy="46" r="36" />
          <ellipse className="av-zel-shine" cx="45" cy="26" rx="12" ry="6" transform="rotate(-24 45 26)" />
          <g className="av-zel-face">
            <g className="av-zel-eyes">
              <g className="av-zel-eyes-open">
                <ellipse className="av-zel-white" cx="46" cy="50" rx="8.2" ry="10.6" />
                <ellipse className="av-zel-white" cx="74" cy="50" rx="8.2" ry="10.6" />
                <g className="av-zel-pupils">
                  <circle className="av-zel-pupil" cx="47" cy="52" r="4.8" />
                  <circle className="av-zel-pupil" cx="75" cy="52" r="4.8" />
                  <circle className="av-zel-glint" cx="48.8" cy="50" r="1.6" />
                  <circle className="av-zel-glint" cx="76.8" cy="50" r="1.6" />
                </g>
              </g>
              <g className="av-zel-eyes-happy">
                <path className="av-zel-line" d="M38 54 q8 -10 16 0" />
                <path className="av-zel-line" d="M66 54 q8 -10 16 0" />
              </g>
              <g className="av-zel-eyes-closed">
                <path className="av-zel-line" d="M38 52 q8 6 16 0" />
                <path className="av-zel-line" d="M66 52 q8 6 16 0" />
              </g>
            </g>
            <ellipse className="av-zel-cheek" cx="35" cy="64" rx="6.4" ry="3.8" />
            <ellipse className="av-zel-cheek" cx="85" cy="64" rx="6.4" ry="3.8" />
            <path className="av-zel-line av-zel-mouth-smile" d="M54 66 q6 5 12 0" />
            <path className="av-zel-mouth-open" d="M52.5 63.5 q7.5 11 15 0 z" />
            <path className="av-zel-line av-zel-mouth-wavy" d="M52 68 q2 -3 4 0 q2 3 4 0 q2 -3 4 0 q2 3 4 0" />
            <path className="av-zel-sweat" d="M93 26 q5 7 0 10.5 q-5 -3.5 0 -10.5z" />
          </g>
        </g>
      </g>
      <path className="av-zel-wave" d="M14 34 q-7 12 0 24" />
      <path className="av-zel-wave" d="M106 34 q7 12 0 24" />
      <path className="av-zel-wave av-zel-wave-far" d="M5 28 q-9 18 0 36" />
      <path className="av-zel-wave av-zel-wave-far" d="M115 28 q9 18 0 36" />
      <text className="av-zel-z" x="94" y="20" fontSize="15">z</text>
      <text className="av-zel-z av-zel-z-far" x="104" y="8" fontSize="11">z</text>
    </svg>
  );
}
