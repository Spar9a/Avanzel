// Settings → Reviews: each scheduled review in a group of its own, with its switch, when it runs and when it last ran,
// Run now, and an editor that opens in place under them; then the review files that can't be used, with why. The switch
// and Run now apply at once, and the editor saves on Save. What the editor holds, the saves on their way and why the last
// one failed are kept by the Settings shell (useReviewEdits), so leaving the pane keeps them. The pane needs a library:
// without one the shell draws NoLibrary in its place.
import { Actions, Button, Group, GroupRow, Notice, Segmented, Stack, Switch, Text, TextArea, TextField, type SegmentedOption } from "@avanzel/ui";
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { harnessName } from "../../../main/jobs.ts";
import type { HarnessInfo, PickOption, TaskInfo } from "../../../shared/ipc.ts";
import {
  DAYS,
  failedSaveLine,
  kindLine,
  lastRunLine,
  plainCause,
  reviewNotStarted,
  scheduleParts,
  scheduleText,
  validTime,
  whenLine,
} from "../copy.ts";
import { attemptChange, PickButton, type PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

type Every = "daily" | "weekly";

/** How often a review runs, in its editor. */
const REPEATS: readonly SegmentedOption<Every>[] = [
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
];

/** A review's agent when it has none of its own ("auto"): the one the library files with. */
const LIBRARY_AGENT = "The library's agent";

/** The evening review's note: what takes its last run back. */
const EVENING_NOTE = "Undo the last evening review, under Scheduled reviews in the menu bar menu, takes back its last run.";

/** What a review's save may change; the rest is saved as stored. */
export type Fields = Partial<Pick<TaskInfo, "schedule" | "agent" | "enabled" | "instructions">>;

/** What the open editor holds: the review's schedule, agent and instructions when Edit opened it, as changed since. */
export interface Draft {
  every: Every;
  day: string;
  /** As typed: Save takes it once validTime does. */
  time: string;
  agent: string;
  instructions: string;
  /** Save refused the time, and the Time row says why until the time is typed again. */
  refused: boolean;
}

/** The open editor's draft, by its review's id. */
type Drafts = Readonly<Record<string, Draft>>;

const draftOf = (task: TaskInfo): Draft => ({
  ...scheduleParts(task.schedule),
  agent: task.agent,
  instructions: task.instructions,
  refused: false,
});

/** `drafts` without review `id`'s. */
const without = (drafts: Drafts, id: string): Drafts => Object.fromEntries(Object.entries(drafts).filter(([each]) => each !== id));

/** A review's save that main refused: which review, and main's reason in plain words (plainCause of its error). */
export interface SaveFailure {
  id: string;
  message: string;
}

/**
 * What Settings keeps of the reviews whichever pane shows: leaving the pane keeps what the open editor holds, what it still
 * knows of a save on its way, and the save that failed.
 */
export interface ReviewEdits {
  /** The open editor's draft, by its review's id. One editor is open at a time, so it holds one at most. */
  drafts: Drafts;
  setDrafts: Dispatch<SetStateAction<Drafts>>;
  /**
   * The reviews with a save on its way. A save waits its turn behind a filing or a run, and carries every field as
   * Settings last drew them, so a second save of the review meanwhile would write its stale fields over the first. Until
   * the first is written, nothing else saves that review: its switch and Save wait, and so does General's Turn on.
   */
  saving: ReadonlySet<string>;
  /**
   * The review whose last save main refused, and why; null when none. It is kept here, with the drafts, and not by the pane:
   * a person who leaves the pane while a save waits, and comes back to find it failed, still finds the Notice under the
   * review. It goes when that review is saved, or its editor opens or closes (`clearFailure`), or another library opens.
   */
  failure: SaveFailure | null;
  /** Forgets review `id`'s failure, if it is the one kept: its editor was opened or closed, or the window has told it. */
  clearFailure(id: string): void;
  /**
   * Saves `task` with `fields` changed and the rest as stored, and draws the snapshot main sends back. Whether it saved:
   * while a save of that review is on its way, it saves nothing. A save main refuses is kept as `failure`, and throws main's
   * error, for the caller to tell it once. The Reviews pane tells it under the review, which is where `failure` shows it. General's
   * Turn on, whose review is the evening one, lets the window tell it (`attempt`) and clears `failure`, so that Reviews
   * doesn't tell it again.
   */
  save(task: TaskInfo, fields: Fields): Promise<boolean>;
}

/**
 * The reviews' edits, for the Settings shell to keep (ReviewEdits). A draft is of the library open when it was made: once
 * another library opens, whose reviews may have the same ids, the drafts and the failure are dropped.
 */
export function useReviewEdits(library: string | null, onChange: PaneProps["onChange"]): ReviewEdits {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [draftsOf, setDraftsOf] = useState(library);
  if (draftsOf !== library) {
    setDraftsOf(library);
    setDrafts({});
    setFailure(null);
  }
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const clearFailure = (id: string) => setFailure((last) => (last?.id === id ? null : last));
  const save = async (task: TaskInfo, fields: Fields): Promise<boolean> => {
    const { id, name, schedule, agent, enabled, instructions } = task;
    if (saving.has(id)) return false;
    setSaving((last) => new Set(last).add(id));
    try {
      onChange(await api.saveTask({ id, name, schedule, agent, enabled, instructions, ...fields }));
      clearFailure(id);
      return true;
    } catch (error) {
      setFailure({ id, message: plainCause(error) });
      throw error;
    } finally {
      setSaving((last) => new Set([...last].filter((each) => each !== id)));
    }
  };
  return { drafts, setDrafts, saving, failure, clearFailure, save };
}

/** The pop-up menu of a review's agent: the library's own, then each agent installed, with the review's checked. */
function agentOptions(agent: string, harnesses: readonly HarnessInfo[]): PickOption[] {
  return [
    { label: LIBRARY_AGENT, value: "auto", checked: agent === "auto" },
    ...harnesses
      .filter((harness) => harness.available)
      .map((harness) => ({ label: harnessName(harness.name), value: harness.name, checked: harness.name === agent })),
  ];
}

interface EditorProps {
  draft: Draft;
  harnesses: readonly HarnessInfo[];
  /** A save of this review is on its way: Save is busy until it is written. */
  saving: boolean;
  /** Changes the draft. `change` makes the next draft from the one then, so a menu's pick keeps what was typed meanwhile. */
  onDraft(change: (draft: Draft) => Draft): void;
  onSave(): void;
  onCancel(): void;
}

/**
 * A review's editor, under its row: how often, the day (weekly only), the time and the agent, each a row of the group;
 * then the instructions, and Cancel and Save, each in a box of the window's own. They are given back side by side, so
 * every row stays a direct child of the group's panel.
 */
function Editor({ draft, harnesses, saving, onDraft, onSave, onCancel }: EditorProps): ReactNode {
  const day = DAYS.find((each) => each.value === draft.day)?.label ?? draft.day;
  const agent = draft.agent === "auto" ? LIBRARY_AGENT : harnessName(draft.agent);
  return (
    <>
      <GroupRow label="Repeats">
        <Segmented label="How often" options={REPEATS} value={draft.every} onChange={(every) => onDraft((now) => ({ ...now, every }))} />
      </GroupRow>
      {draft.every === "weekly" && (
        <GroupRow label="Day">
          <PickButton
            label="Day"
            value={day}
            options={DAYS.map((each) => ({ ...each, checked: each.value === draft.day }))}
            onChoose={(value) => onDraft((now) => ({ ...now, day: value }))}
          />
        </GroupRow>
      )}
      <GroupRow label="Time" description={draft.refused ? "Use a time like 21:00." : undefined}>
        <div className="settings-time">
          <TextField label="Time" labelHidden value={draft.time} onChange={(time) => onDraft((now) => ({ ...now, time, refused: false }))} onEnter={onSave} />
        </div>
      </GroupRow>
      <GroupRow label="Agent">
        <PickButton label="Agent" value={agent} options={agentOptions(draft.agent, harnesses)} onChoose={(value) => onDraft((now) => ({ ...now, agent: value }))} />
      </GroupRow>
      {/* Not rows: a field of several lines, and the editor's buttons, each in a box padded as a row is. */}
      <div className="settings-editor">
        <TextArea label="Instructions" rows={5} value={draft.instructions} onChange={(instructions) => onDraft((now) => ({ ...now, instructions }))} />
      </div>
      <div className="settings-editor">
        <Actions>
          <Button variant="quiet" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" busy={saving} onClick={onSave}>Save</Button>
        </Actions>
      </div>
    </>
  );
}

interface ReviewProps {
  task: TaskInfo;
  now: Date;
  harnesses: readonly HarnessInfo[];
  /** The editor's draft while this review's editor is open, else null. */
  draft: Draft | null;
  /** A save of this review is on its way: the switch and Save wait until it is written. */
  saving: boolean;
  /** What the Notice under it says when its last save failed (failedSaveLine): why, and what is true of it as stored. */
  failure: string | null;
  onDraft: EditorProps["onDraft"];
  /** The switch: the review saved with it on or off, and everything else as stored. */
  onSwitch(enabled: boolean): void;
  /** Save, in the editor: `beforeClose` runs just before a save that worked closes it. */
  onSave(beforeClose: () => void): void;
  onRun(): void;
  /** Edit: the editor opens, from the review as stored. */
  onEdit(): void;
  /** Cancel: the editor closes, and what it held is dropped. */
  onCancel(): void;
}

/**
 * One review: a group named for it, so VoiceOver says whose Run now it is and tests find each review's controls by it.
 * Its switch, then when it runs and when it last ran, with Run now and Edit; while it is edited, its editor in Edit's
 * place; and under the group, why its last save failed.
 */
function Review({ task, now, harnesses, draft, saving, failure, onDraft, onSwitch, onSave, onRun, onEdit, onCancel }: ReviewProps): ReactNode {
  const group = useRef<HTMLDivElement>(null);
  const toggle = () => group.current?.querySelector<HTMLElement>('[role="switch"]');
  // The switch is disabled while its save is on its way, and a disabled control drops the keyboard focus. If the switch
  // had it when it was turned, it gets it back once the save is done, unless something else has taken it meanwhile.
  const refocus = useRef(false);
  useEffect(() => {
    if (saving || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement === document.body) toggle()?.focus();
  }, [saving]);
  // Edit goes as the editor opens, and Cancel, or Save once it has saved, as it closes: the focus the pressed one had goes
  // on into the editor, to its first control, or back to Edit.
  const editing = draft !== null;
  const handOver = useRef<"editor" | "edit" | null>(null);
  useEffect(() => {
    const next = handOver.current;
    handOver.current = null;
    if (next === "editor") group.current?.querySelector<HTMLElement>('[role="radiogroup"][aria-label="How often"] [aria-checked="true"]')?.focus();
    if (next === "edit") Array.from(group.current?.querySelectorAll<HTMLElement>("button") ?? []).find((button) => button.textContent === "Edit")?.focus();
  }, [editing]);
  return (
    <div ref={group} role="group" aria-label={task.name}>
      <Stack gap={12}>
        <Group label={task.name} note={task.kind === "evening-review" ? EVENING_NOTE : undefined}>
          <Switch
            label="Run on schedule"
            description={kindLine(task.kind)}
            checked={task.enabled}
            disabled={saving}
            onChange={(enabled) => {
              refocus.current = document.activeElement === toggle();
              onSwitch(enabled);
            }}
          />
          <GroupRow label={whenLine(task.schedule)} description={lastRunLine(task, now)}>
            <Button size="small" variant="secondary" busy={task.running} onClick={onRun}>Run now</Button>
            {!editing && (
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  handOver.current = "editor";
                  onEdit();
                }}
              >
                Edit
              </Button>
            )}
          </GroupRow>
          {draft && (
            <Editor
              draft={draft}
              harnesses={harnesses}
              saving={saving}
              onDraft={onDraft}
              onSave={() =>
                onSave(() => {
                  handOver.current = "edit";
                })
              }
              onCancel={() => {
                handOver.current = "edit";
                onCancel();
              }}
            />
          )}
        </Group>
        {failure && <Notice tone="error" title="This review couldn't be saved.">{failure}</Notice>}
      </Stack>
    </div>
  );
}

