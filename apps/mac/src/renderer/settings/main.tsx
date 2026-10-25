// The Settings window: a strip to drag it by, the toolbar that moves between its panes, and the pane under its
// heading. Each pane applies a change at once and draws the snapshot main sends back; a change main refuses is told in a
// Notice under the heading (`attempt`). The window keeps the reviews' open editor, their saves on the way and the failure
// of the last one, which outlast the pane.
import "@avanzel/ui/base.css";
import { Notice, Segmented, Stack, Text } from "@avanzel/ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SETTINGS_PANES, isSettingsPane, type AvanzelBridge, type SettingsPane, type SettingsSnapshot } from "../../shared/ipc.ts";
import { CHANGE_NOT_SAVED, notSavedLine, PANE_LABELS } from "./copy.ts";
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

/** A change main refused, as the Notice tells it. `id` is new for each, so a second refusal is told afresh, in the same words too. */
interface Problem {
  id: number;
  line: string;
}

/**
 * The Notice for a change main refused: "That change wasn't saved.", and why. It has no button: it is told, and goes with the
 * next change that works or the next pane. A pane can be long and the control that failed far below its heading, so the Notice
 * scrolls into view as it appears.
 */
function NotSaved({ line }: { line: string }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div ref={box}>
      <Notice tone="error" title={CHANGE_NOT_SAVED}>
        {line}
      </Notice>
    </div>
  );
}

function App() {
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [pane, setPane] = useState<SettingsPane>(startingPane);
  // The last change main refused, until a change works or another pane shows.
  const [problem, setProblem] = useState<Problem | null>(null);
  const refusals = useRef(0);
  // What a pane draws when its change worked: the snapshot main sent back. That change ends the problem a refused one left.
  const draw = useCallback((next: SettingsSnapshot) => {
    setSnap(next);
    setProblem(null);
  }, []);
  // A call to main that may be refused: a refusal is told in the Notice (it would otherwise be an unheard rejection), and the
  // call resolves undefined. Wherever the person is when it arrives, since a save can outlast the pane it was made on.
  const attempt = useCallback(async <T,>(run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch (error) {
      refusals.current += 1;
      setProblem({ id: refusals.current, line: notSavedLine(error) });
      return undefined;
    }
  }, []);
  // Kept here, not in the Reviews pane, which goes as another pane shows: what a review's editor holds, the saves on their
  // way, which nothing else may write over until they are written, and why the last one failed.
  const edits = useReviewEdits(snap?.library?.path ?? null, draw);
  // Whether a press of the pointer on the toolbar is under way: from its pointer-down to just after its release, which is where
  // the click that shows a pane comes. The press took the problem the person had seen away as it began (below); a refusal that
  // comes in during it, as a field's save does when the press takes the focus out of it, they haven't seen.
  const pressing = useRef(false);
  useEffect(() => {
    // The click follows the release in the same moment, so a timer runs after it. Any release ends the press, over its tab or not.
    const over = () => void setTimeout(() => (pressing.current = false));
    window.addEventListener("pointerup", over, true);
    window.addEventListener("pointercancel", over, true);
    return () => {
      window.removeEventListener("pointerup", over, true);
      window.removeEventListener("pointercancel", over, true);
    };
  }, []);
  // Showing a pane takes the problem with it: it was told of a change made on the pane that went. Not one that came in during the
  // press that shows it: that stays, and is told on this pane.
  const showPane = useCallback((next: SettingsPane) => {
    setPane(next);
    if (!pressing.current) setProblem(null);
  }, []);
  useEffect(() => {
    api.get().then(setSnap);
    return api.onChanged(setSnap);
  }, []);
  // An error card's Open Settings, while this window is open: a pane Settings doesn't have means General.
  useEffect(() => api.onShowPane((next) => showPane(isSettingsPane(next) ? next : "general")), [showPane]);
  if (!snap) return null;
  return (
    <div className="settings">
      <div className="settings-drag" />
      {/* A press on the toolbar is the person moving on: it takes away the problem they have seen, at once. */}
      <div
        className="settings-toolbar"
        onPointerDownCapture={() => {
          pressing.current = true;
          setProblem(null);
        }}
      >
        <Segmented label="Section" options={PANES} value={pane} onChange={showPane} />
      </div>
      {/* Keyed by its pane: a pane starts at its top, and the one left is unmounted, which ends whatever it had going,
          but for the reviews' edits, which the window keeps. */}
      <main key={pane} className="settings-pane">
        <Stack gap={20}>
          <Text variant="heading">{PANE_LABELS[pane]}</Text>
          {problem && <NotSaved key={problem.id} line={problem.line} />}
          <div>{paneContent(pane, { snap, onChange: draw, attempt }, edits)}</div>
        </Stack>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
