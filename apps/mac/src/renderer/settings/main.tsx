// The Settings window: a strip to drag it by, the toolbar that moves between its panes, and the pane under its
// heading. Each pane applies a change at once and draws the snapshot main sends back. The panes not rebuilt on
// @avanzel/ui yet (the tasks pane and Privacy) stay here, with their helpers, until their own tasks.
import { Segmented, Stack, Text } from "@avanzel/ui";
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SETTINGS_PANES, isSettingsPane, type AvanzelBridge, type SettingsPane, type SettingsSnapshot, type TaskInfo } from "../../shared/ipc.ts";
import { PANE_LABELS } from "./copy.ts";
import { Agents } from "./panes/Agents.tsx";
import { General } from "./panes/General.tsx";
import { Voice } from "./panes/Voice.tsx";
import { NoLibrary, type PaneProps } from "./parts.tsx";
import "../common/mac.css";
import "./styles.css";

declare global {
  interface Window { avanzel: AvanzelBridge }
}

const api = window.avanzel.settings;

/** The pane the window was opened on: the one its address names (?pane=voice), if Settings has it. */
function startingPane(): SettingsPane {
  const pane = new URLSearchParams(location.search).get("pane");
  return isSettingsPane(pane) ? pane : "general";
}

const HARNESS_NAMES: Record<string, string> = {
  claude: "Claude Code", codex: "Codex", opencode: "OpenCode", "cursor-agent": "Cursor Agent", gemini: "Gemini CLI",
};
const harnessName = (name: string) => HARNESS_NAMES[name] ?? name;

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" role="switch" className="sw" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

function Group({ label, children, note }: { label?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <>
      {label && <div className="glabel">{label}</div>}
      <div className="group">{children}</div>
      {note && <p className="note">{note}</p>}
    </>
  );
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES: Record<string, string> = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };

