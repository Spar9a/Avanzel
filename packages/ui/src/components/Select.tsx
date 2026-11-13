import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon.tsx";
import { ShelfGlyph, shelfKey, type AnyShelf } from "./Shelf.tsx";
import "../foundations.css";
import "./button.css";
import "./select.css";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A heading the option starts a run of, as "Shelves" over the shelves and "Status" over the statuses. */
  section?: string;
  /**
   * The shelf the option is: it shows the shelf's glyph and is set in the shelf's colour, and while it is chosen the button wears the
   * shelf's colour too, as a shelf chip does. A shelf the owner made wears the own-shelf colour and glyph.
   */
  shelf?: AnyShelf;
  /** An icon before the choice's words, as a menu of actions has: `folder` for Attach a file. */
  icon?: IconName;
}

export interface SelectProps<T extends string> {
  /** Names the choice for VoiceOver: "Sort by". */
  label: string;
  options: readonly SelectOption<T>[];
  /** The value chosen, or null for none yet: the button then says `placeholder`. */
  value: T | null;
  onChange: (value: T) => void;
  /** What the button says while nothing is chosen: "Choose…". */
  placeholder?: string;
  /** An icon before the chosen label, as on a toolbar: `settings` for Filter. */
  icon?: IconName;
  /** What the button says in place of the chosen label, as "Filter" while every page shows. */
  buttonLabel?: string;
  size?: "small" | "regular";
  disabled?: boolean;
  /**
   * Given, a choice that can be undone, as a filter: while `clearable`, an × in the button's own pill, in place of its chevron, calls
   * it (named `clearLabel`, "Clear the filter"), and the rest of the pill still opens the menu.
   */
  onClear?: () => void;
  clearable?: boolean;
  clearLabel?: string;
  /**
   * Given, the button is a round icon button, as the recording's +, and the Select a menu of actions: nothing is chosen (`value` null),
   * `label` is the button's name and its tooltip, and picking a choice calls `onChange` with it.
   */
  trigger?: {
    icon: IconName;
    size?: "regular" | "large" | "xlarge";
    variant?: "primary" | "secondary";
    /** How many it holds, as `Button`'s `count`: the recording's Add counts its files. `label` says it too. */
    count?: number;
  };
}

/** The menu's room inside the window: it never goes past its edges, by this much. */
const EDGE = 8;

/**
 * A pop-up button: it says what is chosen, and opens a menu of the choices under it, drawn in Avanzel's own style and kept inside
 * the window (above the button when there is no room below). The arrow keys move through the choices, Return or a click picks one,
 * and Esc or a click elsewhere closes it.
 */
