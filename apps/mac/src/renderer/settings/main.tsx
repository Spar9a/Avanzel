import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AvanzelBridge, SettingsSnapshot, Shortcuts, TaskInfo } from "../../shared/ipc.ts";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import "../common/mac.css";
import "./styles.css";

declare global {
  interface Window { avanzel: AvanzelBridge }
}

const api = window.avanzel.settings;

type Pane = "general" | "voice" | "agents" | "tasks" | "tools" | "privacy";

const ICONS: Record<Pane, { bg: string; path: ReactNode; label: string }> = {
  general: { bg: "#8e8e93", label: "General", path: <><circle cx="7" cy="7" r="2.2" /><path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2M3.1 3.1l1.4 1.4M9.5 9.5l1.4 1.4M3.1 10.9l1.4-1.4M9.5 4.5l1.4-1.4" /></> },
  voice: { bg: "#ff375f", label: "Voice", path: <><rect x="5" y="1.5" width="4" height="7" rx="2" /><path d="M3 7a4 4 0 0 0 8 0M7 11v1.8" /></> },
  agents: { bg: "#5856d6", label: "Agents", path: <path d="M7 1.8 8.2 5.8 12.2 7 8.2 8.2 7 12.2 5.8 8.2 1.8 7 5.8 5.8Z" /> },
  tasks: { bg: "#af52de", label: "Shadow tasks", path: <><circle cx="7" cy="7" r="5" /><path d="M7 4v3.2l2.1 1.4" /></> },
  tools: { bg: "#30b0c7", label: "Tools & MCP", path: <path d="M5 1.8v3M9 1.8v3M3.5 4.8h7v2.4a3.5 3.5 0 0 1-7 0ZM7 10.7v1.8" /> },
  privacy: { bg: "#007aff", label: "Privacy", path: <path d="M7 1.6 11.6 3.4v3.4c0 2.8-2 4.6-4.6 5.6C4.4 11.4 2.4 9.6 2.4 6.8V3.4Z" /> },
};

const HARNESS_NAMES: Record<string, string> = {
  claude: "Claude Code", codex: "Codex", opencode: "OpenCode", "cursor-agent": "Cursor Agent", gemini: "Gemini CLI",
};
const harnessName = (name: string) => HARNESS_NAMES[name] ?? name;

function Icon({ pane }: { pane: Pane }) {
  return <span className="ico" style={{ ["--bg" as string]: ICONS[pane].bg }}><svg viewBox="0 0 14 14">{ICONS[pane].path}</svg></span>;
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <input type="checkbox" role="switch" className="sw" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
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

function ShortcutField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [recording, setRecording] = useState(false);
  return (
    <button
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

function Welcome({ snap, onChange }: { snap: SettingsSnapshot; onChange: (s: SettingsSnapshot) => void }) {
  const [path, setPath] = useState(snap.app.libraryPath ?? snap.defaultLibraryPath);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="welcome">
      <h2>Welcome to Avanzel</h2>
      <p>
        Avanzel keeps your goals, ideas, problems, memories, people and topics as plain Markdown in a folder you own.
        Your own agent files every thought there; your voice is turned into text on this Mac and never leaves it.
      </p>
      <Group label="Your library">
        <div className="grow">
          <div className="fill pathrow">
            <input type="text" aria-label="Library folder" value={path} onChange={(e) => setPath(e.target.value)} />
          </div>
          <button className="btn" onClick={async () => onChange(await api.chooseLibrary())}>Choose existing…</button>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                setError(null);
                onChange(await api.createLibrary(path));
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (\w+Error: )?/, "") : String(e));
              }
            }}
          >
            Create library
          </button>
        </div>
      </Group>
      {error && <p className="note problem">{error}</p>}
      <p className="note">A new folder gets the shelves, an AGENTS.md your agent reads, and git history so every change can be undone. Open it in Obsidian any time.</p>
    </div>
  );
}

