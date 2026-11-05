import type { CSSProperties } from "react";
import "../foundations.css";
import "./wave.css";

/** Voice level bars, newest on the right. `levels` are 0 to 1, one per bar; 24 bars fit a recording's row in the capsule, 16 beside a
    line. `tone`: violet ink, or the surface's own, as on the capsule's glass, where the colour is left to what stands for the words. */
export function Wave({ levels, tone = "accent" }: { levels: readonly number[]; tone?: "accent" | "ink" }) {
  return (
    <span className="av-wave" data-tone={tone} aria-hidden="true">
      {levels.map((level, i) => (
        <i key={i} style={{ "--_level": Math.min(1, Math.max(0, level)).toFixed(3) } as CSSProperties} />
      ))}
    </span>
  );
}
