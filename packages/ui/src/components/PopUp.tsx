import { Icon } from "./Icon.tsx";
import "../foundations.css";
import "./popup.css";

export interface PopUpProps {
  /** What is being chosen: "Microphone". With `value` it names the button, so VoiceOver says both. */
  label: string;
  /** The choice now: "System default". */
  value: string;
  disabled?: boolean;
  /** Opens the list. The list is a native menu, which macOS draws and a page can't, so the window asks main for it. */
  onClick: () => void;
}

/** A pop-up button: the current choice of a flat list, with up and down chevrons. It goes beside a label that says what is being chosen. */
export function PopUp({ label, value, disabled, onClick }: PopUpProps) {
  return (
    <button type="button" className="av-popup" aria-haspopup="menu" aria-label={`${label}: ${value}`} disabled={disabled} onClick={onClick}>
      <span className="av-popup-value">{value}</span>
      <Icon name="chevrons" size={12} />
    </button>
  );
}
