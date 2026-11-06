// The panel under the menu bar icon: three tabs, side by side, that slide along as the tab changes. Capture starts something new
// over a quiet moving aura, Library runs the reviews and lists the library's pages (sorted and filtered as the person picks), each
// folding open in place, and Settings is Settings. It arranges @avanzel/ui's parts and paints nothing of its own.
import "@avanzel/ui/base.css";
import { ActionTile, Aura, Button, CapsuleBar, Notice, PageRow, Progress, Row, SHELF_NAMES, SHELVES, Stack, TabPanel, Tabs, Text, type Shelf } from "@avanzel/ui";
import { ListeningControls } from "../capsule/listening.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import { isSettingsPane, type AvanzelBridge, type PanelPage, type PanelReview, type PanelSnapshot, type PanelTab, type SettingsPane, type Shortcuts } from "../../shared/ipc.ts";
import { SettingsApp } from "../settings/SettingsApp.tsx";
import { filterLabel, inboxLine, pageDay, pagesLabel, reviewOutcome, reviewState, SORTS, sortLabel, sortPages, type PageFilter, type PageSort } from "./copy.ts";
import "./styles.css";

declare global {
  interface Window { avanzel: AvanzelBridge }
}

const api = window.avanzel.panel;
const act = (action: string) => api.act(action);

const isShelf = (value: string | null): value is Shelf => value !== null && (SHELVES as readonly string[]).includes(value);

/** A shortcut as macOS writes it, when it is set and registered. */
function keyOf(snap: PanelSnapshot, key: keyof Shortcuts): string | undefined {
  const accelerator = snap.shortcuts[key];
  if (!accelerator || snap.unregisteredShortcuts.includes(key)) return undefined;
  return prettyAccelerator(accelerator);
}

const BARS = 16;

/** The voice as the capsule hears it, for the panel's own bar: the newest level on the right. */
function useLevels(listening: boolean): number[] {
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.08));
  useEffect(() => {
    if (!listening) return;
    return api.onLevel((level) => setLevels((prev) => [...prev.slice(1), Math.max(0.08, level)]));
  }, [listening]);
  return levels;
}

/** The wave of a paused recording: lying flat. */
const FLAT: readonly number[] = Array(BARS).fill(0.08);

