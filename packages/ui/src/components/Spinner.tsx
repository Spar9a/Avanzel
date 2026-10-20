import "../foundations.css";
import "./feedback.css";

export interface SpinnerProps {
  size?: "small" | "regular";
  /** Read out by VoiceOver. Leave it out when text beside the spinner already says what is running. */
  label?: string;
}

/** Work with no known length. Past ten seconds, say what is happening and offer a way out. */
export function Spinner({ size = "regular", label }: SpinnerProps) {
  return <span className="av-spinner" data-size={size} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
