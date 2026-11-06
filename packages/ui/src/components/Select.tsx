import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon.tsx";
import "../foundations.css";
import "./select.css";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A heading the option starts a run of, as "Shelves" over the shelves and "Status" over the statuses. */
  section?: string;
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
}

/** The menu's room inside the window: it never goes past its edges, by this much. */
const EDGE = 8;

/**
 * A pop-up button: it says what is chosen, and opens a menu of the choices under it, drawn in Avanzel's own style and kept inside
 * the window (above the button when there is no room below). The arrow keys move through the choices, Return or a click picks one,
 * and Esc or a click elsewhere closes it.
 */
export function Select<T extends string>({ label, options, value, onChange, placeholder = "Choose…", icon, buttonLabel, size = "small", disabled }: SelectProps<T>) {
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
    if (option.value !== value) onChange(option.value);
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
  return (
    <>
      <button
        ref={button}
        type="button"
        className="av-select"
        data-size={size}
        data-open={open ? "" : undefined}
        aria-label={`${label}: ${chosen?.label ?? placeholder}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(true) : show())}
        onKeyDown={onKey}
      >
        {icon && <Icon name={icon} size={12} />}
        <span className="av-select-label">{shown}</span>
        <span className="av-select-chevron"><Icon name="chevron" size={12} /></span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            className="av-select-menu"
            role="listbox"
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
                  role="option"
                  aria-selected={option.value === value}
                  data-active={i === active ? "" : undefined}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(option)}
                >
                  <span className="av-select-check">{option.value === value && <Icon name="check" size={12} />}</span>
                  {option.label}
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
