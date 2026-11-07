import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import "../foundations.css";
import "./filelink.css";

export interface FileLinkProps {
  /** The words the link is on, in the text: "the screen recording", or the file's own name. */
  children: ReactNode;
  /** The file's own name, which VoiceOver and the tooltip say: "2026-11-07-131109.mov". */
  name: string;
  kind: "video" | "image" | "file";
  /** A click on the words opens the file. */
  onOpen: () => void;
  /** Given, the link shows a bin while the pointer is on it (or the focus is in it), which takes the file away. */
  onRemove?: () => void;
}

const SIGN: Record<FileLinkProps["kind"], IconName> = { video: "play", image: "screen", file: "attach" };

/**
 * A file named in a page's text, as a link in those words, with its sign before them: a click opens it. Under the pointer the link
 * becomes a chip, ringed and lit, and a bin shows right after it, which takes the file away. Neither moves the words around it.
 */
export function FileLink({ children, name, kind, onOpen, onRemove }: FileLinkProps) {
  return (
    <span className="av-file-link" data-removable={onRemove ? "" : undefined}>
      <button type="button" className="av-file-link-open" title={name} onClick={onOpen}>
        <span className="av-file-link-sign"><Icon name={SIGN[kind]} size={12} /></span>
        {children}
      </button>
      {onRemove && (
        <button type="button" className="av-file-link-remove" aria-label={`Delete ${name}`} title={`Delete ${name}`} onClick={onRemove}>
          <Icon name="trash" size={16} />
        </button>
      )}
    </span>
  );
}
