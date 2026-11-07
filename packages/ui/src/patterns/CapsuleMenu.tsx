import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../components/Button.tsx";
import { Hud } from "../components/Hud.tsx";
import { useFileDrop } from "../components/file-drop.ts";
import { Icon, type IconName } from "../components/Icon.tsx";
import { Spinner } from "../components/Spinner.tsx";
import "../foundations.css";
import "./capsule.css";

export interface CapsuleMenuItem {
  label: string;
  icon: IconName;
  onSelect: () => void;
  /** What it started is getting ready, such as the video picker opening: a spinner in place of its icon, and it can't be chosen again. */
  busy?: boolean;
}

export interface CapsuleMenuProps {
  /** It shows while `open`: it rises in over the capsule's bar, and sinks away when it closes. */
  open: boolean;
  /** Its heading: "Add to this recording". */
  title: string;
  /** Its choices, one under another. */
  items: readonly CapsuleMenuItem[];
  /** Its × beside the heading. */
  onClose: () => void;
  /** Under the choices: what they have done so far, such as the files added. */
  children?: ReactNode;
  /** Given, files can be dropped on the menu: while one is over it the menu turns violet and says so, and the files are handed over. */
  onDropFiles?: (files: File[]) => void;
}

/**
 * A menu over the capsule's bar, on the capsule's glass, as the recording's + opens: a heading with its ×, its choices one under another,
 * and what they have done so far under them. It rises in as it opens and sinks away as it closes.
 */
export function CapsuleMenu({ open, title, items, onClose, children, onDropFiles }: CapsuleMenuProps) {
  const drop = useFileDrop(open ? onDropFiles : undefined);
  // Kept while it sinks away, so it leaves the way it came.
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) setShown(true);
  }, [open]);
  if (!shown) return null;
  return (
    <div
      className="av-capsule-menu"
      data-leaving={open ? undefined : ""}
      data-dropping={drop.over ? "" : undefined}
      {...drop.handlers}
      onAnimationEnd={(event) => {
        if (!open && event.target === event.currentTarget) setShown(false);
      }}
    >
      <Hud>
        <div className="av-capsule-menu-head">
          <span className="av-capsule-menu-title">{title}</span>
          <Button size="large" variant="quiet" icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="av-capsule-menu-items" role="menu" aria-label={title}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="av-capsule-menu-item"
              aria-busy={item.busy || undefined}
              data-busy={item.busy ? "" : undefined}
              onClick={item.busy ? undefined : item.onSelect}
            >
              <span className="av-capsule-menu-sign">{item.busy ? <Spinner size="small" /> : <Icon name={item.icon} size={16} />}</span>
              {item.label}
            </button>
          ))}
        </div>
        {children && <div className="av-capsule-menu-foot">{children}</div>}
      </Hud>
      {onDropFiles && <span className="av-capsule-menu-drop" aria-hidden="true">Drop to add to this recording</span>}
    </div>
  );
}
