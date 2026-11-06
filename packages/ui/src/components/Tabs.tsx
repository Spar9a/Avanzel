import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Shelf } from "../generated/tokens.ts";
import { ShelfGlyph } from "./Shelf.tsx";
import "../foundations.css";
import "./shelf.css";
import "./tabs.css";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  /** A count beside the label, such as the pages a tab lists. */
  count?: number;
  /** How VoiceOver reads the count: "12 pages". Without it, the number alone. */
  countLabel?: string;
  /** A tab that stands for a shelf: its glyph in the shelf's colour goes before the name, as a shelf is never shown without both. */
  shelf?: Shelf;
}

export interface TabsProps<T extends string> {
  /** Names the tabs for VoiceOver: "Sections", "Shelves". */
  label: string;
  options: readonly TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * primary: the window's own places, in the headline face, with a violet line under the chosen one that slides to the next.
   * secondary: a quieter row under it, in the footnote face, where the chosen one is brighter and bolder.
   */
  level?: "primary" | "secondary";
  /** The id of the panel the tabs show (`TabPanel`). Each tab's id is made from it, `<controls>-tab-<value>`, for the panel to be named by. */
  controls?: string;
}

/** The id `Tabs` gives the tab for `value`, when it shows the panel `controls`: what `TabPanel`'s `labelledBy` names. */
export const tabId = (controls: string, value: string) => `${controls}-tab-${value}`;

/**
 * A row of tabs that moves between the places of a window, such as Capture, Library and Settings, and a second row under it for
 * the parts of the chosen one. The arrow keys, Home and End move between them.
 */
export function Tabs<T extends string>({ label, options, value, onChange, level = "primary", controls }: TabsProps<T>) {
  const list = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  // Where the line under the chosen tab is: measured from the tab itself, so it slides there as the choice changes.
  const [line, setLine] = useState<{ x: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const tab = buttons.current[selected];
      if (tab) setLine({ x: tab.offsetLeft, width: tab.offsetWidth });
    };
    measure();
    const box = list.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, [selected, options]);
  const move = (to: number) => {
    const next = (to + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttons.current[next]?.focus();
  };
  return (
    <div ref={list} className="av-tabs" data-level={level} role="tablist" aria-label={label}>
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => { buttons.current[i] = el; }}
          id={controls ? tabId(controls, option.value) : undefined}
          className="av-tabs-tab"
          type="button"
          role="tab"
          aria-selected={option.value === value}
          aria-controls={controls}
          tabIndex={i === selected ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); move(i + 1); }
            if (e.key === "ArrowLeft") { e.preventDefault(); move(i - 1); }
            if (e.key === "Home") { e.preventDefault(); move(0); }
            if (e.key === "End") { e.preventDefault(); move(options.length - 1); }
          }}
        >
          {option.shelf && (
            <span className="av-tabs-shelf" data-shelf={option.shelf}>
              <ShelfGlyph shelf={option.shelf} size={10} />
            </span>
          )}
          <span className="av-tabs-label">{option.label}</span>
          {option.count !== undefined && (
            <span className="av-tabs-count" aria-label={option.countLabel}>{option.count}</span>
          )}
        </button>
      ))}
      {level === "primary" && line && (
        <i
          className="av-tabs-line"
          aria-hidden="true"
          style={{ "--_x": `${line.x}px`, "--_width": `${line.width}px` } as CSSProperties}
        />
      )}
    </div>
  );
}
