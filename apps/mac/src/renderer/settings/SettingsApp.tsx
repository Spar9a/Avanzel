// Settings, the menu bar panel's third tab: a second row of tabs that moves between its panes (each pane needs no heading, its tab
// names it), the Notice for a call main refused, and the pane.
// Each pane applies a change at once and draws the snapshot main sends back; a call main refuses is told in a Notice in a row of its own
// above the pane (`attempt`), which stays in view however far the pane is scrolled, and which keeps the control that has the focus in
// view. Settings keeps the reviews' open editor, their saves on the way and the failure of the last one, and the drafts of the lists
// and their saves on the way, which outlast the pane.
import { Notice, TabPanel, Tabs, type TabOption } from "@avanzel/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SETTINGS_PANES, isSettingsPane, type AvanzelBridge, type SettingsPane, type SettingsSnapshot } from "../../shared/ipc.ts";
import { PANE_LABELS, refusedCall } from "./copy.ts";
import { useLibraryDrafts, type LibraryDrafts } from "./lines-field.tsx";
import { Agents } from "./panes/Agents.tsx";
import { Dictations, useDictationListing, type DictationListing } from "./panes/Dictations.tsx";
import { General } from "./panes/General.tsx";
import { Privacy } from "./panes/Privacy.tsx";
import { Reviews, useReviewEdits, type ReviewEdits } from "./panes/Reviews.tsx";
import { ShortcutsPane } from "./panes/Shortcuts.tsx";
import { Voice } from "./panes/Voice.tsx";
import { NoLibrary, type PaneProps } from "./parts.tsx";
import "./styles.css";

declare global {
  interface Window { avanzel: AvanzelBridge }
}

/** The tabs: every pane, in order, by its name. */
const PANES: readonly TabOption<SettingsPane>[] = SETTINGS_PANES.map((pane) => ({ value: pane, label: PANE_LABELS[pane] }));

/** How far above the pane's bottom edge the control that has the focus is kept, in px: its field's box and ring, and some air. */
const FOCUS_ROOM = 16;

/**
 * What pane `pane` holds. A pane that needs a library is drawn here only while there is one, with NoLibrary in its place
 * otherwise (`snap.library?.exists ? <Pane {...props} /> : <NoLibrary {...props} />`), rather than returning early above
 * its own hooks. Voice, Shortcuts, Dictation (the history is the app's own) and Privacy need none, and General shows the Notice itself,
 * among its other groups. Reviews, and General, which can turn the evening review on, are given Settings' `edits`.
 */
function paneContent(pane: SettingsPane, props: PaneProps, edits: ReviewEdits, drafts: LibraryDrafts, listing: DictationListing): ReactNode {
  switch (pane) {
    case "general":
      return <General {...props} edits={edits} />;
    case "voice":
      return <Voice {...props} drafts={drafts} />;
    case "shortcuts":
      return <ShortcutsPane {...props} />;
    case "dictations":
      return <Dictations {...props} listing={listing} />;
    case "agents":
      return props.snap.library?.exists ? <Agents {...props} /> : <NoLibrary {...props} />;
    case "tasks":
      return props.snap.library?.exists ? <Reviews {...props} edits={edits} /> : <NoLibrary {...props} />;
    case "privacy":
      return <Privacy {...props} drafts={drafts} />;
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

/** `startPane`: the pane to open on, when something asked for one before Settings showed; else General. */
export function SettingsApp({ startPane }: { startPane?: SettingsPane }) {
  const api = window.avanzel.settings;
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [pane, setPane] = useState<SettingsPane>(() => startPane ?? "general");
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
  // Kept here, not in the Reviews pane: what a review's editor holds, the saves on their way, which nothing else may write over until
  // they are written, and why the last one failed.
  const edits = useReviewEdits(snap?.library?.path ?? null, draw);
  // Kept here too: the drafts of the lists (the Dictionary on Voice and the skip lists on Privacy) and their saves on the way, which a
  // return to their pane must find as they were.
  const drafts = useLibraryDrafts(snap, draw, attempt);
  // And the dictation history, listed as Settings opens: the Dictation pane has its whole height the moment it shows.
  const listing = useDictationListing();
  // Whether a press of the pointer on the tabs is under way: from its pointer-down to just after its release, which is where
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
  }, [api]);
  // An error card's Open Settings, while Settings is up: a pane Settings doesn't have means General.
  useEffect(() => api.onShowPane((next) => showPane(isSettingsPane(next) ? next : "general")), [api, showPane]);
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
  const props: PaneProps = { snap, onChange: draw, attempt };
  // A press on the tabs is the person moving on: it takes away the problem they have seen, at once.
  const movingOn = () => {
    pressing.current = true;
    setProblem(null);
  };
  return (
    <div className="settings">
      <div className="settings-toolbar" onPointerDownCapture={movingOn}>
        <Tabs level="secondary" label="Settings" controls="settings-pane" options={PANES} value={pane} onChange={showPane} />
      </div>
      {/* The problem's row is always here, with no height while there is none, so the pane keeps its place under the tabs. */}
      <div className="settings-problem">
        {problem && (
          <div className="settings-problem-box">
            <Refused key={problem.id} title={problem.title} line={problem.line} />
          </div>
        )}
      </div>
      {/* The panes slide along as their tabs change, each scrolling on its own, and each kept once it has shown. */}
      <main ref={scrolls} className="settings-pane">
        <TabPanel
          id="settings-pane"
          value={pane}
          height="fill"
          pages={SETTINGS_PANES.map((each) => ({
            value: each,
            content: <div className="settings-page">{paneContent(each, props, edits, drafts, listing)}</div>,
          }))}
        />
      </main>
    </div>
  );
}
