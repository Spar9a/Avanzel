import type { ReactNode } from "react";
import "../foundations.css";
import "./group.css";

export interface GroupProps {
  /** The heading above the group: "Capture", "Agents". */
  label?: string;
  /** A sentence under the group, when a setting needs explaining. */
  note?: string;
  /** Rows: <Switch> and <GroupRow>. */
  children: ReactNode;
}

/** A Settings group, as in System Settings: rows on one rounded panel, hairlines between them. */
export function Group({ label, note, children }: GroupProps) {
  return (
    <section className="av-group">
      {label && <h3 className="av-group-label">{label}</h3>}
      <div className="av-group-box">{children}</div>
      {note && <p className="av-group-note">{note}</p>}
    </section>
  );
}

export interface GroupRevealProps {
  /** Shown: the rows open out under the one before; hidden, they fold away and can't be reached. */
  open: boolean;
  /** Rows: <GroupRow>s that belong to the setting above them, such as a Switch's own settings. */
  children: ReactNode;
}

/**
 * Rows of a Group that are there only while the setting above them is on: they open out, growing from nothing and fading in, and fold
 * away the same way when it is turned off, so the group never jumps.
 */
export function GroupReveal({ open, children }: GroupRevealProps) {
  return (
    <div className="av-group-reveal" data-open={open ? "" : undefined} inert={!open}>
      <div className="av-group-reveal-rows">{children}</div>
    </div>
  );
}

export interface GroupRowProps {
  label: string;
  description?: ReactNode;
  /** A screen reader is told when `description` changes, with `label` so that it knows whose it is. Only once the person has asked for what changes it. */
  live?: boolean;
  /** The control on the right: a <Segmented>, a <Button>, a <Kbd>. */
  children?: ReactNode;
}

/** One row of a Group. For an on/off setting, put a <Switch> in the group instead. */
export function GroupRow({ label, description, live, children }: GroupRowProps) {
  return (
    <div className="av-group-row">
      <div className="av-group-row-text" role={live ? "status" : undefined} aria-atomic={live ? true : undefined}>
        <span>{label}</span>
        {description && <small>{description}</small>}
      </div>
      {children && <div className="av-group-row-control">{children}</div>}
    </div>
  );
}
