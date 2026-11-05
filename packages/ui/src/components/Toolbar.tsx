import { Icon, type IconName } from "./Icon.tsx";
import "../foundations.css";
import "./toolbar.css";

export interface ToolbarItem<T extends string> {
  value: T;
  label: string;
  icon: IconName;
}

export interface ToolbarProps<T extends string> {
  /** Names the toolbar for VoiceOver. */
  label: string;
  items: readonly ToolbarItem<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A settings window's toolbar: an icon and a label for each pane, the one in view marked. A press switches, by click, Space or Return, and arrow keys don't. */
export function Toolbar<T extends string>({ label, items, value, onChange }: ToolbarProps<T>) {
  return (
    <nav className="av-toolbar" aria-label={label}>
      {items.map((item) => (
        <button key={item.value} type="button" className="av-toolbar-item" aria-current={item.value === value ? "page" : undefined} onClick={() => onChange(item.value)}>
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
