// The library's fields of lines (the Dictionary on Voice, the skip lists on Privacy): their drafts, which the Settings window keeps so that they
// outlast the pane, and the field itself, saved when the focus leaves it.
import { TextArea } from "@avanzel/ui";
import { useRef, useState, type ReactNode } from "react";
import type { LibraryPatch, SettingsSnapshot } from "../../shared/ipc.ts";
import { failed, followSnapshot, saved, sent, startDraft, toSend, typed, type TextDraft } from "./dictionary-draft.ts";
import type { PaneProps } from "./parts.tsx";

const api = window.avanzel.settings;

/** A field of the library's lines: how its text is read from a snapshot, and the patch that saves the lines typed. */
interface LibraryTextField {
  text(snap: SettingsSnapshot): string;
  patch(lines: string[]): LibraryPatch;
}

/** The Dictionary field: the library's lines, one per line. */
const DICTIONARY_FIELD: LibraryTextField = {
  text: (snap) => (snap.library?.dictionary ?? []).join("\n"),
  patch: (lines) => ({ dictionary: lines }),
};

/** The skip lists of dictating into any app: bundle ids, and websites, one per line. */
const SKIP_APPS_FIELD: LibraryTextField = {
  text: (snap) => (snap.library?.dictationSkipApps ?? []).join("\n"),
  patch: (lines) => ({ dictationSkipApps: lines }),
};
const SKIP_SITES_FIELD: LibraryTextField = {
  text: (snap) => (snap.library?.dictationSkipSites ?? []).join("\n"),
  patch: (lines) => ({ dictationSkipSites: lines }),
};

/** A field's draft and its save, which the Settings window keeps (useLibraryTextEdit), so they outlast the pane. */
export interface TextEdit {
  draft: string;
  setDraft(text: string): void;
  /** Saves the draft, unless it is what the library holds or what a save on its way holds. */
  save(): Promise<void>;
}

/** Every draft of the library's fields of lines, kept by the Settings window (`useLibraryDrafts`). */
export interface LibraryDrafts {
  dictionary: TextEdit;
  skipApps: TextEdit;
  skipSites: TextEdit;
}

/**
 * The draft of a field of the library's lines, for the Settings shell to keep: a save waits its turn behind filing runs, and the
 * person may leave the pane and come back meanwhile, which must find the draft as it was, not the older lines of the snapshot before
 * the save. Once saved, the draft is the lines main kept (blank and repeated ones dropped, spaces tidied, a site made its host),
 * unless more was typed while the save waited. A draft not edited since the last snapshot follows the next one (`followSnapshot`),
 * so a save of another field, whose snapshot has this field's lines too, leaves an edit here alone. A save main refuses (too many
 * lines, one too long, one it can't read) leaves the draft as typed, and the window says why: leaving the field again tries again.
 * Another library's draft starts from its own lines.
 */
function useLibraryTextEdit(
  snap: SettingsSnapshot | null,
  onChange: PaneProps["onChange"],
  attempt: PaneProps["attempt"],
  field: LibraryTextField,
): TextEdit {
  const library = snap?.library?.exists ? snap.library.path : null;
  const text = snap ? field.text(snap) : "";
  const [state, setState] = useState(() => startDraft(library, text));
  const followed = followSnapshot(state, library, text);
  if (followed !== state) setState(followed);
  // The state as last drawn or changed here, so two blurs before the next draw send one save.
  const latest = useRef(followed);
  latest.current = followed;
  const change = (step: (now: TextDraft) => TextDraft) => {
    latest.current = step(latest.current);
    setState(step);
  };
  const save = async () => {
    const sending = toSend(latest.current);
    if (sending === null) return;
    change((now) => sent(now, sending));
    const next = await attempt(() => api.setLibrary(field.patch(sending.split("\n"))));
    if (!next) return change((now) => failed(now, sending));
    onChange(next);
    change((now) => saved(now, sending, field.text(next)));
  };
  return { draft: followed.draft, setDraft: (typedText) => change((now) => typed(now, typedText)), save };
}

/** The drafts of the Dictionary and the two skip lists, for the Settings window to keep (`useLibraryTextEdit`). */
export function useLibraryDrafts(snap: SettingsSnapshot | null, onChange: PaneProps["onChange"], attempt: PaneProps["attempt"]): LibraryDrafts {
  return {
    dictionary: useLibraryTextEdit(snap, onChange, attempt, DICTIONARY_FIELD),
    skipApps: useLibraryTextEdit(snap, onChange, attempt, SKIP_APPS_FIELD),
    skipSites: useLibraryTextEdit(snap, onChange, attempt, SKIP_SITES_FIELD),
  };
}

/** A field of lines, saved when the focus leaves it. TextArea takes no onBlur, so the box around it hears the focus leave (React's onBlur bubbles). */
export function LinesField({ label, edit, rows, autoFocus }: { label: string; edit: TextEdit; rows: number; autoFocus?: boolean }): ReactNode {
  return (
    <div onBlur={() => void edit.save()}>
      <TextArea label={label} labelHidden rows={rows} value={edit.draft} onChange={edit.setDraft} autoFocus={autoFocus} />
    </div>
  );
}
