import { useCallback, useEffect, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon.tsx";
import { Kbd } from "./Kbd.tsx";
import { Spinner } from "./Spinner.tsx";
import "../foundations.css";
import "./button.css";

/** primary: the one action the moment is about. secondary: the others. quiet: dismissals such as
    "Not now". link: an action inside text. danger: an action that deletes or can't be undone.
    page: opens a page of the library, as the sources under an answer do, so it reads as a page and not as a link. */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "link" | "danger" | "page";
/** xlarge: a recording's controls, in the capsule and the panel: 44 px, with 16 px words. */
export type ButtonSize = "small" | "regular" | "large" | "xlarge";

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
  /** It has opened something of its own that is showing now, such as a page's bin its question: said to VoiceOver, and a danger icon shakes. */
  expanded?: boolean;
}

/** A button with a label: a plain string in sentence case that starts with a verb. */
interface Labelled extends Common {
  children: string;
  icon?: IconName;
  label?: never;
  /** Its shortcut as macOS writes it (`⌥⇧R`), after the label, when it has one: the key that does the same from any app. */
  shortcut?: string;
}

/** A button with only an icon. `label` is its accessible name and its tooltip. */
interface IconOnly extends Common {
  icon: IconName;
  label: string;
  children?: never;
  /**
   * A small second icon at its corner, for what the button will do as well: the capsule's Stop wears ✦ while the agent files the
   * recording at once and ☾ while it waits for the evening review. The label must say it too.
   */
  badge?: IconName;
  /**
   * How many of something it holds, as a number on its top corner while there are any: the recording's Add counts the files that go
   * with it. The label must say it too ("Add a file… 2 added").
   */
  count?: number;
}

export type ButtonProps = Labelled | IconOnly;

export function Button(props: ButtonProps) {
  const { variant = "secondary", size = "regular", wrap, disabled, busy, type = "button", autoFocus, onClick, icon, children, label, expanded } = props;
  const badge = "badge" in props ? props.badge : undefined;
  const count = "count" in props && props.count ? props.count : 0;
  const shortcut = "shortcut" in props ? props.shortcut : undefined;
  const iconOnly = children === undefined;
  const tip = useTip(iconOnly && !expanded ? label : undefined);
  return (
    <button
      ref={tip.ref}
      type={type}
      className="av-button"
      data-variant={variant}
      data-size={size}
      data-wrap={wrap ? "" : undefined}
      data-icon-only={iconOnly ? "" : undefined}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-expanded={expanded}
      aria-label={label}
      autoFocus={autoFocus}
      onClick={() => {
        tip.hide();
        if (!busy) onClick?.();
      }}
      {...tip.handlers}
    >
      {busy ? <Spinner size="small" /> : icon && <Icon name={icon} size={iconSize(icon, size)} />}
      {children}
      {shortcut && <span className="av-button-key"><Kbd>{shortcut}</Kbd></span>}
      {count > 0 && (
        <span key={count} className="av-button-count" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      )}
      {badge && (
        <span key={badge} className="av-button-badge" data-badge={badge}>
          <Icon name={badge} size={12} />
        </span>
      )}
      {tip.shown}
    </button>
  );
}

/** Icons drawn a step larger than the rest: the bin, so the one that deletes reads at a glance, and the keyboard, whose keys are fine. */
const LARGER: ReadonlySet<IconName> = new Set<IconName>(["trash", "type"]);

/** An icon's size on a button of `size`. */
function iconSize(icon: IconName, size: ButtonSize): 12 | 16 | 20 {
  const base = size === "xlarge" ? 20 : size === "large" ? 16 : 12;
  return LARGER.has(icon) && base < 20 ? (base === 12 ? 16 : 20) : base;
}

/** How long the pointer rests on an icon button before its name shows. */
const TIP_DELAY_MS = 450;
/** The room the name needs over the button; with less, it shows under it. */
const TIP_ROOM = 40;

/**
 * An icon button's name, shown as the pointer rests on it (or the keyboard's focus comes to it): on the capsule's glass, over the
 * button, or under it at the window's top. It is drawn at the page's top level, so no list or card that clips its content hides it;
 * VoiceOver has the name from the button's own label. macOS shows no tooltips in a window that isn't in front, as the panel isn't.
 */
function useTip(text: string | undefined) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [at, setAt] = useState<{ x: number; y: number; under: boolean } | null>(null);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setAt(null);
  }, []);
  const show = useCallback(
    (now: boolean) => {
      if (!text) return;
      if (timer.current) clearTimeout(timer.current);
      const place = () => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const under = box.top < TIP_ROOM;
        setAt({ x: box.left + box.width / 2, y: under ? box.bottom : box.top, under });
      };
      if (now) place();
      else timer.current = setTimeout(place, TIP_DELAY_MS);
    },
    [text],
  );
  useEffect(() => hide, [hide]);
  useEffect(() => {
    if (!text) hide();
  }, [text, hide]);
  const handlers = text
    ? {
        onPointerEnter: () => show(false),
        onPointerLeave: hide,
        onPointerDown: hide,
        onFocus: (event: FocusEvent<HTMLButtonElement>) => {
          if (event.currentTarget.matches(":focus-visible")) show(true);
        },
        onBlur: hide,
      }
    : {};
  const style = at ? ({ "--_x": `${at.x}px`, "--_y": `${at.y}px` } as CSSProperties) : undefined;
  const shown =
    at && text
      ? createPortal(
          <span className="av-button-tip" data-under={at.under ? "" : undefined} style={style} aria-hidden="true">
            {text}
          </span>,
          document.body,
        )
      : null;
  return { ref, handlers, hide, shown };
}
