import { useId, type CSSProperties } from "react";
import "../foundations.css";
import "./stamp.css";

/** The words a stamp can say. Each is the ending of one kind of work, so there are few of them. */
export type StampWord = "filed" | "noted" | "saved" | "letter" | "remembered" | "hello";

const SPOKEN: Record<StampWord, string> = {
  filed: "Filed",
  noted: "Noted",
  saved: "Saved",
  letter: "Letter",
  remembered: "Remembered",
  hello: "Hello",
};

export interface StampProps {
  word: StampWord;
  /** The day, as "20 Oct 2026"; the stamp prints it in capitals. */
  date?: string;
  size?: "xs" | "small" | "regular";
  /** Lands with a thunk when it appears. Use it for the moment the work finishes, not for a list of old stamps. */
  animate?: boolean;
}

/** Violet ink with a little grain: proof the work happened. The receipt of a capture, a letter or a recall. */
export function Stamp({ word, date, size = "regular", animate }: StampProps) {
  const ink = `av-ink${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span
      className="av-stamp"
      data-size={size}
      data-animate={animate ? "" : undefined}
      role="img"
      aria-label={date ? `${SPOKEN[word]}, ${date}` : SPOKEN[word]}
      style={{ "--_ink": `url(#${ink})` } as CSSProperties}
    >
      <svg className="av-stamp-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id={ink} x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves={2} seed={7} result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -6 0 0 0 4.1" result="mask" />
          <feComposite in="SourceGraphic" in2="mask" operator="in" result="inked" />
          <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves={1} seed={2} result="drift" />
          <feDisplacementMap in="inked" in2="drift" scale={2.4} />
        </filter>
      </svg>
      <b aria-hidden="true">{SPOKEN[word]}</b>
      {date && <small aria-hidden="true">{date}</small>}
    </span>
  );
}
