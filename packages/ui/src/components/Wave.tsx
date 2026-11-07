import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import "../foundations.css";
import "./wave.css";

/** One bar and the gap after it, in px: what a filling wave counts its bars by. */
const BAR_PITCH = 5;

/**
 * Voice level bars, newest on the right. `levels` are 0 to 1, one per bar; 24 bars fit a recording's row in the capsule, 16 beside a
 * line. `tone`: violet ink, or the surface's own, as on the capsule's glass, where the colour is left to what stands for the words.
 * `fill`: the wave takes all the room its row leaves it, with as many bars as fit, each showing the level of its share of `levels`
 * (the newest still on the right).
 */
export function Wave({ levels, tone = "accent", fill = false }: { levels: readonly number[]; tone?: "accent" | "ink"; fill?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(levels.length);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!fill || !el) return;
    const measure = () => setCount(Math.max(levels.length, Math.floor((el.getBoundingClientRect().width + 2) / BAR_PITCH)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fill, levels.length]);
  const bars = fill && levels.length > 0 ? Array.from({ length: count }, (_, i) => levels[Math.floor((i * levels.length) / count)] ?? 0) : levels;
  return (
    <span ref={ref} className="av-wave" data-tone={tone} data-fill={fill ? "" : undefined} aria-hidden="true">
      {bars.map((level, i) => (
        <i key={i} style={{ "--_level": Math.min(1, Math.max(0, level)).toFixed(3) } as CSSProperties} />
      ))}
    </span>
  );
}