function General({ snap, onChange }: { snap: SettingsSnapshot; onChange: (s: SettingsSnapshot) => void }) {
  const lib = snap.library;
  if (!lib || !lib.exists) return <Welcome snap={snap} onChange={onChange} />;
  const pages = Object.values(lib.shelves).reduce((a, b) => a + b, 0);
  return (
    <>
      <Group label="Library">
        <div className="grow">
          <span className="fill two"><b>Location</b><span className="path">{lib.path}</span></span>
          <button className="btn" onClick={() => api.openLibrary()}>Open</button>
          <button className="btn" onClick={async () => onChange(await api.chooseLibrary())}>Change…</button>
        </div>
        <div className="grow">
          <span className="fill two">
            <b>{lib.inbox === 0 ? "Inbox is empty" : lib.inbox === 1 ? "1 note in the inbox" : `${lib.inbox} notes in the inbox`}</b>
            <small>{pages} pages: {Object.entries(lib.shelves).map(([shelf, n]) => `${n} ${shelf}`).join(", ")}</small>
          </span>
        </div>
        <div className="grow">
          <span className="fill two"><b>Version history</b><small>{lib.isGit ? "On: every change is a git commit you can undo." : "Off: this folder is not a git repository."}</small></span>
        </div>
      </Group>
      <Group label="After you speak" note="The evening review is a shadow task; change its time under Shadow tasks.">
        <div className="grow">
          <span className="fill">File the note</span>
          <span className="seg" role="radiogroup" aria-label="File the note">
            <button className={snap.app.fileMode === "now" ? "on" : ""} onClick={async () => onChange(await api.setApp({ fileMode: "now" }))}>Right away</button>
            <button className={snap.app.fileMode === "evening" ? "on" : ""} onClick={async () => onChange(await api.setApp({ fileMode: "evening" }))}>At the evening review</button>
          </span>
        </div>
      </Group>
      <Group label="Startup">
        <div className="grow">
          <span className="fill">Open Avanzel when you log in</span>
          <Toggle label="Open at login" checked={snap.app.launchAtLogin} onChange={async (v) => onChange(await api.setApp({ launchAtLogin: v }))} />
        </div>
      </Group>
    </>
  );
}

function Voice({ snap, onChange }: { snap: SettingsSnapshot; onChange: (s: SettingsSnapshot) => void }) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((all) => setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId !== "default")));
  }, []);
  const rows: [keyof Shortcuts, string][] = [
    ["dictate", "Record a thought"],
    ["capture", "Capture screen with a comment"],
    ["type", "Type a thought"],
    ["ask", "Ask your library"],
  ];
  const model = snap.model;
  return (
    <>
      <Group label="Shortcuts" note="Press a shortcut once to start and again to stop. Esc cancels while the capsule is listening.">
        {rows.map(([key, label]) => (
          <div className="grow" key={key}>
            <span className="fill two">{label}{snap.shortcutProblems[key] && <span className="problem">{snap.shortcutProblems[key]}</span>}</span>
            <ShortcutField label={label} value={snap.app.shortcuts[key]} onChange={async (v) => onChange(await api.setApp({ shortcuts: { ...snap.app.shortcuts, [key]: v } }))} />
          </div>
        ))}
      </Group>
      <Group label="Speech model" note="Speech models run on this Mac. Your voice never leaves it.">
        <div className="grow">
          <span className="fill two"><b>Parakeet v3</b><small>25 European languages, including English, Russian and Ukrainian</small></span>
          {model.kind === "ready" && <span className="status-ok">Ready</span>}
          {model.kind === "missing" && <button className="btn primary" onClick={async () => onChange(await api.downloadModel())}>Download (670 MB)</button>}
          {model.kind === "downloading" && (
            <>
              <span className="bar" aria-label="Download progress"><i style={{ width: `${model.totalBytes ? (100 * model.receivedBytes) / model.totalBytes : 0}%` }} /></span>
              <span className="sub">{Math.round(model.receivedBytes / 1e6)} of {Math.round(model.totalBytes / 1e6)} MB</span>
            </>
          )}
          {model.kind === "error" && (
            <>
              <span className="status-bad">{model.message}</span>
              <button className="btn" onClick={async () => onChange(await api.downloadModel())}>Try again</button>
            </>
          )}
        </div>
      </Group>
      <Group label="Microphone">
        <div className="grow">
          <span className="fill">Input</span>
          <select aria-label="Microphone" value={snap.app.microphoneId ?? ""} onChange={async (e) => onChange(await api.setApp({ microphoneId: e.target.value || null }))}>
            <option value="">System default</option>
            {mics.map((m, i) => <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}
          </select>
        </div>
      </Group>
    </>
  );
}