function TaskRow({ task, snap, onChange }: { task: TaskInfo; snap: SettingsSnapshot; onChange: (s: SettingsSnapshot) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(task);
  useEffect(() => setDraft(task), [task]);
  const [kind, ...rest] = draft.schedule.split(" ");
  const weekly = kind === "weekly";
  const day = weekly ? rest[0] ?? "sun" : "sun";
  const time = (weekly ? rest[1] : rest[0]) ?? "21:00";
  const setSchedule = (nextKind: string, nextDay: string, nextTime: string) =>
    setDraft({ ...draft, schedule: nextKind === "weekly" ? `weekly ${nextDay} ${nextTime}` : `daily ${nextTime}` });
  const save = async (patch: Partial<TaskInfo> = {}) => onChange(await api.saveTask({ ...draft, ...patch }));
  const when = weekly ? `${DAY_NAMES[day] ?? day}s at ${time}` : `Every day at ${time}`;
  const last = task.lastRun ? `Last run ${new Date(task.lastRun).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}.` : "Not run yet.";
  return (
    <>
      <div className="grow">
        <Toggle label={`${task.name} enabled`} checked={task.enabled} onChange={(v) => save({ enabled: v })} />
        <span className="fill two"><b>{task.name}</b><small>{when}. {task.running ? "Running now…" : last}</small></span>
        <button className="btn" disabled={task.running} onClick={async () => onChange(await api.runTask(task.id))}>Run now</button>
        <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close" : "Edit"}</button>
      </div>
      {open && (
        <div className="task-editor">
          <div className="line">
            <span className="k">Runs</span>
            <select aria-label="How often" value={weekly ? "weekly" : "daily"} onChange={(e) => setSchedule(e.target.value, day, time)}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </select>
            {weekly && (
              <select aria-label="Day" value={day} onChange={(e) => setSchedule("weekly", e.target.value, time)}>
                {WEEKDAYS.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
              </select>
            )}
            <input type="time" aria-label="Time" value={time} onChange={(e) => setSchedule(weekly ? "weekly" : "daily", day, e.target.value)} />
            <select aria-label="Agent" value={draft.agent} onChange={(e) => setDraft({ ...draft, agent: e.target.value })}>
              <option value="auto">Default agent</option>
              {snap.harnesses.filter((h) => h.available).map((h) => <option key={h.name} value={h.name}>{harnessName(h.name)}</option>)}
            </select>
          </div>
          <div className="line">
            <span className="k">Instructions</span>
            <textarea aria-label="Instructions" value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
          </div>
          <div className="actions">
            <button className="btn primary" onClick={async () => { await save(); setOpen(false); }}>Save</button>
          </div>
        </div>
      )}
    </>
  );
}

function Tasks({ snap, onChange }: { snap: SettingsSnapshot; onChange: (s: SettingsSnapshot) => void }) {
  if (!snap.library?.exists) return <p className="note">Create your library first (General).</p>;
  return (
    <>
      <Group note="Tasks are files in your library's tasks/ folder. Avanzel runs them on this Mac with your agent; if the Mac is asleep at the time, the task runs once when it wakes. To take back the last evening review, use Undo last evening review in the menu bar menu.">
        {snap.tasks.map((task) => <TaskRow key={task.id} task={task} snap={snap} onChange={onChange} />)}
      </Group>
      {snap.taskProblems.length > 0 && (
        <Group label="Can't be used" note="Fix these files in your library's tasks/ folder; the other tasks run as usual.">
          {snap.taskProblems.map((problem) => (
            <div className="grow" key={problem.file}>
              <span className="fill two"><b>{problem.file}</b><span className="problem">{problem.message}</span></span>
            </div>
          ))}
        </Group>
      )}
    </>
  );
}

function Privacy({ snap, onChange }: { snap: SettingsSnapshot; onChange: (s: SettingsSnapshot) => void }) {
  const row = (kind: "microphone" | "screen", label: string, why: string) => {
    const status = snap.permissions[kind];
    return (
      <div className="grow">
        <span className="fill two"><b>{label}</b><small>{why}</small></span>
        {status === "granted" ? <span className="status-ok">Allowed</span> : status === "not-determined"
          ? <button className="btn" onClick={async () => onChange(await api.requestPermission(kind))}>Allow…</button>
          : <button className="btn" onClick={() => api.openPrivacy(kind)}>Open System Settings</button>}
      </div>
    );
  };
  return (
    <>
      <Group label="Permissions" note="After you allow Screen Recording in System Settings, quit and reopen Avanzel: macOS applies it only then.">
        {row("microphone", "Microphone", "Only while the capsule is listening.")}
        {row("screen", "Screen Recording", "Only when you capture the screen with a comment.")}
      </Group>
      <Group label="What leaves this Mac">
        <div className="grow">
          <span className="fill two" style={{ lineHeight: 1.5 }}>
            <span>Audio and transcription never leave this Mac.</span>
            <small>When your agent files a note or answers a question, it sends that note and the pages it needs to the model behind your agent CLI, the same trust you already give it for code. Avanzel has no server.</small>
          </span>
        </div>
      </Group>
    </>
  );
}

/** The toolbar's choices: every pane, in order, by its name. */
const PANES = SETTINGS_PANES.map((pane) => ({ value: pane, label: PANE_LABELS[pane] }));

/**
 * What pane `pane` holds. A rebuilt pane that needs a library is drawn here only while there is one, with NoLibrary in
 * its place otherwise (`snap.library?.exists ? <Pane {...props} /> : <NoLibrary {...props} />`), rather than returning
 * early above its own hooks.
 */
function paneContent(pane: SettingsPane, props: PaneProps): ReactNode {
  switch (pane) {
    case "general":
      return <General {...props} />;
    case "voice":
      return <Voice {...props} />;
    case "agents":
      return props.snap.library?.exists ? <Agents {...props} /> : <NoLibrary {...props} />;
    case "tasks":
      return <Tasks {...props} />;
    case "privacy":
      return <Privacy {...props} />;
  }
}

function App() {
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [pane, setPane] = useState<SettingsPane>(startingPane);
  useEffect(() => {
    api.get().then(setSnap);
    return api.onChanged(setSnap);
  }, []);
  // An error card's Open Settings, while this window is open: a pane Settings doesn't have means General.
  useEffect(() => api.onShowPane((next) => setPane(isSettingsPane(next) ? next : "general")), []);
  if (!snap) return null;
  return (
    <div className="settings">
      <div className="settings-drag" />
      <div className="settings-toolbar">
        <Segmented label="Section" options={PANES} value={pane} onChange={setPane} />
      </div>
      {/* Keyed by its pane: a pane starts at its top, and the one left is unmounted, which ends whatever it had going. */}
      <main key={pane} className="settings-pane">
        <Stack gap={20}>
          <Text variant="heading">{PANE_LABELS[pane]}</Text>
          <div>{paneContent(pane, { snap, onChange: setSnap })}</div>
        </Stack>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
