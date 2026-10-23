// The Settings window: a strip to drag it by, the toolbar that moves between its panes, and the pane under its
// heading. Each pane applies a change at once and draws the snapshot main sends back. The panes not rebuilt on
// @avanzel/ui yet (Voice, but for its Microphone group, Agents, the tasks pane and Privacy) stay here, with their
// helpers, until their own tasks.
import { Button, Row, Segmented, Stack, Text } from "@avanzel/ui";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { createRoot } from "react-dom/client";
import { SETTINGS_PANES, isSettingsPane, type AgentStatus, type AvanzelBridge, type SettingsPane, type SettingsSnapshot, type Shortcuts, type TaskInfo } from "../../shared/ipc.ts";
import { ACTION_NAMES, prettyAccelerator } from "../../main/shortcuts.ts";
import { PANE_LABELS } from "./copy.ts";
import { General } from "./panes/General.tsx";
import { MicrophoneGroup } from "./panes/Voice.tsx";
import type { PaneProps } from "./parts.tsx";
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

const KEY_CODES: Record<string, string> = {
  Space: "Space", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
};

/** A keydown → Electron accelerator ("Alt+Shift+S"), or null while only modifiers are held. */
function toAccelerator(e: React.KeyboardEvent): string | null {
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Command"].filter(Boolean) as string[];
  const code = e.nativeEvent.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code : KEY_CODES[code];
  if (!key) return null;
  if (!mods.length && !/^F\d/.test(key)) return null;
  return [...mods, key].join("+");
}

function ShortcutField({ value, onChange, label, ref }: { value: string; onChange: (v: string) => void; label: string; ref?: Ref<HTMLButtonElement> }) {
  const [recording, setRecording] = useState(false);
  return (
    <button
      ref={ref}
      className={`btn keys${recording ? " recording" : ""}`}
      aria-label={`${label} shortcut`}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        if (e.key === "Escape") return setRecording(false);
        const accelerator = toAccelerator(e);
        if (accelerator) {
          onChange(accelerator);
          setRecording(false);
        }
      }}
    >
      {recording ? "Type the new shortcut…" : prettyAccelerator(value)}
    </button>
  );
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

function Voice({ snap, onChange }: { snap: SettingsSnapshot; onChange: (s: SettingsSnapshot) => void }) {
  const rows = Object.entries(ACTION_NAMES) as [keyof Shortcuts, string][];
  // Each row's shortcut field: a picked "Use …" goes with the others, so the focus moves to the field it changed.
  const fields = useRef<Partial<Record<keyof Shortcuts, HTMLButtonElement | null>>>({});
  const model = snap.model;
  return (
    <>
      <Group
        label="Shortcuts"
        note="Press a shortcut once to start and again to stop. While Avanzel listens, Esc cancels the dictation from any app. Edit, while your agent files a note, stops the agent, takes back what it did and files your corrected words instead."
      >
        {rows.map(([key, label]) => {
          const use = async (accelerator: string) => onChange(await api.setApp({ shortcuts: { ...snap.app.shortcuts, [key]: accelerator } }));
          const pick = async (accelerator: string) => {
            await use(accelerator);
            fields.current[key]?.focus();
          };
          const alternatives = snap.shortcutAlternatives[key] ?? [];
          return (
            <div className="grow" key={key}>
              <div className="fill two">
                {label}
                {snap.shortcutProblems[key] && <span className="problem">{snap.shortcutProblems[key]}</span>}
                {alternatives.length > 0 && (
                  <div className="alternatives">
                    <Row gap={6}>
                      {alternatives.map((alternative) => (
                        <Button key={alternative} size="small" variant="secondary" onClick={() => void pick(alternative)}>
                          {`Use ${prettyAccelerator(alternative)}`}
                        </Button>
                      ))}
                    </Row>
                  </div>
                )}
              </div>
              <ShortcutField ref={(field) => { fields.current[key] = field; }} label={label} value={snap.app.shortcuts[key]} onChange={use} />
            </div>
          );
        })}
      </Group>
      <Group label="Speech model" note="Speech models run on this Mac. Your voice never leaves it.">
        <div className="grow">
          <span className="fill two"><b>Parakeet v3</b><small>25 European languages, including English, Russian and Ukrainian</small></span>
          {model.kind === "ready" && <span className="status-ok">Ready</span>}
          {model.kind === "missing" && <button className="btn primary" onClick={async () => onChange(await api.downloadModel())}>Download ({Math.round(model.bytes / 1e6)} MB)</button>}
          {model.kind === "downloading" && (
            <>
              <span className="bar" aria-label="Download progress"><i style={{ width: `${model.totalBytes ? (100 * model.receivedBytes) / model.totalBytes : 0}%` }} /></span>
              <span className="sub">{Math.round(model.receivedBytes / 1e6)} of {Math.round(model.totalBytes / 1e6)} MB</span>
            </>
          )}
          {model.kind === "error" && (
            <>
              <span className="status-bad">{model.message}</span>
              {model.cause === "download" && <button className="btn" onClick={async () => onChange(await api.downloadModel())}>Try again</button>}
            </>
          )}
        </div>
      </Group>
      {/* The rebuilt group among the legacy ones above it, which leave no space under them. */}
      <div className="settings-microphone">
        <MicrophoneGroup snap={snap} onChange={onChange} />
      </div>
    </>
  );
}

