import { Icon, type IconName } from "./Icon.tsx";
import { Spinner } from "./Spinner.tsx";
import "../foundations.css";
import "./button.css";

/** primary: the one action the moment is about. secondary: the others. quiet: dismissals such as
    "Not now". link: an action inside text. danger: an action that deletes or can't be undone.
    page: opens a page of the library, as the sources under an answer do, so it reads as a page and not as a link. */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "link" | "danger" | "page";
export type ButtonSize = "small" | "regular" | "large";

interface Common {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Let a long label wrap onto more lines, the button growing taller. Without it the label stays on one line. */
  wrap?: boolean;
  disabled?: boolean;
  /** Shows a spinner and ignores clicks while the work runs. The label stays, saying what runs. */
  busy?: boolean;
  type?: "button" | "submit";
  autoFocus?: boolean;
  onClick?: () => void;
}

/** A button with a label: a plain string in sentence case that starts with a verb. */
interface Labelled extends Common {
  children: string;
  icon?: IconName;
  label?: never;
}

/** A button with only an icon. `label` is its accessible name and its tooltip. */
interface IconOnly extends Common {
  icon: IconName;
  label: string;
  children?: never;
}

export type ButtonProps = Labelled | IconOnly;

export function Button(props: ButtonProps) {
  const { variant = "secondary", size = "regular", wrap, disabled, busy, type = "button", autoFocus, onClick, icon, children, label } = props;
  const iconOnly = children === undefined;
  return (
    <button
      type={type}
      className="av-button"
      data-variant={variant}
      data-size={size}
      data-wrap={wrap ? "" : undefined}
      data-icon-only={iconOnly ? "" : undefined}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-label={label}
      title={label}
      autoFocus={autoFocus}
      onClick={busy ? undefined : onClick}
    >
      {busy ? <Spinner size="small" /> : icon && <Icon name={icon} size={size === "large" ? 16 : 12} />}
      {children}
    </button>
  );
}