/**
 * The Reviews pane: a footnote on how reviews run, each review, and the files in tasks/ that can't be used. `edits` are
 * the Settings shell's (useReviewEdits).
 */
export function Reviews(props: PaneProps & { edits: ReviewEdits }): ReactNode {
  const { snap, edits } = props;
  // The review whose last save failed, and why, is the window's (ReviewEdits): shown until that review is saved again, or
  // its editor opens or closes, whichever pane has shown meanwhile.
  const { drafts, setDrafts, saving, failure, clearFailure } = edits;
  const now = new Date();
  /** Changes review `id`'s draft, from the one then, while its editor is open. */
  const changeDraft = (id: string, change: (draft: Draft) => Draft) =>
    setDrafts((last) => {
      const draft = last[id];
      return draft ? { ...last, [id]: change(draft) } : last;
    });

  /**
   * Saves `task` with `fields` changed and the rest as stored. Whether it saved: if not, main's refusal is `edits.failure`,
   * which the Notice under the review tells. That is where it is told, with what is true of the review as stored, so the
   * window's own "That change wasn't saved." is not made to tell it twice.
   */
  const save = async (task: TaskInfo, fields: Fields): Promise<boolean> => {
    try {
      return await edits.save(task, fields);
    } catch {
      return false;
    }
  };

  /**
   * Save, in the open editor: a time that isn't one is refused and nothing is saved; a save that works closes it, just
   * after `beforeClose`.
   */
  const saveDraft = async (task: TaskInfo, beforeClose: () => void) => {
    const draft = drafts[task.id];
    if (!draft || saving.has(task.id)) return;
    const time = validTime(draft.time);
    if (!time) {
      changeDraft(task.id, (last) => ({ ...last, refused: true }));
      return;
    }
    const saved = await save(task, { schedule: scheduleText(draft.every, draft.day, time), agent: draft.agent, instructions: draft.instructions });
    if (!saved) return;
    beforeClose();
    setDrafts((last) => without(last, task.id));
  };

  return (
    <Stack gap={20}>
      {/* Inset as a group's label and note are, so its words line up with theirs. */}
      <div className="settings-intro">
        <Text variant="footnote" tone="secondary">
          Scheduled reviews run on this Mac with your agent, on your plan. If the Mac is asleep at the time, a review runs once it wakes.
        </Text>
      </div>
      {snap.tasks.map((task) => (
        <Review
          key={task.id}
          task={task}
          now={now}
          harnesses={snap.harnesses}
          draft={drafts[task.id] ?? null}
          saving={saving.has(task.id)}
          failure={failure?.id === task.id ? failedSaveLine(task, failure.message) : null}
          onDraft={(change) => changeDraft(task.id, change)}
          onSwitch={(enabled) => void save(task, { enabled })}
          onSave={(beforeClose) => void saveDraft(task, beforeClose)}
          onRun={() => attemptChange(props, () => api.runTask(task.id), reviewNotStarted(task.name))}
          // One editor is open at a time: Edit opens this one from the review as stored, and drops any other's draft.
          onEdit={() => {
            clearFailure(task.id);
            setDrafts({ [task.id]: draftOf(task) });
          }}
          onCancel={() => {
            clearFailure(task.id);
            setDrafts((last) => without(last, task.id));
          }}
        />
      ))}
      {snap.taskProblems.length > 0 && (
        <Group label="Files that can't be used" note="Fix them in your library's tasks/ folder. The other reviews run as usual.">
          {snap.taskProblems.map((problem) => <GroupRow key={problem.file} label={problem.file} description={problem.message} />)}
        </Group>
      )}
    </Stack>
  );
}
