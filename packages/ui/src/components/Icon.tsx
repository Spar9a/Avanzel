import "../foundations.css";
import "./icon.css";

/** Avanzel's icons, drawn on a 16 px grid with a 1.6 px round stroke. Add one here, with a gallery
    entry, rather than drawing an <svg> in a window. */
const ICONS = {
  check: { d: "M3.5 8.4 6.6 11.4 12.6 4.8" },
  close: { d: "M4.5 4.5l7 7M11.5 4.5l-7 7" },
  warning: { d: "M8 2.6l5.9 10.4H2.1Z M8 6.6v2.9 M8 11.3v.1" },
  info: { d: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z M8 7.4v3.6 M8 5.1v.1" },
  mic: { d: "M8 2.5a2 2 0 0 1 2 2V8a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2Z M4.5 8a3.5 3.5 0 0 0 7 0 M8 11.5v2" },
  waveform: { d: "M2.5 11V7 M6 11V3.5 M9.5 11V6 M13 11V8.5 M1 13.5h14" },
  undo: { d: "M5.5 4 2.5 7l3 3 M2.5 7h7a3.5 3.5 0 0 1 0 7H7" },
  open: { d: "M9 2.5h4.5V7 M13.5 2.5 7.5 8.5 M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" },
  folder: { d: "M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" },
  settings: { d: "M2.5 4.5h11 M2.5 11.5h11 M6 2.8v3.4 M10 9.8v3.4" },
  search: { d: "M7 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z M10 10l3.5 3.5" },
  type: { d: "M2 4.5h12v7H2Z M4.6 7h.1 M7 7h.1 M9.4 7h.1 M11.6 7h.1 M5.5 9.3h5" },
  sound: { d: "M2.5 6.2h2.2L8 3.5v9L4.7 9.8H2.5Z M10.8 6a2.6 2.6 0 0 1 0 4 M12.6 4.4a4.8 4.8 0 0 1 0 7.2" },
  clock: { d: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z M8 5v3.2l2.1 1.3" },
  chevron: { d: "M6.5 4l4 4-4 4" },
  plus: { d: "M8 3.5v9M3.5 8h9" },
  /** A bin: a page of the library moved to the Trash. */
  trash: { d: "M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2 M7 7v4 M9 7v4" },
  /** A page with a + in its corner: something added to a recording or a page (Add, Attach a file). */
  attach: { d: "M9 2.5H5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 5 13.5h3M9 2.5 12.5 6v1.5M9 2.5V6h3.5 M12 10v4M10 12h4" },
  copy: { d: "M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2 M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" },
  pen: { d:"M3 13l.8-3.2 6.7-6.7a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2l-6.7 6.7Z M9.5 4.1l2.4 2.4" },
  box: { d: "M3.5 3.5h9a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" },
  ring: { d: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11Z" },
  arrow: { d: "M3 13 12.5 3.5 M6.5 3.5h6v6" },
  display: { d:"M2.5 2.5h11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z M5.5 14h5 M8 11v3" },
  screen: { d:"M2 5V3a1 1 0 0 1 1-1h2 M11 2h2a1 1 0 0 1 1 1v2 M14 11v2a1 1 0 0 1-1 1h-2 M5 14H3a1 1 0 0 1-1-1v-2 M6.5 6.5h3v3h-3Z" },
  pause: { d: "M4.5 3.5h2.5v9H4.5Z M9 3.5h2.5v9H9Z", fill: true },
  spark: { d: "M8 1.8 9.2 6.8 14.2 8 9.2 9.2 8 14.2 6.8 9.2 1.8 8 6.8 6.8Z", fill: true },
  moon: { d: "M12.6 10.3A5.3 5.3 0 0 1 5.7 3.4 5.3 5.3 0 1 0 12.6 10.3Z", fill: true },
  call: { d: "M5.2 2.5 6.6 5.6 5.4 6.8a7.3 7.3 0 0 0 3.8 3.8l1.2-1.2 3.1 1.4-.4 2.1a1 1 0 0 1-1.1.8A10.5 10.5 0 0 1 2.6 4.1a1 1 0 0 1 .8-1.1Z" },
  play: { d: "M5 3.4v9.2L12.4 8Z", fill: true },
  stop: { d: "M4.5 4.5h7v7h-7Z", fill: true },
} satisfies Record<string, { d: string; fill?: boolean }>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  size?: 12 | 16 | 20;
  /** Give a label only when the icon is the only thing that says what it means. */
  label?: string;
}

export function Icon({ name, size = 16, label }: IconProps) {
  const icon: { d: string; fill?: boolean } = ICONS[name];
  return (
    <svg
      className="av-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      data-fill={icon.fill ? "" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={icon.d} />
    </svg>
  );
}
