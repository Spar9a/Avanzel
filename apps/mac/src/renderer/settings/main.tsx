// The Settings window: a strip to drag it by, the toolbar that moves between its panes, the Notice for a call main refused,
// and the pane under its heading. Each pane applies a change at once and draws the snapshot main sends back; a call main
// refuses is told in a Notice in a row of its own above the pane (`attempt`), which stays in view however far the pane is
// scrolled, and which keeps the control that has the focus in view. The window keeps the reviews' open editor, their saves on
// the way and the failure of the last one, and the drafts of Voice's fields of lines and their saves on the way, which outlast the pane.
import "@avanzel/ui/base.css";
import { Notice, Segmented, Stack, Text } from "@avanzel/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SETTINGS_PANES, isSettingsPane, type AvanzelBridge, type SettingsPane, type SettingsSnapshot } from "../../shared/ipc.ts";
import { PANE_LABELS, refusedCall } from "./copy.ts";
import { Agents } from "./panes/Agents.tsx";
import { Dictations } from "./panes/Dictations.tsx";
import { General } from "./panes/General.tsx";
import { Privacy } from "./panes/Privacy.tsx";
import { Reviews, useReviewEdits, type ReviewEdits } from "./panes/Reviews.tsx";
import { useVoiceDrafts, Voice, type VoiceDrafts } from "./panes/Voice.tsx";
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

/** How far above the pane's bottom edge the control that has the focus is kept, in px: its field's box and ring, and some air. */
const FOCUS_ROOM = 16;

/**
 * What pane `pane` holds. A pane that needs a library is drawn here only while there is one, with NoLibrary in its place
 * otherwise (`snap.library?.exists ? <Pane {...props} /> : <NoLibrary {...props} />`), rather than returning early above
 * its own hooks. Voice, Dictations (the history is the app's own) and Privacy need none, and General shows the Notice itself, among its other groups. Reviews, and
 * General, which can turn the evening review on, are given the window's `edits`.
 */
function paneContent(pane: SettingsPane, props: PaneProps, edits: ReviewEdits, drafts: VoiceDrafts): ReactNode {
  switch (pane) {
    case "general":
      return <General {...props} edits={edits} />;
    case "voice":
      return <Voice {...props} drafts={drafts} />;
    case "dictations":
      return <Dictations />;
    case "agents":
      return props.snap.library?.exists ? <Agents {...props} /> : <NoLibrary {...props} />;
    case "tasks":
      return props.snap.library?.exists ? <Reviews {...props} edits={edits} /> : <NoLibrary {...props} />;
    case "privacy":
      return <Privacy {...props} />;
  }
}

/** A call main refused, as the Notice tells it. `id` is new for each, so a second refusal is told afresh, in the same words too. */
interface Problem {
  id: number;
  title: string;
  line: string;
}

/**
 * The Notice for a call main refused (`refusedCall`): what happened, and why. It has no button: it is told, and goes with the
 * next change that works or the next pane. It stands outside the pane, which scrolls: a pane can be long and the control that
 * failed far down it, and a Notice in the pane would be out of sight or, brought into sight, would take the control out of it.
 * Its row takes its height from the pane instead, which App makes up for (see where it keeps the focused control in view).
 */
function Refused({ title, line }: { title: string; line: string }): ReactNode {
  return (
    <Notice tone="error" title={title}>
      {line}
    </Notice>
  );
}

function App() {
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [pane, setPane] = useState<SettingsPane>(startingPane);
  // The last call main refused, until a change works or another pane shows.
  const [problem, setProblem] = useState<Problem | null>(null);
  const refusals = useRef(0);
  // What a pane draws when its change worked: the snapshot main sent back. That change ends the problem a refused one left.
  const draw = useCallback((next: SettingsSnapshot) => {
    setSnap(next);
    setProblem(null);
  }, []);
  // A call to main that may be refused: a refusal is told in the Notice (it would otherwise be an unheard rejection), and the
  // call resolves undefined. Wherever the person is when it arrives, since a save can outlast the pane it was made on. Any error
  // is told so, a bug of the app's own among them, and so it is logged too: the Notice can't tell which it is. A call that saves
  // no setting passes its own `title` (a review that didn't start, an agent that couldn't be checked).
  const attempt = useCallback(async <T,>(run: () => Promise<T>, title?: string): Promise<T | undefined> => {
    try {
      return await run();
    } catch (error) {
      console.error("settings", error);
      refusals.current += 1;
      const told = refusedCall(error, title);
      setProblem({ id: refusals.current, title: told.title, line: told.body });
      return undefined;
    }
  }, []);
  // Kept here, not in the Reviews pane, which goes as another pane shows: what a review's editor holds, the saves on their
  // way, which nothing else may write over until they are written, and why the last one failed.
  const edits = useReviewEdits(snap?.library?.path ?? null, draw);
  // Kept here too: the drafts of Voice's fields of lines (the Dictionary and the skip lists) and their saves on the way, which a
  // return to Voice must find as they were.
  const drafts = useVoiceDrafts(snap, draw, attempt);
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
  // The problem's row takes its height from the pane, which can leave the control the person was working at, the one with the
  // focus, below the pane's fold. As the row appears (before it is painted) that control is kept in view: the pane is scrolled
  // just enough to show it, and never to the Notice. What has the focus in a field is the input inside it, whose box, border and
  // ring reach below it, so a little room is left under whatever has the focus.
  const scrolls = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (!problem || !focused) return;
    focused.scrollIntoView({ block: "nearest" });
    const scroller = scrolls.current;
    if (!scroller?.contains(focused)) return;
    const short = focused.getBoundingClientRect().bottom + FOCUS_ROOM - scroller.getBoundingClientRect().bottom;
    if (short > 0) scroller.scrollTop += short; // the pane's end is as far as it goes
  }, [problem?.id]);
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
      {/* The problem's row is always here, with no height while there is none, so the pane keeps its place in the window's rows. */}
      <div className="settings-problem">
        {problem && (
          <div className="settings-problem-box">
            <Refused key={problem.id} title={problem.title} line={problem.line} />
          </div>
        )}
      </div>
      {/* Keyed by its pane: a pane starts at its top, and the one left is unmounted, which ends whatever it had going,
          but for the reviews' edits and Voice's drafts, which the window keeps. */}
      <main key={pane} ref={scrolls} className="settings-pane">
        <Stack gap={20}>
          <Text variant="heading">{PANE_LABELS[pane]}</Text>
          <div>{paneContent(pane, { snap, onChange: draw, attempt }, edits, drafts)}</div>
        </Stack>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