function Agents({ snap, onChange }: { snap: SettingsSnapshot; onChange: (s: SettingsSnapshot) => void }) {
  const lib = snap.library;
  const installed = snap.harnesses.filter((h) => h.available);
  const [models, setModels] = useState<Record<string, string>>(lib?.models ?? {});
  if (!lib || !lib.exists) return <p className="note">Create your library first (General).</p>;
  const auto = snap.selectedHarness ? `Automatic (${harnessName(snap.selectedHarness)})` : "Automatic";
  return (
    <>
      <Group label="Agent that files and answers" note="Avanzel runs your agent inside the library folder only: file tools for Claude Code, the workspace sandbox for Codex, no shell or web for OpenCode.">
        <div className="grow">
          <span className="fill">Use</span>
          <select aria-label="Agent" value={lib.harness} onChange={async (e) => onChange(await api.setLibrary({ harness: e.target.value }))}>
            <option value="auto">{auto}</option>
            {installed.map((h) => <option key={h.name} value={h.name}>{harnessName(h.name)}</option>)}
          </select>
        </div>
        {snap.harnesses.map((h) => (
          <div className="grow" key={h.name}>
            <span className="fill two"><b>{harnessName(h.name)}</b><small>{h.available ? "Installed" : "Not installed"}{h.experimental ? ", experimental" : ""}</small></span>
            {h.available && (
              <input
                type="text"
                aria-label={`${harnessName(h.name)} model`}
                placeholder="Agent's default model"
                value={models[h.name] ?? ""}
                onChange={(e) => setModels({ ...models, [h.name]: e.target.value })}
                onBlur={async () => onChange(await api.setLibrary({ models: Object.fromEntries(Object.entries(models).filter(([, v]) => v.trim())) }))}
              />
            )}
          </div>
        ))}
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
    <Group note="Tasks are files in your library's tasks/ folder. Avanzel runs them on this Mac with your agent; if the Mac is asleep at the time, the task runs once when it wakes.">
      {snap.tasks.map((task) => <TaskRow key={task.id} task={task} snap={snap} onChange={onChange} />)}
    </Group>
  );
}

function Tools() {
  const tools = [["Calendar", "#ff3b30"], ["Reminders", "#ff9500"], ["Mail", "#007aff"], ["Contacts", "#8e8e93"], ["Files", "#0a84ff"]];
  return (
    <Group
      label="Coming next"
      note="Shadow tasks will be able to use the Mac's apps and the MCP servers your agents already have. Each tool stays off until you switch it on for a task, and anything that would change something outside your library waits for your OK."
    >
      {tools.map(([name, color]) => (
        <div className="grow" key={name}>
          <span className="app-ico" style={{ ["--bg" as string]: color }}><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" /></svg></span>
          <span className="fill">{name}</span>
          <Toggle label={`${name} (not available yet)`} checked={false} disabled onChange={() => undefined} />
        </div>
      ))}
    </Group>
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
      <Group label="Permissions">
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

function App() {
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [pane, setPane] = useState<Pane>("general");
  useEffect(() => {
    api.get().then(setSnap);
    return api.onChanged(setSnap);
  }, []);
  if (!snap) return null;
  const panes = Object.keys(ICONS) as Pane[];
  const props = { snap, onChange: setSnap };
  return (
    <div className="window">
      <aside className="sidebar">
        <nav aria-label="Settings sections">
          {panes.map((p) => (
            <button key={p} className={`ni${p === pane ? " on" : ""}`} aria-current={p === pane ? "page" : undefined} onClick={() => setPane(p)}>
              <Icon pane={p} />{ICONS[p].label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        <div className="tb"><h1>{ICONS[pane].label}</h1></div>
        {pane === "general" && <General {...props} />}
        {pane === "voice" && <Voice {...props} />}
        {pane === "agents" && <Agents {...props} />}
        {pane === "tasks" && <Tasks {...props} />}
        {pane === "tools" && <Tools />}
        {pane === "privacy" && <Privacy {...props} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
