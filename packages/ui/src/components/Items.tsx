import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { Spinner } from "./Spinner.tsx";
import "../foundations.css";
import "./items.css";

export interface Item {
  /** Its words, as VoiceOver and its × name it. */
  text: string;
  /** What shows in place of `text`, when its words hold links (a file named in them, as a `FileLink`). */
  content?: ReactNode;
  /** A step that is done: a check in place of the dash, and the words quieter. */
  done?: boolean;
  /** One on its way, such as a screenshot being taken: a spinner in place of the dash, and no × yet. */
  busy?: boolean;
  /** When it happened, before its words and in violet, as a log's entries start: "2026-11-07". */
  when?: string;
}

export interface ItemsProps {
  items: readonly Item[];
  /** Given, each point has an × at its end that takes it away (named "Remove: <its words>"), as a page's next steps do. */
  onRemove?: (index: number) => void;
}

/**
 * A short list of the owner's points, such as a page's next steps: each after a short violet dash, and a step that is done after a
 * check, in quieter ink. The words wrap under themselves, never under the dash. With `onRemove`, each ends with its own ×.
 */
export function Items({ items, onRemove }: ItemsProps) {
  return (
    <ul className="av-items">
      {items.map((item, i) => (
        <li
          key={`${i}-${item.text}`}
          className="av-item"
          data-done={item.done ? "" : undefined}
          data-busy={item.busy ? "" : undefined}
          aria-busy={item.busy || undefined}
          data-removable={onRemove ? "" : undefined}
        >
          <span className="av-item-mark" aria-hidden="true">{item.busy ? <Spinner size="small" /> : item.done ? <Icon name="check" size={12} /> : <i />}</span>
          <span className="av-item-text">
            {item.done && <span className="av-item-state">Done: </span>}
            {item.when && <span className="av-item-when">{item.when}</span>}
            {item.content ?? item.text}
          </span>
          {onRemove && !item.busy && (
            <span className="av-item-remove">
              <Button size="small" variant="quiet" icon="close" label={`Remove: ${item.text}`} onClick={() => onRemove(i)} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