/** How long a recording has run, "0:07", counted from when it began, each second; standing still while it is paused. */
function useElapsed(startedAt: number | null, pausedAt: number | null = null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null || pausedAt !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [startedAt, pausedAt]);
  if (startedAt === null) return "";
  const seconds = Math.max(0, Math.floor(((pausedAt ?? now) - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const LISTENING_LINES: Record<NonNullable<PanelSnapshot["listening"]>["mode"], string> = {
  dictate: "Recording a thought",
  comment: "Recording a comment on the screen",
  call: "Taking notes on a call",
};

/**
 * The recording that listens now, as the capsule shows it: its bar, with Zel listening, the voice and the time, and under it what
 * the capsule offers for it: when it is filed, Stop and Cancel. A dictation into another app ends only by its own key, so it has neither.
 */
function Listening({ snap, listening }: { snap: PanelSnapshot; listening: NonNullable<PanelSnapshot["listening"]> }) {
  const levels = useLevels(listening.pausedAt === null);
  const time = useElapsed(listening.startedAt, listening.pausedAt);
  return (
    <Stack gap={10}>
      <CapsuleBar mood="listening" levels={listening.pausedAt ? FLAT : levels} time={time}>
        {listening.pausedAt ? "Paused" : LISTENING_LINES[listening.mode]}
      </CapsuleBar>
      {listening.mode === "call" ? (
        <Row gap={8} justify="end">
          <Button size="small" variant="primary" icon="stop" onClick={() => act("call-notes-stop")}>Stop taking notes</Button>
        </Row>
      ) : listening.ownKey ? (
        <Text variant="footnote" tone="secondary">The key you dictate with ends it.</Text>
      ) : (
        <Row gap={8} justify="end">
          <ListeningControls
            fileMode={listening.fileMode}
            review={listening.review}
            paused={listening.pausedAt !== null}
            onFileMode={(next) => act(`file-mode:${next}`)}
            onCancel={() => act("cancel-recording")}
            onPause={() => act("pause-recording")}
            onStop={() => act("stop-recording")}
          />
        </Row>
      )}
    </Stack>
  );
}

function Capture({ snap }: { snap: PanelSnapshot }) {
  // Capture the screen asks how first: the whole screen, or a part picked with macOS's crosshair.
  const [askArea, setAskArea] = useState(false);
  const capture = (action: "capture" | "capture-region") => {
    setAskArea(false);
    act(action);
  };
  return (
    <Aura fill mood={snap.listening ? "listening" : "calm"}>
      <div className="panel-pad">
        <Stack gap={16}>
          {!snap.libraryReady && (
            <Notice
              tone="info"
              title={snap.libraryProblem ?? "Avanzel has no library yet."}
              actions={<Button variant="primary" size="small" onClick={() => act("setup")}>Set up Avanzel…</Button>}
            >
              Thoughts wait in the inbox until there is one.
            </Notice>
          )}
          {snap.listening ? <Listening snap={snap} listening={snap.listening} /> : <Text variant="headline">{snap.headline}</Text>}
          {snap.speechProblem && (
            <Notice
              tone="error"
              title={snap.speechProblem.title}
              actions={
                <Button variant={snap.libraryReady ? "primary" : "secondary"} size="small" onClick={() => act("open-settings:voice")}>
                  Open voice settings
                </Button>
              }
            >
              {snap.speechProblem.line}
            </Notice>
          )}
          <Stack gap={8}>
            {/* One primary at a time: while a problem's fix is offered above, recording is one of the other ways in. */}
            <ActionTile
              order={0}
              tone={snap.libraryReady && !snap.speechProblem ? "primary" : "secondary"}
              icon={snap.recording ? "stop" : "mic"}
              label={snap.recording ? "Stop recording" : "Record a thought"}
              hint={snap.recording ? "Your words are filed when you stop." : "Speak, and your agent files it."}
              shortcut={keyOf(snap, "dictate")}
              onClick={() => act("dictate")}
            />
            <ActionTile
              order={1}
              icon="screen"
              label="Capture the screen"
              hint="With a comment on what is on it."
              shortcut={keyOf(snap, "capture")}
              open={askArea}
              onClick={() => setAskArea(!askArea)}
              choices={
                <>
                  <Button size="small" variant="primary" icon="screen" onClick={() => capture("capture")}>Capture the whole screen</Button>
                  <Button size="small" onClick={() => capture("capture-region")}>Pick a part</Button>
                </>
              }
            />
            {snap.callNotesOffer !== "off" && (
              <ActionTile
                order={2}
                icon="call"
                label={snap.callNotesOffer === "running" ? "Stop taking notes" : "Take notes on a call…"}
                hint={snap.callNotesOffer === "running" ? "The notes are filed when you stop." : "Both sides of the call, as notes."}
                onClick={() => act(snap.callNotesOffer === "running" ? "call-notes-stop" : "call-notes")}
              />
            )}
            <ActionTile order={3} icon="type" label="Type a thought…" hint="When speaking isn't right." shortcut={keyOf(snap, "type")} onClick={() => act("type")} />
            <ActionTile order={4} icon="search" label="Ask your library…" hint="Answers come from your pages, with links." shortcut={keyOf(snap, "ask")} onClick={() => act("ask")} />
          </Stack>
          <Stack gap={8}>
            {snap.inbox > 0 ? (
              <Row gap={8} justify="between">
                <Text variant="footnote" tone="secondary">{inboxLine(snap.inbox)}</Text>
                <Button size="small" variant="quiet" icon="folder" onClick={() => act("open-inbox")}>Open the inbox</Button>
              </Row>
            ) : (
              <Text variant="footnote" tone="secondary">{inboxLine(snap.inbox)}</Text>
            )}
            {(snap.showableReceipt || snap.undoableFiling || snap.cutShortCalls > 0 || snap.forgettableDictation) && (
              <Row gap={8} wrap>
                {snap.showableReceipt && <Button size="small" onClick={() => act("show-receipt")}>Show the last receipt</Button>}
                {snap.undoableFiling && <Button size="small" icon="undo" onClick={() => act("undo-filing")}>Undo the last filing</Button>}
                {snap.cutShortCalls > 0 && <Button size="small" icon="call" onClick={() => act("finish-cut-short")}>Finish notes for a call that was cut short</Button>}
                {snap.forgettableDictation && <Button size="small" variant="quiet" onClick={() => act("forget-dictation")}>Forget the last dictation</Button>}
              </Row>
            )}
          </Stack>
        </Stack>
      </div>
    </Aura>
  );
}

function ReviewLine({ review }: { review: PanelReview }) {
  const outcome = reviewOutcome(review);
  return (
    <Stack gap={4}>
      <Row gap={8} justify="between">
        <Stack gap={2}>
          <Text variant="headline">{review.name}</Text>
          <Text variant="footnote" tone="secondary" numeric>{reviewState(review)}</Text>
        </Stack>
        <Button size="small" variant="secondary" icon="play" busy={review.running} onClick={() => act(`task:${review.id}`)}>
          Run now
        </Button>
      </Row>
      {review.running && <Progress label={`${review.name} is running`} />}
      {outcome && <Text variant="footnote" tone="secondary">{outcome}</Text>}
    </Stack>
  );
}

function PageDetails({ page }: { page: PanelPage }) {
  return (
    <Stack gap={12}>
      {page.sections.map((section, i) => (
        <Stack key={`${section.heading}-${i}`} gap={4}>
          <Text variant="footnote" tone="secondary">{section.heading}</Text>
          {section.lines.slice(0, 8).map((line, j) => (
            <Text key={j} variant="callout">{line}</Text>
          ))}
        </Stack>
      ))}
      {page.updated && page.updated !== page.created && (
        <Text variant="caption" tone="secondary">{`Made ${pageDay(page.created)}, changed ${pageDay(page.updated)}`}</Text>
      )}
    </Stack>
  );
}

/** The native menu that Sort and Filter pop up: Settings' Choose… menu, which the panel's page may ask for, as it is Settings' page. */
const pick = (options: { label: string; value: string; checked: boolean }[]) => window.avanzel.settings.pick(options, null);

function Library({ snap, pages }: { snap: PanelSnapshot; pages: PanelPage[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<PageSort>("changed");
  const [filter, setFilter] = useState<PageFilter>({ kind: "all" });
  const shelves = useMemo(() => SHELVES.filter((shelf) => pages.some((p) => p.shelf === shelf)), [pages]);
  const statuses = useMemo(() => [...new Set(pages.map((p) => p.status).filter((s): s is string => !!s))].sort(), [pages]);
  // A filter that matches nothing any more (its shelf emptied, its status gone) leaves the list on All: nothing is filtered out of sight.
  const live: PageFilter =
    (filter.kind === "shelf" && shelves.includes(filter.shelf)) || (filter.kind === "status" && statuses.includes(filter.status)) ? filter : { kind: "all" };
  const shown = sortPages(
    pages.filter((p) => (live.kind === "shelf" ? p.shelf === live.shelf : live.kind === "status" ? p.status === live.status : true)),
    sort,
  );
  const chooseSort = async () => {
    const picked = await pick(SORTS.map((value) => ({ label: sortLabel(value), value, checked: value === sort })));
    if (picked && (SORTS as readonly string[]).includes(picked)) setSort(picked as PageSort);
  };
  const chooseFilter = async () => {
    const options = [
      { label: "All pages", value: "all", checked: live.kind === "all" },
      ...shelves.map((shelf) => ({ label: SHELF_NAMES[shelf], value: `shelf:${shelf}`, checked: live.kind === "shelf" && live.shelf === shelf })),
      ...statuses.map((status) => ({ label: `Status: ${status}`, value: `status:${status}`, checked: live.kind === "status" && live.status === status })),
    ];
    const picked = await pick(options);
    if (!picked) return;
    if (picked === "all") setFilter({ kind: "all" });
    else if (picked.startsWith("shelf:") && isShelf(picked.slice(6))) setFilter({ kind: "shelf", shelf: picked.slice(6) as Shelf });
    else if (picked.startsWith("status:")) setFilter({ kind: "status", status: picked.slice(7) });
  };
  const dictate = keyOf(snap, "dictate");
  return (
    <div className="panel-pad">
      <Stack gap={16}>
        {snap.reviews.length > 0 && (
          <Stack gap={12}>
            {snap.reviews.map((review) => <ReviewLine key={review.id} review={review} />)}
            {snap.undoableReview && (
              <Row gap={8}><Button size="small" variant="quiet" icon="undo" onClick={() => act("undo-review")}>Undo the last evening review</Button></Row>
            )}
          </Stack>
        )}
        <Stack gap={8}>
          <Row gap={8} justify="between">
            <Text variant="footnote" tone="secondary">{live.kind === "all" ? pagesLabel(shown.length) : `${pagesLabel(shown.length)}, ${filterLabel(live)}`}</Text>
            <Row gap={6}>
              <Button size="small" variant="secondary" icon="settings" onClick={() => void chooseFilter()}>
                {live.kind === "all" ? "Filter" : filterLabel(live)}
              </Button>
              <Button size="small" variant="secondary" icon="chevron" onClick={() => void chooseSort()}>{sortLabel(sort)}</Button>
            </Row>
          </Row>
          {shown.length === 0 && (
            <Text variant="callout" tone="secondary">
              {pages.length === 0 ? `Nothing filed yet. ${dictate ? `Press ${dictate}` : "Record a thought"} and say hello.` : "No pages match this filter."}
            </Text>
          )}
          {shown.map((page, i) => (
            <PageRow
              key={page.path}
              order={i}
              title={page.title}
              shelf={isShelf(page.shelf) ? page.shelf : undefined}
              status={page.status ?? undefined}
              tags={page.tags}
              date={pageDay(sort === "made" ? page.created : (page.updated ?? page.created))}
              summary={page.summary || undefined}
              expanded={open === page.path}
              onToggle={() => setOpen(open === page.path ? null : page.path)}
              actions={
                <>
                  <Button size="small" variant="secondary" icon="open" onClick={() => act(`open-md:${page.path}`)}>.md</Button>
                  {snap.opensInObsidian && <Button size="small" variant="secondary" icon="open" onClick={() => act(`open-obsidian:${page.path}`)}>Obsidian</Button>}
                </>
              }
            >
              <PageDetails page={page} />
            </PageRow>
          ))}
        </Stack>
      </Stack>
    </div>
  );
}

function App() {
  const [snap, setSnap] = useState<PanelSnapshot | null>(null);
  const [pages, setPages] = useState<PanelPage[]>([]);
  const [tab, setTab] = useState<PanelTab>("capture");
  // The pane Settings opens on when something asked for one before its tab showed.
  const [pane, setPane] = useState<SettingsPane | undefined>(undefined);
  const readPages = useCallback(() => void api.pages().then(setPages), []);
  useEffect(() => {
    api.get().then(setSnap);
    readPages();
    const offChanged = api.onChanged(setSnap);
    const offShown = api.onShown((next) => {
      if (next) setTab(next);
      readPages();
    });
    const offPane = window.avanzel.settings.onShowPane((next) => setPane(isSettingsPane(next) ? next : "general"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) api.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      offChanged();
      offShown();
      offPane();
      window.removeEventListener("keydown", onKey);
    };
  }, [readPages]);
  const version = snap?.pagesVersion;
  useEffect(() => {
    if (version !== undefined) readPages();
  }, [version, readPages]);
  if (!snap) return null;
  return (
    <div className="panel">
      <header className="panel-head">
        <Tabs
          label="Sections"
          controls="panel-tab"
          options={[
            { value: "capture", label: "Capture" },
            { value: "library", label: "Library", count: pages.length, countLabel: pagesLabel(pages.length) },
            { value: "settings", label: "Settings" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </header>
      <div className="panel-body">
        <TabPanel
          id="panel-tab"
          value={tab}
          height="fill"
          pages={[
            { value: "capture", content: <Capture snap={snap} /> },
            { value: "library", content: <Library snap={snap} pages={pages} /> },
            { value: "settings", content: <SettingsApp embedded startPane={pane} /> },
          ]}
        />
      </div>
      <footer className="panel-foot">
        <Row gap={8} justify="between">
          <Button size="small" variant="quiet" icon="folder" onClick={() => act("open-library")}>Open library</Button>
          <Button size="small" variant="quiet" onClick={() => act("quit")}>Quit Avanzel</Button>
        </Row>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
