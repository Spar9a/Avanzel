// Settings → General → Your shelves: the shelves the owner made, each in a row with its definition and its pages, and the form that adds one,
// edits one or gives a folder made by hand its definition. Remove is there only for a shelf with no pages, and asks first. Each change is one
// call to main (`settings.shelves`), whose refusal is told by the window's Notice (`attemptChange`). Edit first, on a suggested shelf, opens the
// form filled in from `snap.shelfDraft`; Save then makes the shelf from that suggestion, which moves its pages onto it.
//
// Learn this library lives here too: an offer above the group while the library has folders of the owner's own that no study learned (with
// Not now, which puts it away here and in the panel), else Learn this library… beside Add shelf; either shows what a study costs before it
// starts, as the panel's Learn this library… does once it has opened General (`snap.studyPreviewAsked`). While one runs, how far it is and
// Stop; a study that paused on a failed run, in a Notice that goes on with it or starts over; and a study that is ready, its review screen
// in place of the group (StudyReview.tsx). Once a study has given the library a house style, its row has Edit and Remove, which asks first
// (`settings.setHouseStyle`).
import { Actions, Button, Confirm, Group, GroupRow, Notice, Progress, Row, Stack, Text, TextArea, TextField } from "@avanzel/ui";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { LibraryInfo, ShelfAsk, ShelfOp, StudyPreview } from "../../../shared/ipc.ts";
import { shortened } from "../../../shared/clip.ts";
import { harnessName } from "../../../main/jobs.ts";
import { STUDY_OFFER_LATER } from "../../panel/copy.ts";
import {
  ADD_DEFINITION,
  ADD_SHELF,
  canRemoveShelf,
  definitionLine,
  folderHint,
  folderLine,
  folderProblemText,
  handMadeFolderProblem,
  HOUSE_STYLE_LABEL,
  HOUSE_STYLE_SAVE,
  LEARN_LIBRARY,
  REMOVE_HOUSE_STYLE_QUESTION,
  removeShelfQuestion,
  RESUME_STUDY,
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
  START_OVER,
  START_STUDY,
  STUDY_FAILED_SAFE,
  STUDY_NOT_STARTED,
  STUDY_OFFER_BODY,
  STUDY_OFFER_TITLE,
  STUDY_PROGRESS_LABEL,
  STUDY_STOP,
  studyCostLine,
  studyRunningLine,
  SUGGESTED_SAVE_LINE,
} from "../copy.ts";
import { attemptChange, type PaneProps } from "../parts.tsx";
import { StudyReview, type StudyReviewState } from "./StudyReview.tsx";

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
export function Shelves(props: PaneProps & { shelves: OwnShelves; review: StudyReviewState }): ReactNode {
  const { snap, shelves, onChange, attempt, review } = props;
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  // Where the focus goes as the form closes or a shelf is removed (ADD_FOCUS or a folder): the button that was hidden or is the next thing to do.
  const [focus, setFocus] = useState<string | null>(null);
  const buttons = useRef<Record<string, HTMLElement | null>>({});
  const addBox = useRef<HTMLDivElement>(null);
  const taken = shelves.filter((shelf) => shelf.definition !== "").map((shelf) => shelf.folder);
  // Learn this library's confirm (what a study costs, once Learn this library… was pressed) and the house style's editor. The confirm, the
  // shelf form and the editor each have a primary button, so one opens at a time.
  const [preview, setPreview] = useState<{ cost: StudyPreview; fresh: boolean } | null>(null);
  const [studying, setStudying] = useState<"preview" | "start" | null>(null);
  const [styleDraft, setStyleDraft] = useState<string | null>(null);
  const [styleSaving, setStyleSaving] = useState<"save" | "remove" | null>(null);
  // The house style's Remove question, over its button.
  const [removingStyle, setRemovingStyle] = useState(false);

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
    setPreview(null);
    setStyleDraft(null);
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

  const study = snap.study;
  const unlearned = snap.library?.unlearnedFolders ?? [];
  const houseStyle = snap.library?.houseStyle ?? "";
  // The agent a study runs with, by the name people know it by, for what the confirm says it costs.
  const agent = snap.selectedHarness ? harnessName(snap.selectedHarness) : null;
  const openForm = (next: Form) => {
    setForm(next);
    setPreview(null);
    setStyleDraft(null);
  };
  // What a study costs, before it starts. `fresh`: Start over's, whose Start study begins afresh, forgetting what was studied so far.
  const learn = async (fresh = false) => {
    if (studying) return;
    setStudying("preview");
    try {
      const cost = await attempt(() => api.previewStudy(), STUDY_NOT_STARTED);
      if (cost) {
        setPreview({ cost, fresh });
        setForm(null);
        setStyleDraft(null);
      }
    } finally {
      setStudying(null);
    }
  };
  // Start study begins afresh; Go on with the study picks up where a stopped or paused one was.
  const start = async (fresh: boolean) => {
    if (studying) return;
    setStudying("start");
    try {
      const next = await attempt(() => api.startStudy(fresh), STUDY_NOT_STARTED);
      if (next) {
        onChange(next);
        setPreview(null);
      }
    } finally {
      setStudying(null);
    }
  };
  const saveStyle = async (style: string, how: "save" | "remove") => {
    if (styleSaving) return;
    setStyleSaving(how);
    try {
      const next = await attempt(() => api.setHouseStyle(style));
      if (next) {
        onChange(next);
        setStyleDraft(null);
      }
    } finally {
      setStyleSaving(null);
    }
  };

  // The panel's Learn this library… opens General with what a study costs showing: the ask is let go as it is taken, so it shows once.
  // A shelf form with something typed in it, or the house style's open editor, is never closed for it: the cost waits for the person's
  // own press of Learn this library….
  const previewAsked = snap.studyPreviewAsked;
  useEffect(() => {
    if (!previewAsked) return;
    api.dropStudyPreview();
    if (study.kind === "idle" && form?.dirty !== true && styleDraft === null) void learn();
  }, [previewAsked]);

  // A study that is ready: its review stands in place of the group until it is applied or discarded.
  if (study.kind === "ready") return <StudyReview {...props} proposal={study.proposal} review={review} />;

  const idle = study.kind === "idle";
  // The cost shows for Learn this library… (idle) and for a paused study's Start over (failed).
  const confirming = (idle || study.kind === "failed") && preview !== null;
  const fresh = preview?.fresh === true;
  const resumable = idle && study.resumable && !fresh;

  // The offer, above the group, while there are folders to learn, no study is going or being confirmed, and it wasn't put away (Not now,
  // here or in the panel). While it shows, its Learn this library… is the only one. A study that paused on a failed run goes on from where
  // it was, or starts over. Their buttons are secondaries: the pane's primary belongs to what is open in the group.
  const offering = idle && !confirming && unlearned.length > 0 && !snap.studyOfferDismissed;
  const offer = offering && (
    <Notice
      title={STUDY_OFFER_TITLE}
      actions={
        <Actions align="start">
          <Button size="small" variant="quiet" onClick={() => api.dismissStudyOffer()}>{STUDY_OFFER_LATER}</Button>
          <Button size="small" variant="secondary" busy={studying === "preview"} onClick={() => void learn()}>{LEARN_LIBRARY}</Button>
        </Actions>
      }
    >
      {STUDY_OFFER_BODY}
    </Notice>
  );
  // Start over shows what a fresh study costs first, and its Start study begins afresh; while that shows, the Notice only tells.
  const failed = study.kind === "failed" && (
    <Notice
      tone="error"
      title={study.message}
      actions={
        !confirming && (
          <Actions align="start">
            <Button size="small" variant="secondary" busy={studying === "preview"} disabled={studying === "start"} onClick={() => void learn(true)}>{START_OVER}</Button>
            <Button size="small" variant="secondary" busy={studying === "start"} disabled={studying === "preview"} onClick={() => void start(false)}>{RESUME_STUDY}</Button>
          </Actions>
        )
      }
    >
      {STUDY_FAILED_SAFE}
    </Notice>
  );
  const group = (
    <Group label={SHELVES_LABEL} note={SHELVES_NOTE}>
      {shelves.length === 0 && <GroupRow label={SHELVES_EMPTY} />}
      {shelves.map((shelf) => (
        <Fragment key={shelf.folder}>
          <GroupRow label={shelf.name} description={shelfRowLine(shelf.definition, shelf.pages)}>
            {!editing(shelf) && (
              <div ref={(box) => void (buttons.current[shelf.folder] = box)}>
                <Row gap={8}>
                  <Button size="small" variant="secondary" onClick={() => openForm(formOfShelf(shelf))}>
                    {shelf.definition === "" ? ADD_DEFINITION : SHELF_EDIT}
                  </Button>
                  {canRemoveShelf(shelf) && (
                    <Confirm
                      open={removing === shelf.folder}
                      question={removeShelfQuestion(shelf.name, shelf.empty)}
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
      {houseStyle !== "" && (
        <GroupRow label={HOUSE_STYLE_LABEL} description={shortened(houseStyle.replace(/\s+/g, " ").trim(), 160)}>
          {styleDraft === null && (
            <Row gap={8}>
              <Button
                size="small"
                variant="secondary"
                disabled={styleSaving !== null}
                onClick={() => {
                  setStyleDraft(houseStyle);
                  setForm(null);
                  setPreview(null);
                }}
              >
                {SHELF_EDIT}
              </Button>
              <Confirm
                open={removingStyle}
                question={REMOVE_HOUSE_STYLE_QUESTION}
                confirmLabel={SHELF_REMOVE}
                onConfirm={() => {
                  setRemovingStyle(false);
                  void saveStyle("", "remove");
                }}
                onCancel={() => setRemovingStyle(false)}
              >
                <Button size="small" variant="danger" expanded={removingStyle} busy={styleSaving === "remove"} onClick={() => setRemovingStyle(!removingStyle)}>
                  {SHELF_REMOVE}
                </Button>
              </Confirm>
            </Row>
          )}
        </GroupRow>
      )}
      {styleDraft !== null && (
        <div className="settings-editor">
          <Stack gap={10}>
            <TextArea label={HOUSE_STYLE_LABEL} labelHidden rows={6} value={styleDraft} autoFocus onChange={setStyleDraft} onEscape={() => setStyleDraft(null)} />
            <Actions>
              <Button variant="quiet" onClick={() => setStyleDraft(null)}>{SHELF_CANCEL}</Button>
              <Button variant="primary" busy={styleSaving === "save"} onClick={() => void saveStyle(styleDraft.trim(), "save")}>{HOUSE_STYLE_SAVE}</Button>
            </Actions>
          </Stack>
        </div>
      )}
      {study.kind === "running" && (
        <GroupRow label={STUDY_PROGRESS_LABEL} description={studyRunningLine(study)} live>
          <Row gap={8}>
            <div className="settings-meter">
              <Progress label={STUDY_PROGRESS_LABEL} {...(study.steps > 0 ? { value: study.done / study.steps } : {})} />
            </div>
            <Button size="small" variant="secondary" icon="stop" busy={study.stopping} onClick={() => api.stopStudy()}>{STUDY_STOP}</Button>
          </Row>
        </GroupRow>
      )}
      {confirming && (
        <div className="settings-editor">
          <Stack gap={10}>
            <Text variant="callout">{studyCostLine(preview.cost, agent)}</Text>
            <Actions>
              <Button variant="quiet" disabled={studying === "start"} onClick={() => setPreview(null)}>{SHELF_CANCEL}</Button>
              <Button variant="primary" busy={studying === "start"} onClick={() => void start(!resumable)}>{resumable ? RESUME_STUDY : START_STUDY}</Button>
            </Actions>
          </Stack>
        </div>
      )}
      {form?.mode === "add" ? (
        formRows
      ) : (
        <div ref={addBox} className="settings-editor">
          <Actions align="start">
            <Button size="small" variant="secondary" onClick={() => openForm(blankForm)}>{ADD_SHELF}</Button>
            {idle && !confirming && !offering && (
              <Button size="small" variant="secondary" busy={studying === "preview"} onClick={() => void learn()}>{LEARN_LIBRARY}</Button>
            )}
          </Actions>
        </div>
      )}
    </Group>
  );

  return (
    <>
      {offer}
      {failed}
      {group}
    </>
  );
}
