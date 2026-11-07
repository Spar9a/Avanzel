// Settings: the toolbar that moves between its panes, the Notice for a call main refused, and the pane. In its own window it has the
// pane's name in a strip to drag it by, an icon toolbar, and takes the height its pane needs, within the screen, opening on the pane it
// showed last; in the menu bar panel (`embedded`) the panes are a second row of tabs and the pane needs no heading, its tab names it.
// Each pane applies a change at once and draws the snapshot main sends back; a call main refuses is told in a Notice in a row of its own
// above the pane (`attempt`), which stays in view however far the pane is scrolled, and which keeps the control that has the focus in
// view. Settings keeps the reviews' open editor, their saves on the way and the failure of the last one, and the drafts of the fields
// of lines and their saves on the way, which outlast the pane.
import { Notice, TabPanel, Tabs, Text, Toolbar, type IconName, type ToolbarItem } from "@avanzel/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { EmbeddedSettings, NoLibrary, type PaneProps } from "./parts.tsx";
import "./styles.css";

declare global {
  interface Window { avanzel: AvanzelBridge }
}

/** Where the window keeps the pane it showed last. */
const LAST_PANE = "settings-pane";

/** The pane the window opens on: the one its address names (?pane=voice), if Settings has it; else the one it showed last; else General. */
function startingPane(): SettingsPane {
  const named = new URLSearchParams(location.search).get("pane");
  if (isSettingsPane(named)) return named;
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_PANE);
  } catch {
    // storage may be unavailable: General, then
  }
  return isSettingsPane(last) ? last : "general";
}

/** Each pane's icon on the toolbar. */
const PANE_ICONS: Readonly<Record<SettingsPane, IconName>> = {
  general: "settings",
  voice: "mic",
  shortcuts: "type",
  dictations: "waveform",
  agents: "person",
  tasks: "clock",
  privacy: "lock",
};

/** The toolbar's items: every pane, in order, by its name. */
const PANES: readonly ToolbarItem<SettingsPane>[] = SETTINGS_PANES.map((pane) => ({ value: pane, label: PANE_LABELS[pane], icon: PANE_ICONS[pane] }));

/** How far above the pane's bottom edge the control that has the focus is kept, in px: its field's box and ring, and some air. */
const FOCUS_ROOM = 16;

/**
 * What pane `pane` holds. A pane that needs a library is drawn here only while there is one, with NoLibrary in its place
 * otherwise (`snap.library?.exists ? <Pane {...props} /> : <NoLibrary {...props} />`), rather than returning early above
 * its own hooks. Voice, Shortcuts, Dictation (the history is the app's own) and Privacy need none, and General shows the Notice itself,
 * among its other groups. Reviews, and General, which can turn the evening review on, are given the window's `edits`.
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

/**
 * Keeps the window as high as what it shows needs: the rows above the pane, the pane's own padding, and what the pane holds. None of those
 * depends on the window's height, so it takes one move. Told again whenever one changes, which is a new pane, a Notice's row, or a pane's own contents
 * changing, such as a list that opens. It moves at once: macOS's animated resize holds the main process for as long as it runs, 230 to 350 ms for a
 * pane, with the new pane already showing, which reads as lag, and the owner took it out. Not in the menu bar panel (`on` false), which has its own size.
 */
function useWindowFit(on: boolean, pane: SettingsPane, ready: boolean, scrolls: RefObject<HTMLElement | null>): { holds: RefObject<HTMLDivElement | null>; problemRow: RefObject<HTMLDivElement | null> } {
  const holds = useRef<HTMLDivElement>(null);
  const problemRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrolls.current;
    const inner = holds.current;
    const row = problemRow.current;
    if (!on || !scroller || !inner || !row) return;
    const api = window.avanzel.settings;
    const observer = new ResizeObserver(() => {
      const { paddingTop, paddingBottom } = getComputedStyle(scroller);
      api.fit(Math.ceil(scroller.getBoundingClientRect().top + parseFloat(paddingTop) + parseFloat(paddingBottom) + inner.getBoundingClientRect().height));
    });
    observer.observe(inner);
    observer.observe(row);
    return () => observer.disconnect();
  }, [on, pane, ready]);
  return { holds, problemRow };
}

