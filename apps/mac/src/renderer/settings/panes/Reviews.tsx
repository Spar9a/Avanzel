// Settings → Reviews: each scheduled review in a group of its own, with its switch, when it runs and when it last ran,
// Run now, and an editor that opens in place under them; then the review files that can't be used, with why. The switch
// and Run now apply at once, and the editor saves on Save. The pane needs a library: without one the shell draws
// NoLibrary in its place.
import { Actions, Button, Group, GroupRow, Notice, Segmented, Stack, Switch, Text, TextArea, TextField, type SegmentedOption } from "@avanzel/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { harnessName } from "../../../main/jobs.ts";
import type { HarnessInfo, PickOption, TaskInfo } from "../../../shared/ipc.ts";
import { DAYS, kindLine, lastRunLine, remoteMessage, scheduleParts, scheduleText, validTime, whenLine } from "../copy.ts";
import { ChooseButton, type PaneProps } from "../parts.tsx";

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
const EVENING_NOTE = "Undo last evening review, in the menu bar menu, takes back its last run.";

/** What a review's save may change; the rest is saved as stored. */
type Fields = Partial<Pick<TaskInfo, "schedule" | "agent" | "enabled" | "instructions">>;

/** What the open editor holds: the review's schedule, agent and instructions when Edit opened it, as changed since. */
interface Draft {
  every: Every;
  day: string;
  /** As typed: Save takes it once validTime does. */
  time: string;
  agent: string;
  instructions: string;
  /** Save refused the time, and the Time row says why until the time is typed again. */
  refused: boolean;
}

const draftOf = (task: TaskInfo): Draft => ({
  ...scheduleParts(task.schedule),
  agent: task.agent,
  instructions: task.instructions,
  refused: false,
});

/** Choose…'s menu for a review's agent: the library's own, then each agent installed, with the review's checked. */
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
}

/**
 * A review's editor, under its row: how often, the day (weekly only), the time and the agent, each a row of the group;
 * then the instructions and Save, each in a box of the window's own. They are given back side by side, so every row
 * stays a direct child of the group's panel.
 */
