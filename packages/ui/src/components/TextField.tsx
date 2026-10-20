import { useId, type ReactNode, type Ref } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import "../foundations.css";
import "./field.css";

interface FieldCommon {
  /** Always given: it names the field for VoiceOver even when `labelHidden` hides it on screen. */
  label: string;
  labelHidden?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** One line under the field: what goes in it, or why it was refused. */
  description?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onEscape?: () => void;
}

export interface TextFieldProps extends FieldCommon {
  /** large: a window that is one field, like Quick. */
  size?: "regular" | "large";
  /** bare: no box, for a field that is the whole window. */
  variant?: "boxed" | "bare";
  icon?: IconName;
  type?: "text" | "search" | "url";
  onEnter?: () => void;
  /** A small control at the field's end, such as <Button size="small" variant="quiet">Clear</Button>. */
  action?: ReactNode;
  /** For putting the cursor back in the field: ref.current?.focus(). */
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, labelHidden, value, onChange, placeholder, description, disabled, autoFocus, onEscape, size = "regular", variant = "boxed", icon, type = "text", onEnter, action, ref }: TextFieldProps) {
  const id = useId();
  return (
    <div className="av-field" data-size={size} data-variant={variant}>
      <label htmlFor={id} className="av-field-label" data-hidden={labelHidden ? "" : undefined}>{label}</label>
      <div className="av-field-box">
        {icon && <Icon name={icon} size={size === "large" ? 20 : 16} />}
        <input
          ref={ref}
          id={id}
          className="av-field-input"
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={description ? `${id}-description` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); }
            if (e.key === "Escape" && onEscape) { e.preventDefault(); onEscape(); }
          }}
        />
        {action && <span className="av-field-action">{action}</span>}
      </div>
      {description && <p id={`${id}-description`} className="av-field-description">{description}</p>}
    </div>
  );
}

export interface TextAreaProps extends FieldCommon {
  /** Lines shown before it scrolls. */
  rows?: number;
  /** Return without Shift. Shift-Return still starts a new line. */
  onEnter?: () => void;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ label, labelHidden, value, onChange, placeholder, description, disabled, autoFocus, onEscape, rows = 4, onEnter, ref }: TextAreaProps) {
  const id = useId();
  return (
    <div className="av-field" data-multiline="">
      <label htmlFor={id} className="av-field-label" data-hidden={labelHidden ? "" : undefined}>{label}</label>
      <div className="av-field-box">
        <textarea
          ref={ref}
          id={id}
          className="av-field-input"
          rows={rows}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={description ? `${id}-description` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && onEnter) { e.preventDefault(); onEnter(); }
            if (e.key === "Escape" && onEscape) { e.preventDefault(); onEscape(); }
          }}
        />
      </div>
      {description && <p id={`${id}-description`} className="av-field-description">{description}</p>}
    </div>
  );
}
