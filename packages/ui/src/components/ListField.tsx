import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import "./select.css";
import "../foundations.css";
import "./listfield.css";

export interface ListFieldProps {
  /** Names the list for VoiceOver, and its field: "Apps to skip". */
  label: string;
  /** The items, one per row, in the order they were added. */
  items: readonly string[];
  /** The list as it is after an Add or a Remove. */
  onChange: (items: string[]) => void;
  /** What the field shows while empty, as an example: "com.apple.Passwords". */
  placeholder?: string;
  /** What the list says while it holds nothing. */
  empty?: string;
  disabled?: boolean;
  /**
   * A pop-up button in place of the list: closed, it says the one item, how many there are (`many`: "10 apps"), or "Empty"; open, the
   * field and the items float under it. `one` names a single item where a sentence needs it ("app").
   */
  collapsed?: { one: string; many: string };
}

/** How far the popover keeps from the window's edges, and from its button. */
const EDGE = 8;
const GAP = 4;

/**
 * A list of short items, such as apps or sites to skip: a field and Add to put one in at a time (Return adds it too), and the items
 * under it, each with its own Remove. An item already there isn't added twice. New rows slide in.
 *
 * With `collapsed`, it is a pop-up button instead, as a choice is: closed, it says what the list holds (the one item, or "10 apps",
 * or "Empty"), and open, the field and the items float under it, until a click elsewhere, Esc, or the window losing focus closes them.
 */
export function ListField(props: ListFieldProps) {
  return props.collapsed ? <CollapsedListField {...props} collapsed={props.collapsed} /> : <ListBody {...props} />;
}

function ListBody({ label, items, onChange, placeholder, empty = "Nothing here yet.", disabled, inputRef }: ListFieldProps & { inputRef?: Ref<HTMLInputElement> }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = () => {
    const item = draft.trim();
    if (!item) return;
    setDraft("");
    if (items.some((i) => i.toLowerCase() === item.toLowerCase())) return;
    onChange([...items, item]);
  };
  return (
    <div className="av-list-field" role="group" aria-label={label}>
      <div className="av-list-field-add">
        <input
          ref={inputRef}
          id={`${id}-input`}
          className="av-list-field-input"
          type="text"
          aria-label={`Add to ${label}`}
          placeholder={placeholder}
          value={draft}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button size="small" variant="secondary" disabled={disabled || !draft.trim()} onClick={add}>Add</Button>
      </div>
      {items.length === 0 ? (
        <p className="av-list-field-empty">{empty}</p>
      ) : (
        <ul className="av-list-field-items" aria-label={label}>
          {items.map((item) => (
            <li key={item} className="av-list-field-item">
              <span className="av-list-field-text">{item}</span>
              <Button size="small" variant="quiet" icon="close" label={`Remove ${item}`} disabled={disabled} onClick={() => onChange(items.filter((i) => i !== item))} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What a collapsed list says while closed: its one item, how many it holds ("10 apps"), or "Empty". */
export function listSummary(items: readonly string[], noun: { one: string; many: string }): string {
  if (items.length === 0) return "Empty";
  if (items.length === 1) return items[0] ?? "";
  return `${items.length} ${noun.many}`;
}

function CollapsedListField(props: ListFieldProps & { collapsed: { one: string; many: string } }) {
  const { label, items, collapsed, disabled } = props;
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    setPlace(null);
    if (focusButton) button.current?.focus();
  }, []);
  // Under the button, its right edge on the button's, as wide as the field needs, kept inside the window; above when there's more room.
  useLayoutEffect(() => {
    if (!open || !button.current || !pop.current) return;
    const at = button.current.getBoundingClientRect();
    const width = Math.min(Math.max(at.width, 280), window.innerWidth - EDGE * 2);
    const natural = pop.current.scrollHeight;
    const below = window.innerHeight - at.bottom - EDGE - GAP;
    const aboveRoom = at.top - EDGE - GAP;
    const above = natural > below && aboveRoom > below;
    const maxHeight = Math.max(120, above ? aboveRoom : below);
    const height = Math.min(natural, maxHeight);
    const left = Math.min(Math.max(at.right - width, EDGE), window.innerWidth - width - EDGE);
    setPlace({ left, top: above ? at.top - GAP - height : at.bottom + GAP, width, maxHeight, above });
    input.current?.focus({ preventScroll: true });
  }, [open, items.length]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!pop.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    const lost = () => close(false);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", lost);
    window.addEventListener("resize", lost);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", lost);
      window.removeEventListener("resize", lost);
    };
  }, [open, close]);
  const summary = listSummary(items, collapsed);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="av-select"
        data-size="small"
        data-open={open ? "" : undefined}
        data-empty={items.length === 0 ? "" : undefined}
        aria-label={`${label}: ${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <span className="av-select-label">{summary}</span>
        <span className="av-select-chevron"><Icon name="chevron" size={12} /></span>
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={`${id}-pop`}
            className="av-list-field-pop"
            role="dialog"
            aria-label={label}
            data-above={place?.above ? "" : undefined}
            data-placed={place ? "" : undefined}
            style={place ? ({ "--_left": `${place.left}px`, "--_top": `${place.top}px`, "--_width": `${place.width}px`, "--_max": `${place.maxHeight}px` } as CSSProperties) : undefined}
          >
            <ListBody {...props} inputRef={input} />
          </div>,
          document.body,
        )}
    </>
  );
}
