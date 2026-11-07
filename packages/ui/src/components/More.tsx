import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import "../foundations.css";
import "./more.css";

export interface MoreProps {
  /** The rarer choices of a row, such as buttons: they take the More button's place, in the same row, one after another. */
  children: ReactNode;
  /** The button's words: "More". */
  label?: string;
  /** Shown from the start, as when the row is drawn again after it was opened. */
  defaultOpen?: boolean;
}

/**
 * The rarer choices of a row behind a More button: a press shows them in its place, each coming in a moment after the one before, and
 * the focus goes to the first of them. They stay until the row goes.
 */
export function More({ children, label = "More", defaultOpen = false }: MoreProps) {
  const [open, setOpen] = useState(defaultOpen);
  const box = useRef<HTMLSpanElement>(null);
  const pressed = useRef(false);
  useEffect(() => {
    if (open && pressed.current) box.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [open]);
  if (!open) {
    return (
      <Button
        size="small"
        icon="chevron"
        expanded={false}
        onClick={() => {
          pressed.current = true;
          setOpen(true);
        }}
      >
        {label}
      </Button>
    );
  }
  return <span ref={box} className="av-more">{children}</span>;
}
