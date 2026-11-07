import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import "../foundations.css";
import "./segmented.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** An icon before the label, for a choice that has a sign of its own: ✦ for now, ☾ for the evening review. */
  icon?: IconName;
}

export interface SegmentedProps<T extends string> {
  /** Names the choice for VoiceOver: "Appearance". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** large: beside a recording's xlarge controls, 40 px tall with 16 px words. */
  size?: "regular" | "large";
}

/**
 * Two to five short, mutually exclusive choices. The arrow keys move between them. The chosen one sits on a thumb that slides and
 * stretches to the next as the choice changes, and each choice holds room for its bold label, so nothing in the row moves.
 */
export function Segmented<T extends string>({ label, options, value, onChange, disabled, size = "regular" }: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  // Where the chosen choice is, measured from it, so the thumb slides there as the choice changes.
  const [thumb, setThumb] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const button = buttons.current[selected];
      if (button) setThumb({ x: button.offsetLeft, y: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight });
    };
    measure();
    const box = group.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, [selected, options]);
  const move = (from: number, step: number) => {
    const next = (from + step + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttons.current[next]?.focus();
  };
  return (
    <div ref={group} className="av-segmented" data-size={size} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {/* First in the row, so the choices are painted over it. */}
      {thumb && (
        <i
          className="av-segmented-thumb"
          aria-hidden="true"
          style={{ "--_x": `${thumb.x}px`, "--_y": `${thumb.y}px`, "--_width": `${thumb.width}px`, "--_height": `${thumb.height}px` } as CSSProperties}
        />
      )}
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => { buttons.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={i === selected ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i, 1); }
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i, -1); }
          }}
        >
          {option.icon && <Icon name={option.icon} size={size === "large" ? 16 : 12} />}
          {/* data-label: the label again, bold and out of sight, so a choice is as wide chosen as not. */}
          <span className="av-segmented-label" data-label={option.label}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
