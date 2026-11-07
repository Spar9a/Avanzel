import { Icon, type IconName } from "./Icon.tsx";
import "../foundations.css";
import "./filechip.css";

export interface FileChipProps {
  /** The file's name as it shows: "2026-11-07-131109.mov". */
  name: string;
  /** What it is, for its sign: a video (▶), a picture (a frame), or any other file (a page). */
  kind: "video" | "image" | "file";
  /** A click on it opens it, in the app the Mac opens it with. */
  onOpen: () => void;
  /** Given, an × shows while the pointer is on the chip (or the focus is in it) and takes the file away. */
  onRemove?: () => void;
}

const SIGN: Record<FileChipProps["kind"], IconName> = { video: "play", image: "screen", file: "attach" };

/** A file a page or a recording holds, as a chip: its sign and name, which open it, and, under the pointer, its own ×. */
export function FileChip({ name, kind, onOpen, onRemove }: FileChipProps) {
  return (
    <span className="av-file-chip" data-kind={kind}>
      <button type="button" className="av-file-chip-open" onClick={onOpen} title={name}>
        <Icon name={SIGN[kind]} size={12} />
        <span className="av-file-chip-name">{name}</span>
      </button>
      {onRemove && (
        <button type="button" className="av-file-chip-remove" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={onRemove}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}