export function Select<T extends string>({ label, options, value, onChange, placeholder = "Choose…", icon, buttonLabel, size = "small", disabled, onClear, clearable = false, clearLabel, trigger }: SelectProps<T>) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const chosen = options.find((o) => o.value === value);

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    setPlace(null);
    if (focusButton) button.current?.focus();
  }, []);
  const pick = (option: SelectOption<T>) => {
    close(true);
    if (trigger || option.value !== value) onChange(option.value);
  };
  const show = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  // Where the menu goes: under the button, as wide as the widest choice, moved in from the window's edges, and above the button
  // when there is more room there. Measured before it is painted, so it never shows in the wrong place.
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const at = button.current.getBoundingClientRect();
    const natural = menu.current.scrollHeight;
    const width = Math.min(Math.max(at.width, menu.current.scrollWidth), window.innerWidth - EDGE * 2);
    const below = window.innerHeight - at.bottom - EDGE - 4;
    const aboveRoom = at.top - EDGE - 4;
    const above = natural > below && aboveRoom > below;
    const maxHeight = Math.max(80, above ? aboveRoom : below);
    const height = Math.min(natural, maxHeight);
    const left = Math.min(Math.max(at.left, EDGE), window.innerWidth - width - EDGE);
    const top = above ? at.top - 4 - height : at.bottom + 4;
    setPlace({ left, top, width, maxHeight, above });
  }, [open, options]);

  // A click anywhere else, the window losing focus, or a resize closes it.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const lost = () => close(false);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", lost);
    window.addEventListener("resize", lost);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", lost);
      window.removeEventListener("resize", lost);
    };
  }, [open, close]);

  useEffect(() => {
    if (open && place) menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, place, active]);

  const onKey = (event: ReactKeyboardEvent) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[active];
      if (option) pick(option);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  const shown = buttonLabel ?? chosen?.label ?? placeholder;
  const clears = !!onClear && clearable && !disabled;
  return (
    <span className="av-select-box" data-clearable={clears ? "" : undefined}>
      {trigger ? (
        <button
          ref={button}
          type="button"
          className="av-button"
          data-variant={trigger.variant ?? "secondary"}
          data-size={trigger.size ?? "regular"}
          data-icon-only=""
          data-open={open ? "" : undefined}
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? `${id}-menu` : undefined}
          aria-activedescendant={open ? `${id}-${active}` : undefined}
          disabled={disabled}
          onClick={() => (open ? close(true) : show())}
          onKeyDown={onKey}
        >
          <Icon name={trigger.icon} size={trigger.size === "xlarge" ? 20 : trigger.size === "large" ? 16 : 12} />
          {!!trigger.count && (
            <span key={trigger.count} className="av-button-count" aria-hidden="true">
              {trigger.count > 99 ? "99+" : trigger.count}
            </span>
          )}
        </button>
      ) : (
      <button
          ref={button}
          type="button"
          className="av-select"
          data-size={size}
          data-open={open ? "" : undefined}
          data-shelf={chosen?.shelf && shelfKey(chosen.shelf)}
          aria-label={`${label}: ${chosen?.label ?? placeholder}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-menu` : undefined}
          aria-activedescendant={open ? `${id}-${active}` : undefined}
          disabled={disabled}
          onClick={() => (open ? close(true) : show())}
          onKeyDown={onKey}
        >
          {chosen?.shelf ? <ShelfGlyph shelf={chosen.shelf} /> : icon && <Icon name={icon} size={12} />}
          <span className="av-select-label">{shown}</span>
          {!clears && <span className="av-select-chevron"><Icon name="chevron" size={12} /></span>}
        </button>
      )}
      {clears && (
        <button
          type="button"
          className="av-select-clear"
          aria-label={clearLabel ?? `Clear ${label.toLowerCase()}`}
          title={clearLabel ?? `Clear ${label.toLowerCase()}`}
          onClick={() => {
            close(false);
            onClear?.();
          }}
        >
          <Icon name="close" size={12} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            className="av-select-menu"
            role={trigger ? "menu" : "listbox"}
            aria-label={label}
            data-above={place?.above ? "" : undefined}
            data-placed={place ? "" : undefined}
            style={
              place
                ? ({ "--_left": `${place.left}px`, "--_top": `${place.top}px`, "--_width": `${place.width}px`, "--_max": `${place.maxHeight}px` } as CSSProperties)
                : undefined
            }
          >
            {options.map((option, i) => (
              <div key={option.value} className="av-select-group">
                {option.section && <div className="av-select-section" role="presentation">{option.section}</div>}
                <div
                  id={`${id}-${i}`}
                  data-index={i}
                  className="av-select-option"
                  role={trigger ? "menuitem" : "option"}
                  aria-selected={trigger ? undefined : option.value === value}
                  data-active={i === active ? "" : undefined}
                  data-shelf={option.shelf && shelfKey(option.shelf)}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(option)}
                >
                  <span className="av-select-check">{option.value === value && <Icon name="check" size={12} />}</span>
                  {option.shelf && <ShelfGlyph shelf={option.shelf} />}
                  {option.icon && <Icon name={option.icon} size={12} />}
                  {option.label}
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