/** A problem's ink: red for the agent in use, which files and answers, and secondary for the others. */
type ProblemTone = "danger" | "secondary";

/** After "Not signed in.": how to sign in to agent `name`, with the command for the agents that have one. */
function signInHint(name: string, tone: ProblemTone): ReactNode {
  if (name === "claude") return <>Run <Text variant="code" tone={tone}>claude</Text> once in Terminal and sign in.</>;
  if (name === "codex") return <>Run <Text variant="code" tone={tone}>codex login</Text> in Terminal.</>;
  return `Sign in to ${harnessName(name)} in Terminal.`;
}

/** A line the agent printed, as a sentence: without the "Error:" label many CLIs put first. */
function ownLine(detail: string): string {
  const line = detail.replace(/^error\s*:\s*/i, "");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The line under an installed agent's name: its check running, or what the check found. */
function CheckStatus({ name, status, tone }: { name: string; status: AgentStatus; tone: ProblemTone }) {
  switch (status.kind) {
    case "checking":
      return <Text variant="footnote" tone="secondary">Checking…</Text>;
    case "signed-in":
      return <Text variant="footnote" tone="secondary">Signed in</Text>;
    case "replied":
      return <Text variant="footnote" tone="secondary">Replied in {status.seconds.toFixed(1)} s</Text>;
    case "signed-out":
      // A reply that asked to sign in follows the hint with its own words; a sign-in command's answer is the hint alone.
      return <Text variant="footnote" tone={tone}>Not signed in. {signInHint(name, tone)}{status.detail && ` ${ownLine(status.detail)}`}</Text>;
    case "timeout": // 15 s is the engine's default for a check, which the controller keeps
      return <Text variant="footnote" tone={tone}>Didn't reply within 15 s.</Text>;
    case "failed":
      // An agent that fails without printing anything has no line to show.
      return <Text variant="footnote" tone={tone}>{status.detail ? ownLine(status.detail) : "Didn't reply."}</Text>;
  }
}

function Agents({ snap, onChange }: { snap: SettingsSnapshot; onChange: (s: SettingsSnapshot) => void }) {
  const lib = snap.library;
  const installed = snap.harnesses.filter((h) => h.available);
  const [models, setModels] = useState<Record<string, string>>(lib?.models ?? {});
  // Agents whose check has had a result: while one is checked again, its button still reads "Check again".
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const results = snap.harnesses.filter((h) => h.status && h.status.kind !== "checking" && !checked.has(h.name));
  if (results.length) setChecked(new Set([...checked, ...results.map((h) => h.name)]));
  useEffect(() => {
    // Only the free checks, which read a sign-in and never ask the model: a prompt waits for Check.
    void api.checkAgents().then(onChange);
  }, []);
  if (!lib || !lib.exists) return <p className="note">Create your library first (General).</p>;
  const auto = snap.selectedHarness ? `Automatic (${harnessName(snap.selectedHarness)})` : "Automatic";
  // The agent that files and answers: the library's, or the one Automatic picks.
  const inUse = lib.harness === "auto" ? snap.selectedHarness : lib.harness;
  return (
    <>
      <Group
        label="Agent that files and answers"
        note="Avanzel runs your agent inside the library folder only: file tools for Claude Code, the workspace sandbox for Codex, no shell or web for OpenCode. Checking Claude Code or Codex reads their sign-in; other agents are asked one short question."
      >
        <div className="grow">
          <span className="fill">Use</span>
          <select aria-label="Agent" value={lib.harness} onChange={async (e) => onChange(await api.setLibrary({ harness: e.target.value }))}>
            <option value="auto">{auto}</option>
            {installed.map((h) => <option key={h.name} value={h.name}>{harnessName(h.name)}</option>)}
          </select>
        </div>
        {snap.harnesses.map((h) => {
          const status = h.available ? h.status : null;
          return (
            <div className="grow" key={h.name} role="group" aria-label={harnessName(h.name)}>
              <div className="fill two">
                <b>{harnessName(h.name)}</b>
                {/* "Installed" until a check says more; an experimental agent keeps saying so. VoiceOver hears each change. */}
                <div className="two" role="status">
                  {(!status || h.experimental) && <small>{h.available ? "Installed" : "Not installed"}{h.experimental ? ", experimental" : ""}</small>}
                  {status && <CheckStatus name={h.name} status={status} tone={h.name === inUse ? "danger" : "secondary"} />}
                </div>
              </div>
              {h.available && (
                <>
                  {/* Busy rather than disabled while it checks, so it keeps the focus. */}
                  <Button size="small" variant="secondary" busy={status?.kind === "checking"} onClick={async () => onChange(await api.checkAgent(h.name))}>
                    {checked.has(h.name) || (status && status.kind !== "checking") ? "Check again" : "Check"}
                  </Button>
                  <input
                    type="text"
                    aria-label={`${harnessName(h.name)} model`}
                    placeholder="Agent's default model"
                    value={models[h.name] ?? ""}
                    onChange={(e) => setModels({ ...models, [h.name]: e.target.value })}
                    onBlur={async () => onChange(await api.setLibrary({ models: Object.fromEntries(Object.entries(models).filter(([, v]) => v.trim())) }))}
                  />
                </>
              )}
            </div>
          );
        })}
      </Group>
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
      return <Agents {...props} />;
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
