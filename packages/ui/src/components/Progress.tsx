import type { CSSProperties } from "react";
import "../foundations.css";
import "./feedback.css";

export interface ProgressProps {
  /** What is filling up, for VoiceOver: "Downloading the speech model". */
  label: string;
  /** 0 to 1. Leave it out when the length is unknown. */
  value?: number;
  width?: "short" | "fill";
}

export function Progress({ label, value, width = "fill" }: ProgressProps) {
  const percent = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span
      className="av-progress"
      data-width={width}
      data-indeterminate={percent === undefined ? "" : undefined}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <i style={percent === undefined ? undefined : ({ "--_progress": `${percent}%` } as CSSProperties)} />
    </span>
  );
}
