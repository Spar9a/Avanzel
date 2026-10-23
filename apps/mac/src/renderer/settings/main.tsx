// The Settings window: a strip to drag it by, the toolbar that moves between its panes, and the pane under its
// heading. Each pane applies a change at once and draws the snapshot main sends back. The pane not rebuilt on
// @avanzel/ui yet (Privacy) stays here, with its helpers, until its own task.
import { Segmented, Stack, Text } from "@avanzel/ui";
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SETTINGS_PANES, isSettingsPane, type AvanzelBridge, type SettingsPane, type SettingsSnapshot } from "../../shared/ipc.ts";
import { PANE_LABELS } from "./copy.ts";
import { Agents } from "./panes/Agents.tsx";
import { General } from "./panes/General.tsx";
import { Reviews } from "./panes/Reviews.tsx";
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

function Group({ label, children, note }: { label?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <>
      {label && <div className="glabel">{label}</div>}
      <div className="group">{children}</div>
      {note && <p className="note">{note}</p>}
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
      return props.snap.library?.exists ? <Reviews {...props} /> : <NoLibrary {...props} />;
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
