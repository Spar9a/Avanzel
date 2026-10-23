// The Settings window: a strip to drag it by, the toolbar that moves between its panes, and the pane under its
// heading. Each pane applies a change at once and draws the snapshot main sends back. The window keeps the reviews'
// open editor and their saves on the way, which outlast the pane.
import "@avanzel/ui/base.css";
import { Segmented, Stack, Text } from "@avanzel/ui";
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SETTINGS_PANES, isSettingsPane, type AvanzelBridge, type SettingsPane, type SettingsSnapshot } from "../../shared/ipc.ts";
import { PANE_LABELS } from "./copy.ts";
import { Agents } from "./panes/Agents.tsx";
import { General } from "./panes/General.tsx";
import { Privacy } from "./panes/Privacy.tsx";
import { Reviews, useReviewEdits, type ReviewEdits } from "./panes/Reviews.tsx";
import { Voice } from "./panes/Voice.tsx";
import { NoLibrary, type PaneProps } from "./parts.tsx";
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

/** The toolbar's choices: every pane, in order, by its name. */
const PANES = SETTINGS_PANES.map((pane) => ({ value: pane, label: PANE_LABELS[pane] }));

/**
 * What pane `pane` holds. A pane that needs a library is drawn here only while there is one, with NoLibrary in its place
 * otherwise (`snap.library?.exists ? <Pane {...props} /> : <NoLibrary {...props} />`), rather than returning early above
 * its own hooks. Voice and Privacy need none, and General shows the Notice itself, among its other groups. Reviews, and
 * General, which can turn the evening review on, are given the window's `edits`.
 */
function paneContent(pane: SettingsPane, props: PaneProps, edits: ReviewEdits): ReactNode {
  switch (pane) {
    case "general":
      return <General {...props} edits={edits} />;
    case "voice":
      return <Voice {...props} />;
    case "agents":
      return props.snap.library?.exists ? <Agents {...props} /> : <NoLibrary {...props} />;
    case "tasks":
      return props.snap.library?.exists ? <Reviews {...props} edits={edits} /> : <NoLibrary {...props} />;
    case "privacy":
      return <Privacy {...props} />;
  }
}

function App() {
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [pane, setPane] = useState<SettingsPane>(startingPane);
  // Kept here, not in the Reviews pane, which goes as another pane shows: what a review's editor holds, and the saves on
  // their way, which nothing else may write over until they are written.
  const edits = useReviewEdits(snap?.library?.path ?? null, setSnap);
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
      {/* Keyed by its pane: a pane starts at its top, and the one left is unmounted, which ends whatever it had going,
          but for the reviews' edits, which the window keeps. */}
      <main key={pane} className="settings-pane">
        <Stack gap={20}>
          <Text variant="heading">{PANE_LABELS[pane]}</Text>
          <div>{paneContent(pane, { snap, onChange: setSnap }, edits)}</div>
        </Stack>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
