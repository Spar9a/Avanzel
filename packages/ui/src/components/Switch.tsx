import { useId } from "react";
import "../foundations.css";
import "./switch.css";

export interface SwitchProps {
  /** What turns on, in a few words: "Sounds", "Keep Zel on my desktop". */
  label: string;
  /** One sentence on what changes, when the label alone doesn't say. */
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** An on/off setting that applies at once. Its label sits on the left and the switch on the right;
    in a Group it becomes one of the group's rows. */
export function Switch({ label, description, checked, onChange, disabled }: SwitchProps) {
  const id = useId();
  return (
    <label className="av-switch-row" data-disabled={disabled ? "" : undefined}>
      <span className="av-switch-text">
        <span id={`${id}-label`} className="av-switch-label">{label}</span>
        {description && <span id={`${id}-description`} className="av-switch-description">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        className="av-switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </label>
  );
}
