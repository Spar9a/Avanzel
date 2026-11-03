import "../foundations.css";
import "./badge.css";

export interface BadgeProps {
  /** accent: a recommendation, such as "Best results". neutral: a plain fact. */
  tone?: "accent" | "neutral";
  /** A word or two, in sentence case. */
  children: string;
}

/** A small pill that says something about the row it sits in. It is read as part of the row, so it takes no action. */
export function Badge({ tone = "accent", children }: BadgeProps) {
  return <span className="av-badge" data-tone={tone}>{children}</span>;
}
