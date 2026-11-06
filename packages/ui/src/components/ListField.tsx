import { useId, useState } from "react";
import { Button } from "./Button.tsx";
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
}

/**
 * A list of short items, such as apps or sites to skip: a field and Add to put one in at a time (Return adds it too), and the items
 * under it, each with its own Remove. An item already there isn't added twice. New rows slide in.
 */
export function ListField({ label, items, onChange, placeholder, empty = "Nothing here yet.", disabled }: ListFieldProps) {
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