function Editor({ draft, harnesses, saving, onDraft, onSave }: EditorProps): ReactNode {
  return (
    <>
      <GroupRow label="Repeats">
        <Segmented label="How often" options={REPEATS} value={draft.every} onChange={(every) => onDraft((now) => ({ ...now, every }))} />
      </GroupRow>
      {draft.every === "weekly" && (
        <GroupRow label="Day">
          <Text as="span">{DAYS.find((day) => day.value === draft.day)?.label ?? draft.day}</Text>
          <ChooseButton
            label="Day"
            options={DAYS.map((day) => ({ ...day, checked: day.value === draft.day }))}
            onChoose={(day) => onDraft((now) => ({ ...now, day }))}
          />
        </GroupRow>
      )}
      <GroupRow label="Time" description={draft.refused ? "Use a time like 21:00." : undefined}>
        <div className="settings-time">
          <TextField label="Time" labelHidden value={draft.time} onChange={(time) => onDraft((now) => ({ ...now, time, refused: false }))} onEnter={onSave} />
        </div>
      </GroupRow>
      <GroupRow label="Agent">
        <Text as="span">{draft.agent === "auto" ? LIBRARY_AGENT : harnessName(draft.agent)}</Text>
        <ChooseButton label="Agent" options={agentOptions(draft.agent, harnesses)} onChoose={(agent) => onDraft((now) => ({ ...now, agent }))} />
      </GroupRow>
      {/* Not rows: a field of several lines, and the editor's Save, each in a box padded as a row is. */}
      <div className="settings-editor">
        <TextArea label="Instructions" rows={5} value={draft.instructions} onChange={(instructions) => onDraft((now) => ({ ...now, instructions }))} />
      </div>
      <div className="settings-editor">
        <Actions>
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
  /** Why this review's last save failed, if it did. */
  failure: string | null;
  onDraft: EditorProps["onDraft"];
  /** The switch: the review saved with it on or off, and everything else as stored. */
  onSwitch(enabled: boolean): void;
  onSave(): void;
  onRun(): void;
  /** Edit or Close. */
  onEditor(): void;
}

/**
 * One review: a group named for it, so VoiceOver says whose Run now it is and tests find each review's controls by it.
 * Its switch, then when it runs and when it last ran, with Run now and Edit; while it is edited, its editor; and under
 * the group, why its last save failed.
 */
function Review({ task, now, harnesses, draft, saving, failure, onDraft, onSwitch, onSave, onRun, onEditor }: ReviewProps): ReactNode {
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
  return (
    <div ref={group} role="group" aria-label={task.name}>
      <Stack gap={12}>
        <Group label={task.name} note={task.kind === "evening-review" ? EVENING_NOTE : undefined}>
          <Switch
            label="On"
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
            <Button size="small" variant="secondary" onClick={onEditor}>{draft ? "Close" : "Edit"}</Button>
          </GroupRow>
          {draft && <Editor draft={draft} harnesses={harnesses} saving={saving} onDraft={onDraft} onSave={onSave} />}
        </Group>
        {failure && <Notice tone="error" title="This review couldn't be saved.">{failure}</Notice>}
      </Stack>
    </div>
  );
}

/** The Reviews pane: a footnote on how reviews run, each review, and the files in tasks/ that can't be used. */
export function Reviews({ snap, onChange }: PaneProps): ReactNode {
  // The review whose editor is open, by id, and what the editor holds: one at a time. Close, or Edit on another review,
  // drops the draft, and the next Edit starts again from the review as stored.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The review whose last save failed, and why: shown until that review is saved again, or its editor opens or closes.
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  // The reviews with a save on its way. A save waits its turn behind a filing or a run, and carries every field as this
  // pane last drew them, so a second save of the review meanwhile would write its stale fields over the first. Until
  // the first is written, that review's switch and Save wait too.
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const now = new Date();

  /** Saves `task` with `fields` changed and the rest as stored. Whether it saved: if not, the failure shows under it. */
  const save = async (task: TaskInfo, fields: Fields): Promise<boolean> => {
    const { id, name, schedule, agent, enabled, instructions } = task;
    if (saving.has(id)) return false;
    setSaving((last) => new Set(last).add(id));
    try {
      onChange(await api.saveTask({ id, name, schedule, agent, enabled, instructions, ...fields }));
      setFailure((last) => (last?.id === id ? null : last));
      return true;
    } catch (error) {
      setFailure({ id, message: remoteMessage(error) });
      return false;
    } finally {
      setSaving((last) => new Set([...last].filter((each) => each !== id)));
    }
  };

  /** Save, in the open editor: a time that isn't one is refused and nothing is saved; a save that works closes it. */
  const saveDraft = async (task: TaskInfo) => {
    if (!draft || saving.has(task.id)) return;
    const time = validTime(draft.time);
    if (!time) {
      setDraft({ ...draft, refused: true });
      return;
    }
    const saved = await save(task, { schedule: scheduleText(draft.every, draft.day, time), agent: draft.agent, instructions: draft.instructions });
    if (saved) setEditing((open) => (open === task.id ? null : open));
  };

  /** Edit opens `task`'s editor from the review as stored, closing any other; Close closes it, and its draft is dropped. */
  const toggleEditor = (task: TaskInfo) => {
    setFailure((last) => (last?.id === task.id ? null : last));
    if (editing === task.id) {
      setEditing(null);
      return;
    }
    setDraft(draftOf(task));
    setEditing(task.id);
  };

  return (
    <Stack gap={20}>
      <Text variant="footnote" tone="secondary">
        Scheduled reviews run on this Mac with your agent, on your plan. If the Mac is asleep at the time, a review runs once it wakes.
      </Text>
      {snap.tasks.map((task) => (
        <Review
          key={task.id}
          task={task}
          now={now}
          harnesses={snap.harnesses}
          draft={editing === task.id ? draft : null}
          saving={saving.has(task.id)}
          failure={failure?.id === task.id ? failure.message : null}
          onDraft={(change) => setDraft((last) => last && change(last))}
          onSwitch={(enabled) => void save(task, { enabled })}
          onSave={() => void saveDraft(task)}
          onRun={async () => onChange(await api.runTask(task.id))}
          onEditor={() => toggleEditor(task)}
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
