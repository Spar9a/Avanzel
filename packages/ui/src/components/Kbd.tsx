import "../foundations.css";
import "./kbd.css";

export interface KbdProps {
  /** The keys as macOS writes them: "⌥Space", "⌘↩". */
  children: string;
  /** key: a big keycap, as in setup when Zel teaches the shortcut. */
  size?: "inline" | "key";
  /** Drawn pushed down, for showing a press. */
  pressed?: boolean;
}

export function Kbd({ children, size = "inline", pressed }: KbdProps) {
  return <kbd className="av-kbd" data-size={size} data-pressed={pressed ? "" : undefined}>{children}</kbd>;
}
