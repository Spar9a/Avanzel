import { Kbd } from "./Kbd.tsx";
import "../foundations.css";
import "./shortcutfield.css";

export interface ShortcutFieldProps {
  /** What the shortcut does: "Record a thought". */
  label: string;
  /** The keys as macOS writes them: "⌥Space". */
  value: string;
  /** The next shortcut typed becomes this one. */
  recording: boolean;
  /** What a screen reader is told when a recording has just ended: "Saved ⌃⇧Space", or "Not changed". */
  saved?: string;
  onClick: () => void;
}

/**
 * A shortcut as a key cap that a press changes: while it records, it asks for the new shortcut. What happens is said in a live region of its
 * own, as nothing on screen but the words in the button changes. The window does the listening, and tells it when a shortcut has come.
 */
export function ShortcutField({ label, value, recording, saved, onClick }: ShortcutFieldProps) {
  return (
    <span className="av-shortcut">
      <button
        type="button"
        className="av-shortcut-button"
        aria-label={recording ? `${label}: type the new shortcut` : `${label}: ${value}. Change`}
        onClick={onClick}
      >
        {recording ? <span className="av-shortcut-asking">Type the new shortcut…</span> : <Kbd>{value}</Kbd>}
      </button>
      <span className="av-shortcut-said" role="status">
        {recording ? "Recording. Type the new shortcut." : saved}
      </span>
    </span>
  );
}
