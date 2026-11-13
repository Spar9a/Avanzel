// Settings → General → Your shelves: the shelves the owner made, each in a row with its definition and its pages, and the form that adds one,
// edits one or gives a folder made by hand its definition. Remove is there only for a shelf with no pages, and asks first. Each change is one
// call to main (`settings.shelves`), whose refusal is told by the window's Notice (`attemptChange`). Edit first, on a suggested shelf, opens the
// form filled in from `snap.shelfDraft`; Save then makes the shelf from that suggestion, which moves its pages onto it.
import { Actions, Button, Confirm, Group, GroupRow, TextArea, TextField } from "@avanzel/ui";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { LibraryInfo, ShelfAsk, ShelfOp } from "../../../shared/ipc.ts";
import {
  ADD_DEFINITION,
  ADD_SHELF,
  folderHint,
  folderLine,
  folderProblemText,
  removeShelfQuestion,
  SAVE_SHELF,
  SHELF_DEFINITION_LABEL,
  SHELF_FOLDER_LABEL,
  SHELF_NAME_LABEL,
  shelfRowLine,
  SHELVES_EMPTY,
  SHELVES_LABEL,
  SHELVES_NOTE,
} from "../copy.ts";
import type { PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

type OwnShelves = LibraryInfo["ownShelves"];

/**
 * What the open form holds. `add`: a new shelf, whose folder follows the name until it is typed; `edit`: an own shelf's name and definition
 * (its folder stays); `define`: a folder made by hand, which takes a name and a definition and so becomes a shelf (its folder stays).
 * `fromSuggestion`: the folder of the suggestion the form was opened from (Edit first), which Save makes.
 */
interface Form {
  mode: "add" | "edit" | "define";
  name: string;
  folder: string;
  /** The folder was typed or came with the suggestion: it no longer follows the name. */
  folderOwn: boolean;
  definition: string;
  fromSuggestion?: string;
}

const blankForm: Form = { mode: "add", name: "", folder: "", folderOwn: false, definition: "" };

const formOfDraft = (draft: ShelfAsk): Form => ({
  mode: "add",
  name: draft.name,
  folder: draft.folder,
  folderOwn: true,
  definition: draft.definition,
  fromSuggestion: draft.folder,
});

const formOfShelf = (shelf: OwnShelves[number]): Form => ({
  mode: shelf.definition === "" ? "define" : "edit",
  name: shelf.name,
  folder: shelf.folder,
  folderOwn: true,
  definition: shelf.definition,
});

interface FormRowsProps {
  form: Form;
  /** The folders of the owner's shelves: a new shelf's folder can't be one of them. */
  taken: readonly string[];
  saving: boolean;
  onForm(change: (form: Form) => Form): void;
  onSave(): void;
  onCancel(): void;
}

/** The form's fields and buttons, as rows of the group like a review's editor: Name, Folder, then the definition and Cancel and Save in boxes of the window's own. */
function FormRows({ form, taken, saving, onForm, onSave, onCancel }: FormRowsProps): ReactNode {
  const folder = form.mode === "add" && !form.folderOwn ? folderHint(form.name) : form.folder;
  const adding = form.mode === "add";
  const folderTold = adding ? folderLine(form.name, folder, taken) : undefined;
  const ready = form.name.trim() !== "" && form.definition.trim() !== "" && (!adding || folderProblemText(folder, taken) === null);
  const save = () => {
    if (ready && !saving) onSave();
  };
  return (
    <>
      <GroupRow label={SHELF_NAME_LABEL}>
        <div className="settings-field">
          <TextField
            label={SHELF_NAME_LABEL}
            labelHidden
            value={form.name}
            autoFocus={form.mode !== "define"}
            onChange={(name) => onForm((now) => ({ ...now, name }))}
            onEnter={save}
            onEscape={onCancel}
          />
        </div>
      </GroupRow>
      {adding ? (
        <GroupRow label={SHELF_FOLDER_LABEL} description={folderTold}>
          <div className="settings-field">
            <TextField
              label={SHELF_FOLDER_LABEL}
              labelHidden
              value={folder}
              onChange={(next) => onForm((now) => ({ ...now, folder: next, folderOwn: true }))}
              onEnter={save}
              onEscape={onCancel}
            />
          </div>
        </GroupRow>
      ) : (
        <GroupRow label={SHELF_FOLDER_LABEL} description={form.folder} />
      )}
      <div className="settings-editor">
        <TextArea
          label={SHELF_DEFINITION_LABEL}
          rows={3}
          value={form.definition}
          autoFocus={form.mode === "define"}
          onChange={(definition) => onForm((now) => ({ ...now, definition }))}
          onEscape={onCancel}
        />
      </div>
      <div className="settings-editor">
        <Actions>
          <Button variant="quiet" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" busy={saving} disabled={!ready} onClick={save}>{SAVE_SHELF}</Button>
        </Actions>
      </div>
    </>
  );
}

/** The Your shelves group, for a library that exists: `shelves` are `LibraryInfo.ownShelves`. */
export function Shelves(props: PaneProps & { shelves: OwnShelves }): ReactNode {
  const { snap, shelves, onChange, attempt } = props;
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const taken = shelves.filter((shelf) => shelf.definition !== "").map((shelf) => shelf.folder);

  // Edit first: the form opens filled in from the suggestion, and the draft is let go as it is taken, so it opens the form once.
  // The snapshot is read again, so a draft that is asked for again afterwards (the same folder) is a change this effect sees.
  const draft = snap.shelfDraft;
  useEffect(() => {
    if (!draft) return;
    setForm(formOfDraft(draft));
    setRemoving(null);
    api.dropShelfDraft();
    void api.get().then(onChange);
  }, [draft?.folder]);

  const send = async (op: ShelfOp): Promise<boolean> => {
    const next = await attempt(() => api.shelves(op));
    if (next) onChange(next);
    return next !== undefined;
  };
  const save = async () => {
    if (!form || saving) return;
    const name = form.name.trim();
    const definition = form.definition.trim();
    const folder = form.mode === "add" && !form.folderOwn ? folderHint(form.name) : form.folder;
    setSaving(true);
    try {
      const saved = await send(
        form.mode === "edit"
          ? { op: "edit", folder, name, definition }
          : { op: "make", shelf: { folder, name, definition }, ...(form.fromSuggestion !== undefined ? { fromSuggestion: form.fromSuggestion } : {}) },
      );
      if (saved) setForm(null);
    } finally {
      setSaving(false);
    }
  };
  const changeForm = (change: (form: Form) => Form) => setForm((now) => (now ? change(now) : now));
  const editing = (shelf: OwnShelves[number]) => form !== null && form.mode !== "add" && form.folder === shelf.folder;

  return (
    <Group label={SHELVES_LABEL} note={SHELVES_NOTE}>
      {shelves.length === 0 && <GroupRow label={SHELVES_EMPTY} />}
      {shelves.map((shelf) => (
        <Fragment key={shelf.folder}>
          <GroupRow label={shelf.name} description={shelfRowLine(shelf.definition, shelf.pages)}>
            {!editing(shelf) && (
              <>
                <Button size="small" variant="secondary" onClick={() => setForm(formOfShelf(shelf))}>
                  {shelf.definition === "" ? ADD_DEFINITION : "Edit"}
                </Button>
                {shelf.pages === 0 && (
                  <Confirm
                    open={removing === shelf.folder}
                    question={removeShelfQuestion(shelf.name)}
                    confirmLabel="Remove"
                    onConfirm={() => {
                      setRemoving(null);
                      void send({ op: "remove", folder: shelf.folder });
                    }}
                    onCancel={() => setRemoving(null)}
                  >
                    <Button size="small" variant="danger" expanded={removing === shelf.folder} onClick={() => setRemoving(removing === shelf.folder ? null : shelf.folder)}>
                      Remove
                    </Button>
                  </Confirm>
                )}
              </>
            )}
          </GroupRow>
          {editing(shelf) && form && <FormRows form={form} taken={taken} saving={saving} onForm={changeForm} onSave={() => void save()} onCancel={() => setForm(null)} />}
        </Fragment>
      ))}
      {form?.mode === "add" ? (
        <FormRows form={form} taken={taken} saving={saving} onForm={changeForm} onSave={() => void save()} onCancel={() => setForm(null)} />
      ) : (
        <div className="settings-editor">
          <Actions align="start">
            <Button size="small" variant="secondary" onClick={() => setForm(blankForm)}>{ADD_SHELF}</Button>
          </Actions>
        </div>
      )}
    </Group>
  );
}