/**
 * Tells the window the colour the page is drawn on, now and when the appearance changes. The window and the page are two processes, so when the window
 * grows, what it grew by is the window's own for the frame before the page draws there, and left alone that is white, a bright block in dark mode.
 * Not in the menu bar panel (`on` false), which isn't Settings' window.
 */
function useWindowSurface(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const api = window.avanzel.settings;
    const tell = () => api.surface(getComputedStyle(document.body).backgroundColor);
    tell();
    const changes = [matchMedia("(prefers-color-scheme: dark)"), matchMedia("(prefers-contrast: more)")];
    for (const change of changes) change.addEventListener("change", tell);
    return () => {
      for (const change of changes) change.removeEventListener("change", tell);
    };
  }, [on]);
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

/** `embedded`: in the menu bar panel. `startPane`: the pane to open on, when something asked for one before Settings showed. */
export function SettingsApp({ embedded = false, startPane }: { embedded?: boolean; startPane?: SettingsPane }) {
  const api = window.avanzel.settings;
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [pane, setPane] = useState<SettingsPane>(() => startPane ?? startingPane());
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
  // Kept here too: the drafts of the fields of lines (the Dictionary on Voice and the skip lists on Privacy) and their saves on the way,
  // which a return to their pane must find as they were.
  const drafts = useLibraryDrafts(snap, draw, attempt);
  // And the dictation history, listed as Settings opens: the Dictation pane has its whole height the moment it shows.
  const listing = useDictationListing();
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
  }, [api]);
  // An error card's Open Settings, while this window is open: a pane Settings doesn't have means General.
  useEffect(() => api.onShowPane((next) => showPane(isSettingsPane(next) ? next : "general")), [api, showPane]);
  // In its own window, the window's title follows its pane, as a macOS settings window's does, and the next window opens where this one is.
  useEffect(() => {
    if (embedded) return;
    document.title = PANE_LABELS[pane];
    try {
      localStorage.setItem(LAST_PANE, pane);
    } catch {
      // storage may be unavailable: the next window opens on General
    }
  }, [embedded, pane]);
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
  const { holds, problemRow } = useWindowFit(!embedded, pane, snap !== null, scrolls);
  useWindowSurface(!embedded);
  if (!snap) return null;
  const props: PaneProps = { snap, onChange: draw, attempt };
  // A press on the toolbar is the person moving on: it takes away the problem they have seen, at once.
  const movingOn = () => {
    pressing.current = true;
    setProblem(null);
  };
  // The problem's row is always here, with no height while there is none, so the pane keeps its place in the window's rows.
  const problemBox = (
    <div ref={problemRow} className="settings-problem">
      {problem && (
        <div className="settings-problem-box">
          <Refused key={problem.id} title={problem.title} line={problem.line} />
        </div>
      )}
    </div>
  );
  if (embedded) {
    return (
      <EmbeddedSettings.Provider value>
        <div className="settings" data-embedded="">
          <div className="settings-toolbar" onPointerDownCapture={movingOn}>
            <Tabs level="secondary" label="Settings" controls="settings-pane" options={PANES} value={pane} onChange={showPane} />
          </div>
          {problemBox}
          {/* In the panel the panes slide along as their tabs change, each scrolling on its own, and each kept once it has shown. */}
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
      </EmbeddedSettings.Provider>
    );
  }
  return (
    <EmbeddedSettings.Provider value={false}>
      <div className="settings">
        {/* The window's title, as macOS would draw it, and what the window is dragged by. It is also the page's heading, over the groups' own (h3, as setup's),
            and VoiceOver hears it change, since nothing else says a pane has come: the focus stays on the toolbar. */}
        <div className="settings-drag" aria-live="polite">
          <Text variant="headline" as="h2">{PANE_LABELS[pane]}</Text>
        </div>
        <div onPointerDownCapture={movingOn}>
          <Toolbar label="Section" items={PANES} value={pane} onChange={showPane} />
        </div>
        {problemBox}
        {/* Keyed by its pane: a pane starts at its top, and the one left is unmounted, which ends whatever it had going,
            but for the reviews' edits and the fields' drafts, which the window keeps. */}
        <main key={pane} ref={scrolls} className="settings-pane">
          <div ref={holds} className="settings-pane-holds">{paneContent(pane, props, edits, drafts, listing)}</div>
        </main>
      </div>
    </EmbeddedSettings.Provider>
  );
}
