import { useRef } from "react";
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
}

/** Two to five short, mutually exclusive choices. The arrow keys move between them. */
export function Segmented<T extends string>({ label, options, value, onChange, disabled }: SegmentedProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (from: number, step: number) => {
    const next = (from + step + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttons.current[next]?.focus();
  };
  return (
    <div className="av-segmented" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
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
          {option.icon && <Icon name={option.icon} size={12} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
