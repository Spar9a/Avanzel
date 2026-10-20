import type { CSSProperties } from "react";
import "../foundations.css";
import "./wave.css";

/** Voice level bars, newest on the right. `levels` are 0 to 1, one per bar; 16 bars fit the capsule. */
export function Wave({ levels }: { levels: readonly number[] }) {
  return (
    <span className="av-wave" aria-hidden="true">
      {levels.map((level, i) => (
        <i key={i} style={{ "--_level": Math.min(1, Math.max(0, level)).toFixed(3) } as CSSProperties} />
      ))}
    </span>
  );
}
