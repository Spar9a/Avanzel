import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { tabId } from "./Tabs.tsx";
import "../foundations.css";
import "./tabs.css";

export interface TabPage<T extends string> {
  value: T;
  content: ReactNode;
}

export interface TabPanelProps<T extends string> {
  /** The id the tabs name in `controls`: each page is named by its tab (`tabId(id, value)`). */
  id: string;
  /** The pages, in the order of their tabs. */
  pages: readonly TabPage<T>[];
  /** The page shown: the chosen tab's value. */
  value: T;
  /** fill: the panel takes the height it is given, and each page scrolls inside it. auto: as tall as the tallest page. */
  height?: "fill" | "auto";
}

/**
 * What the tabs show, as pages side by side: choosing another tab slides the row of pages along, the one left going out on one
 * side as the new one comes in from the other, in the direction of the tab. A page is made the first time it shows and kept
 * after, so what it holds (a draft, an open row, how far it was scrolled) is there when its tab is chosen again.
 */
export function TabPanel<T extends string>({ id, pages, value, height = "auto" }: TabPanelProps<T>) {
  const index = Math.max(0, pages.findIndex((page) => page.value === value));
  const [made, setMade] = useState<ReadonlySet<T>>(() => new Set([value]));
  useEffect(() => {
    setMade((seen) => (seen.has(value) ? seen : new Set([...seen, value])));
  }, [value]);
  return (
    <div id={id} className="av-tab-panel" data-height={height}>
      <div className="av-tab-track" style={{ "--_index": index } as CSSProperties}>
        {pages.map((page) => {
          const current = page.value === value;
          return (
            <div
              key={page.value}
              className="av-tab-page"
              data-current={current ? "" : undefined}
              role="tabpanel"
              aria-labelledby={tabId(id, page.value)}
              tabIndex={current ? 0 : -1}
              inert={!current}
            >
              {(current || made.has(page.value)) && page.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
