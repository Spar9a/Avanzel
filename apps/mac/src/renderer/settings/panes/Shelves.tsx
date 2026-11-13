// Settings → General → Your shelves: the shelves the owner made, each in a row with its definition and its pages, and the form that adds one,
// edits one or gives a folder made by hand its definition. Remove is there only for a shelf with no pages, and asks first. Each change is one
// call to main (`settings.shelves`), whose refusal is told by the window's Notice (`attemptChange`). Edit first, on a suggested shelf, opens the
// form filled in from `snap.shelfDraft`; Save then makes the shelf from that suggestion, which moves its pages onto it.
import { Actions, Button, Confirm, Group, GroupRow, Row, TextArea, TextField } from "@avanzel/ui";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { LibraryInfo, ShelfAsk, ShelfOp } from "../../../shared/ipc.ts";
import {
  ADD_DEFINITION,
  ADD_SHELF,
  canRemoveShelf,
  definitionLine,
  folderHint,
  folderLine,
  folderProblemText,
  handMadeFolderProblem,
  removeShelfQuestion,
  SAVE_SHELF,
  SHELF_CANCEL,
  SHELF_DEFINITION_LABEL,
  SHELF_EDIT,
  SHELF_FOLDER_LABEL,
  SHELF_NAME_LABEL,
  SHELF_REMOVE,
  shelfRowLine,
  SHELVES_EMPTY,
  SHELVES_LABEL,
  SHELVES_NOTE,
  SUGGESTED_SAVE_LINE,
} from "../copy.ts";
import type { PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

type OwnShelves = LibraryInfo["ownShelves"];

/**
 * What the open form holds. `add`: a new shelf, whose folder follows the name until it is typed; `edit`: an own shelf's name and definition
 * (its folder stays); `define`: a folder made by hand, which takes a name and a definition and so becomes a shelf (its folder stays).
 * `fromSuggestion`: the folder of the suggestion the form was opened from (Edit first), which Save makes. `dirty`: something was typed.
 */
interface Form {
  mode: "add" | "edit" | "define";
  name: string;
  folder: string;
  /** The folder was typed or came with the suggestion: it no longer follows the name. */
  folderOwn: boolean;
  definition: string;
  fromSuggestion?: string;
  dirty: boolean;
}

const blankForm: Form = { mode: "add", name: "", folder: "", folderOwn: false, definition: "", dirty: false };

const formOfDraft = (draft: ShelfAsk): Form => ({
  mode: "add",
  name: draft.name,
  folder: draft.folder,
  folderOwn: true,
  definition: draft.definition,
  fromSuggestion: draft.folder,
  dirty: false,
});

const formOfShelf = (shelf: OwnShelves[number]): Form => ({
  mode: shelf.definition === "" ? "define" : "edit",
  name: shelf.name,
  folder: shelf.folder,
  folderOwn: true,
  definition: shelf.definition,
  dirty: false,
});

/** The folder a form saves to: an added shelf's follows its name until it is typed. */
const folderOf = (form: Form): string => (form.mode === "add" && !form.folderOwn ? folderHint(form.name) : form.folder);

/** Where the focus goes once a form has closed: Add shelf, or the Edit button of the row of this folder. */
const ADD_FOCUS = "\0add";

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
  const adding = form.mode === "add";
  const folder = folderOf(form);
  // A folder made by hand whose name the folder rule refuses can't become a shelf until it is renamed.
  const blocked = form.mode === "define" ? handMadeFolderProblem(form.folder) : null;
  const ready = form.name.trim() !== "" && form.definition.trim() !== "" && blocked === null && (!adding || folderProblemText(folder, taken) === null);
  const save = () => {
    if (ready && !saving) onSave();
  };
  return (
    <>
      <GroupRow label={SHELF_NAME_LABEL} description={form.fromSuggestion !== undefined ? SUGGESTED_SAVE_LINE : undefined}>
        <div className="settings-field">
          <TextField
            label={SHELF_NAME_LABEL}
            labelHidden
            value={form.name}
            autoFocus={form.mode !== "define"}
            onChange={(name) => onForm((now) => ({ ...now, name, dirty: true }))}
            onEnter={save}
            onEscape={onCancel}
          />
        </div>
      </GroupRow>
      {adding ? (
        <GroupRow label={SHELF_FOLDER_LABEL}>
          <div className="settings-field">
            <TextField
              label={SHELF_FOLDER_LABEL}
              labelHidden
              value={folder}
              description={folderLine(form.name, folder, taken)}
              onChange={(next) => onForm((now) => ({ ...now, folder: next, folderOwn: true, dirty: true }))}
              onEnter={save}
              onEscape={onCancel}
            />
          </div>
        </GroupRow>
      ) : (
        <GroupRow label={SHELF_FOLDER_LABEL} description={blocked === null ? form.folder : `${form.folder}. ${blocked}`} />
      )}
      <div className="settings-editor">
        <TextArea
          label={SHELF_DEFINITION_LABEL}
          rows={3}
          value={form.definition}
          description={definitionLine(form.name, form.definition)}
          autoFocus={form.mode === "define"}
          onChange={(definition) => onForm((now) => ({ ...now, definition, dirty: true }))}
          onEscape={onCancel}
        />
      </div>
      <div className="settings-editor">
        <Actions>
          <Button variant="quiet" onClick={onCancel}>{SHELF_CANCEL}</Button>
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
  // Where the focus goes as the form closes or a shelf is removed (ADD_FOCUS or a folder): the button that was hidden or is the next thing to do.
  const [focus, setFocus] = useState<string | null>(null);
  const buttons = useRef<Record<string, HTMLElement | null>>({});
  const addBox = useRef<HTMLDivElement>(null);
  const taken = shelves.filter((shelf) => shelf.definition !== "").map((shelf) => shelf.folder);

  useEffect(() => {
    if (focus === null) return;
    (focus === ADD_FOCUS ? addBox.current : buttons.current[focus])?.querySelector("button")?.focus();
    setFocus(null);
  }, [focus]);

  // Edit first: the form opens filled in from the suggestion, and the draft is let go as it is taken, so it opens the form once. The snapshot
  // is read again, as main doesn't send one when the draft goes, and a draft asked for again afterwards (the same folder) is then a change this
  // effect sees. A form with something typed in it is never overwritten: the draft stays where it is and is taken once that form closes.
  const draft = snap.shelfDraft;
  const typed = form?.dirty === true;
  useEffect(() => {
    if (!draft || typed) return;
    setForm(formOfDraft(draft));
    setRemoving(null);
    api.dropShelfDraft();
    void api.get().then(onChange);
  }, [draft?.folder, typed]);

  const send = async (op: ShelfOp): Promise<boolean> => {
    const next = await attempt(() => api.shelves(op));
    if (next) onChange(next);
    return next !== undefined;
  };
  const close = (focusOn: string) => {
    setForm(null);
    setFocus(focusOn);
  };
  const cancel = () => close(form?.mode === "add" ? ADD_FOCUS : (form?.folder ?? ADD_FOCUS));
  const save = async () => {
    if (!form || saving) return;
    const name = form.name.trim();
    const definition = form.definition.trim();
    const folder = folderOf(form);
    setSaving(true);
    try {
      const saved = await send(
        form.mode === "edit"
          ? { op: "edit", folder, name, definition }
          : { op: "make", shelf: { folder, name, definition }, ...(form.fromSuggestion !== undefined ? { fromSuggestion: form.fromSuggestion } : {}) },
      );
      if (saved) close(form.mode === "add" ? ADD_FOCUS : folder);
    } finally {
      setSaving(false);
    }
  };
  const changeForm = (change: (form: Form) => Form) => setForm((now) => (now ? change(now) : now));
  const editing = (shelf: OwnShelves[number]) => form !== null && form.mode !== "add" && form.folder === shelf.folder;
  const formRows = form && <FormRows form={form} taken={taken} saving={saving} onForm={changeForm} onSave={() => void save()} onCancel={cancel} />;

  return (
    <Group label={SHELVES_LABEL} note={SHELVES_NOTE}>
      {shelves.length === 0 && <GroupRow label={SHELVES_EMPTY} />}
      {shelves.map((shelf) => (
        <Fragment key={shelf.folder}>
          <GroupRow label={shelf.name} description={shelfRowLine(shelf.definition, shelf.pages)}>
            {!editing(shelf) && (
              <div ref={(box) => void (buttons.current[shelf.folder] = box)}>
                <Row gap={8}>
                  <Button size="small" variant="secondary" onClick={() => setForm(formOfShelf(shelf))}>
                    {shelf.definition === "" ? ADD_DEFINITION : SHELF_EDIT}
                  </Button>
                  {canRemoveShelf(shelf) && (
                    <Confirm
                      open={removing === shelf.folder}
                      question={removeShelfQuestion(shelf.name)}
                      confirmLabel={SHELF_REMOVE}
                      onConfirm={() => {
                        setRemoving(null);
                        void send({ op: "remove", folder: shelf.folder }).then((removed) => removed && setFocus(ADD_FOCUS));
                      }}
                      onCancel={() => setRemoving(null)}
                    >
                      <Button size="small" variant="danger" expanded={removing === shelf.folder} onClick={() => setRemoving(removing === shelf.folder ? null : shelf.folder)}>
                        {SHELF_REMOVE}
                      </Button>
                    </Confirm>
                  )}
                </Row>
              </div>
            )}
          </GroupRow>
          {editing(shelf) && formRows}
        </Fragment>
      ))}
      {form?.mode === "add" ? (
        formRows
      ) : (
        <div ref={addBox} className="settings-editor">
          <Actions align="start">
            <Button size="small" variant="secondary" onClick={() => setForm(blankForm)}>{ADD_SHELF}</Button>
          </Actions>
        </div>
      )}
    </Group>
  );
}
