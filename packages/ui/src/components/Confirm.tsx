import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import "../foundations.css";
import "./confirm.css";

export interface ConfirmProps {
  /** The question is up: it rises in under the button that asked it, over what is below, and sinks away as it closes. */
  open: boolean;
  /** One short question, in sentence case: "Move this page to the Trash?". */
  question: string;
  /** The verb that does it, in red: "Delete". */
  confirmLabel: string;
  onConfirm: () => void;
  /** Cancel, Esc, or a click anywhere else. */
  onCancel: () => void;
  /** The button that asks: the question hangs from its bottom right. */
  children: ReactNode;
}

/**
 * A question before something that can't be taken back here, in one line on a small pill laid over the button that asked it (and what
 * is beside it), which grows out of the button to the left: the question, Cancel, and the red verb where the button was. Esc or a click
 * anywhere else is Cancel.
 */
export function Confirm({ open, question, confirmLabel, onConfirm, onCancel, children }: ConfirmProps) {
  const box = useRef<HTMLSpanElement>(null);
  // Kept while it sinks away, so it leaves the way it came.
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) setShown(true);
  }, [open]);
  // Opened by a press, the verb takes the focus, so Return does it and Esc gives it up. One open from the start takes nothing.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      requestAnimationFrame(() => box.current?.querySelector<HTMLButtonElement>(".av-confirm-actions button:last-child")?.focus());
    }
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onCancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, onCancel]);
  return (
    <span ref={box} className="av-confirm">
      {children}
      {shown && (
        <span
          className="av-confirm-card"
          role="alertdialog"
          aria-label={question}
          data-leaving={open ? undefined : ""}
          onAnimationEnd={(event) => {
            if (!open && event.target === event.currentTarget) setShown(false);
          }}
        >
          <span className="av-confirm-question">{question}</span>
          <span className="av-confirm-actions">
            <Button size="small" variant="quiet" onClick={onCancel}>Cancel</Button>
            <Button size="small" variant="danger" icon="trash" onClick={onConfirm}>{confirmLabel}</Button>
          </span>
        </span>
      )}
    </span>
  );
}
