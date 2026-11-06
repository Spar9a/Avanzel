import { useId, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import { Kbd } from "./Kbd.tsx";
import "../foundations.css";
import "./actiontile.css";

export interface ActionTileProps {
  /** What it starts, a verb first: "Record a thought". */
  label: string;
  icon: IconName;
  /** A line under the label on what happens: "Speak, and your agent files it". */
  hint?: string;
  /** Its shortcut as macOS writes it (`⌥Space`), when it has one. */
  shortcut?: string;
  /** primary: the one the window is about, in violet. secondary: the others. */
  tone?: "primary" | "secondary";
  disabled?: boolean;
  /** The tiles come in one after another as the window first shows: the tile's place, from 0. */
  order?: number;
  /**
   * A tile that asks how before it starts: `choices` are buttons that fold open under it while `open`, such as Whole screen and
   * Part of the screen. A click on the tile then opens and folds them (`onClick`), and starts nothing itself.
   */
  choices?: ReactNode;
  open?: boolean;
  onClick: () => void;
}

/** A large button with an icon, a label, a line on what it does and its shortcut, for the ways to start something new. */
export function ActionTile({ label, icon, hint, shortcut, tone = "secondary", disabled, order, choices, open = false, onClick }: ActionTileProps) {
  const id = useId();
  const delay = order === undefined ? undefined : ({ "--_order": Math.min(order, 12) } as CSSProperties);
  return (
    <div className="av-action-tile" data-tone={tone} data-open={choices && open ? "" : undefined} style={delay}>
      <button
        type="button"
        className="av-action-tile-button"
        disabled={disabled}
        aria-expanded={choices ? open : undefined}
        aria-controls={choices ? `${id}-choices` : undefined}
        onClick={onClick}
      >
        <span className="av-action-tile-icon"><Icon name={icon} size={16} /></span>
        <span className="av-action-tile-words">
          <span className="av-action-tile-label">{label}</span>
          {hint && <span className="av-action-tile-hint">{hint}</span>}
        </span>
        {shortcut && <span className="av-action-tile-key"><Kbd>{shortcut}</Kbd></span>}
        {choices && <span className="av-action-tile-chevron"><Icon name="chevron" size={12} /></span>}
      </button>
      {choices && (
        <div id={`${id}-choices`} className="av-action-tile-fold" inert={!open}>
          <div className="av-action-tile-clip">
            <div className="av-action-tile-choices">{choices}</div>
          </div>
        </div>
      )}
    </div>
  );
}
