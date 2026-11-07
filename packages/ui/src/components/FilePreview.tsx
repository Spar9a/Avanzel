import { Icon } from "./Icon.tsx";
import "../foundations.css";
import "./filepreview.css";

export interface FilePreviewProps {
  /** The file's own name, which VoiceOver and the tooltip say: "2026-11-07-172904.png". */
  name: string;
  kind: "video" | "image" | "file";
  /** Its preview, as a URL the page can show (a data URL); undefined while it is being made, null when there is none. */
  picture: string | null | undefined;
  /** A click on it opens the file, as its link does. */
  onOpen: () => void;
}

/**
 * A file's preview under its name: the picture, a video's frame with ▶ over it, or what Quick Look shows of any other file, in a frame
 * of its own, at most as tall as a few lines; a click opens the file. While it is being made a quiet box holds its place; with none,
 * nothing shows.
 */
export function FilePreview({ name, kind, picture, onOpen }: FilePreviewProps) {
  if (picture === null) return null;
  return (
    <button type="button" className="av-file-preview" data-kind={kind} data-loading={picture ? undefined : ""} aria-label={`Open ${name}`} title={name} onClick={onOpen}>
      {picture && <img className="av-file-preview-picture" src={picture} alt="" draggable={false} />}
      {picture && kind === "video" && (
        <span className="av-file-preview-play" aria-hidden="true">
          <Icon name="play" size={16} />
        </span>
      )}
    </button>
  );
}
