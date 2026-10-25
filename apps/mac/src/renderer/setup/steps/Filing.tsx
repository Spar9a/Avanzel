// Step 4, Watch me file it: the first thought is filed while the person watches. The stage holds their words on a card,
// Zel, and the tabs of the six shelves the filing goes to. The working line counts the agent's seconds, with Cancel;
// under it come the agent's steps as it takes them, a row each, and the tabs count the pages it has written. Then the
// heading says it is all filed, and the card is stamped FILED, the step's one orchestrated moment. Lines say what the
// filing wrote, over the receipt of its shelf pages, with its proof (the words are kept in raw/, and a snapshot is
// saved) and Undo (or ⌘Z), which puts everything back, and its first page to open. A cancelled or undone filing says
// what stayed and offers to file it again; a failed one says why, in the capsule's words, in a Notice with its one fix.
// The heading sits in a status region, so VoiceOver hears the start and the end, not each second or each step. There is
// no Back: the filing goes on by itself, even once the window closes.
import { Actions, Button, Card, Kbd, Notice, Receipt, Row, SHELVES, ShelfTag, Stack, Text, Zel, type Shelf, type ZelMood } from "@avanzel/ui";
import { useEffect, useState } from "react";
import { NOTE_GONE, type NarrationRow, type SetupFiling } from "../../../shared/ipc.ts";
import { undoRefused } from "../../../shared/problems.ts";
import { pageName } from "../../../shared/wikilinks.ts";
import { KEPT_LINE, rowLine, SAVED_LINE, SHOWN_ROWS } from "../../common/narration.ts";
import { problemBody } from "../../common/problem.tsx";
import { cancelledLine, failedFiling, filedHeading, othersLine, pagesLine, receiptPages, stampDate, workingLine } from "../copy.ts";
import { Frame, useNow, type StepProps } from "../frame.tsx";

const api = window.avanzel.setup;

/** How often the working line counts. */
const TICK_MS = 250;

/** Zel at each moment: thinking while the agent works, worried by a failure, glad once the thought is filed. */
const MOOD: Record<SetupFiling["kind"], ZelMood> = { running: "thinking", filed: "filed", failed: "needs-you", cancelled: "idle", undone: "idle" };

type Running = Extract<SetupFiling, { kind: "running" }>;
type Filed = Extract<SetupFiling, { kind: "filed" }>;
type Failed = Extract<SetupFiling, { kind: "failed" }>;

export function Filing({ snap, go }: StepProps) {
  const filing = snap.filing;
  if (!filing) return null; // the controller enters this step as it hands the thought over, so there is always one
  // One primary per moment: while File it again or a failure's fix shows, it holds the primary, and Continue steps back.
  const fix = filing.kind === "cancelled" || filing.kind === "undone" || (filing.kind === "failed" && filing.line !== NOTE_GONE);
  // A filing that wrote pages goes on to a question about them; any other ending, to the end of setup.
  const next = filing.kind === "filed" && filing.pages.length > 0 ? "ask" : "done";
  // Continue waits while an undo runs: the pages it would go on with are on their way out.
  const onward = (
    <Button variant={fix ? "secondary" : "primary"} disabled={filing.kind === "filed" && filing.undoing} onClick={() => go(next)}>Continue</Button>
  );
  return (
    <Frame model={snap.model} stage={<FilingStage filing={filing} />} actions={filing.kind === "running" ? undefined : onward}>
      <Stack gap={12}>
        <div role="status">
          <Text variant="heading">{heading(filing)}</Text>
        </div>
        {filing.kind === "running" && <Working filing={filing} />}
        {filing.kind === "filed" && <Outcome filing={filing} where={snap.libraryLabel} inObsidian={snap.opensInObsidian} />}
        {(filing.kind === "cancelled" || filing.kind === "undone") && (
          <>
            <Text variant="callout">
              {filing.kind === "cancelled" ? cancelledLine(filing.agent, filing.partial) : "Everything is back as it was, and your words are in the inbox."}
            </Text>
            <Actions align="start">
              {/* Focus lands here, where Cancel or Undo was. */}
              <Button variant="primary" autoFocus onClick={() => api.fileAgain()}>File it again</Button>
            </Actions>
          </>
        )}
        {filing.kind === "failed" && <Failure filing={filing} eveningReview={snap.eveningReview?.enabled ?? false} />}
      </Stack>
    </Frame>
  );
}

/** The step's heading: what is going on, then how it ended. A failure keeps the first one, under its Notice's title. */
function heading(filing: SetupFiling): string {
  switch (filing.kind) {
    case "filed":
      return filedHeading(filing.agent, filing.seconds);
    case "cancelled":
      return "Cancelled.";
    case "undone":
      return "Undone.";
    default:
      return "Watch me file it.";
  }
}

/**
 * The stage: the card with the person's words, which are in the inbox until they are filed, Zel under it looking up at
 * it, and the six shelves' tabs below, where the filing goes. While the agent works, each tab counts the pages it has
 * written on its shelf so far. Once filed, the card is stamped, and each tab counts its filed pages: the same ones.
 */
function FilingStage({ filing }: { filing: SetupFiling }) {
  const inInbox = filing.kind !== "filed" && !(filing.kind === "failed" && filing.line === NOTE_GONE);
  return (
    <div className="filing">
      <div className="filing-card">
        {filing.kind === "filed" ? <FiledCard words={filing.words} /> : <Card label="Thought" meta={inInbox ? "Inbox" : undefined}>{filing.words}</Card>}
      </div>
      <Row justify="end">
        <Zel mood={MOOD[filing.kind]} size="medium" look="up" />
      </Row>
      <Row gap={4} wrap justify="center">
        {SHELVES.map((shelf) => <ShelfTag key={shelf} shelf={shelf} variant="tab" count={pagesOn(filing, shelf)} />)}
      </Row>
    </div>
  );
}

/**
 * What a shelf's tab counts: the pages the agent has written there so far (those of `written` whose first folder is the
 * shelf), or, once filed, the pages that went in. `written` isn't cut as the rows are, so the count never falls.
 */
function pagesOn(filing: SetupFiling, shelf: Shelf): number {
  if (filing.kind === "running") return filing.written.filter((path) => path.startsWith(`${shelf}/`)).length;
  if (filing.kind === "filed") return filing.pages.filter((page) => page.shelf === shelf).length;
  return 0;
}

/** The card once its thought is filed, stamped FILED with the day it was: the stamp lands as the card shows it. */
function FiledCard({ words }: { words: string }) {
  const [day] = useState(() => new Date());
  return <Card label="Thought" stamp={{ word: "filed", date: stampDate(day), animate: true }}>{words}</Card>;
}

/**
 * While the agent works: how long it has worked, or that another run has the library, beside Cancel; and under that the
 * agent's steps as it takes them, a row each. The six newest show, the newest in full ink and the others quieter. A row
 * has no icon and comes without motion, and it sits outside the heading's status region, so nothing is announced as it
 * comes. Only this redraws as the seconds count.
 */
function Working({ filing }: { filing: Running }) {
  const now = useNow(TICK_MS);
  const shown = filing.rows.slice(-SHOWN_ROWS);
  const first = filing.rows.length - shown.length;
  return (
    <Stack gap={8}>
      <Row gap={8} justify="between">
        <Text variant="footnote" tone="secondary" numeric>
          {filing.waiting ? "Waiting for another Avanzel run to finish…" : workingLine(filing.agent, (now - filing.startedAt) / 1000)}
        </Text>
        <Button size="small" busy={filing.cancelling} onClick={() => api.cancelFiling()}>Cancel</Button>
      </Row>
      {shown.length > 0 && (
        <Stack gap={4}>
          {shown.map((row, n) => (
            <Text key={rowKey(row, first + n)} variant="footnote" tone={n === shown.length - 1 ? "default" : "secondary"}>
              {rowLine(row)}
            </Text>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * A row's key: its kind and its path, which no two rows share. A search has no path, so its key has its place among the
 * rows kept, `at`, which doesn't change as rows are added.
 */
function rowKey(row: NarrationRow, at: number): string {
  return row.kind === "search" ? `search:${at}` : `${row.kind}:${row.path}`;
}

/**
 * Once filed: Zel's praise when the filing wrote pages; what it wrote on the shelves and where, or else that the agent
 * noted it in the log; and how many pages it wrote elsewhere. Then the receipt of its shelf pages, the proof (the words
 * are kept in raw/, always; and, while the filing can be taken back, one sentence that a snapshot is saved and how to put
 * everything back: ⌘Z or Undo), Undo, and its first page to open. Git refusing the undo says so in a Notice, and nothing
 * offers to undo it again, nor says a snapshot can be.
 */
function Outcome({ filing, where, inObsidian }: { filing: Filed; where: string; inObsidian: boolean }) {
  const { pages: rows, others } = receiptPages(filing.pages);
  // New pages come first, `created` of them: the new ones on the shelves are the shelf pages among those.
  const created = receiptPages(filing.pages.slice(0, filing.created)).pages.length;
  const undoable = filing.canUndo && !filing.undoRefused;
  useUndoKey(undoable);
  const more = othersLine(others);
  const first = filing.pages[0];
  return (
    <>
      {filing.pages.length > 0 && <Text variant="voice">Your first thought has a home.</Text>}
      <Stack gap={4}>
        <Text variant="footnote" tone="secondary">{pagesLine(created, rows.length - created, where) ?? `${filing.agent} noted it in the log.`}</Text>
        {more && <Text variant="footnote" tone="secondary">{more}</Text>}
      </Stack>
      {filing.undoRefused && <Notice tone="error" title={undoRefused.title}>{undoRefused.body}</Notice>}
      {rows.length > 0 && <Receipt pages={rows} />}
      <Stack gap={4}>
        <Text variant="footnote" tone="secondary">{KEPT_LINE}</Text>
        {undoable && (
          <Text variant="footnote" tone="secondary">
            {SAVED_LINE} Press <Kbd>⌘Z</Kbd> or Undo to put everything back.
          </Text>
        )}
      </Stack>
      {(undoable || first) && (
        <Actions align="start">
          {undoable && <Button busy={filing.undoing} onClick={() => api.undo()}>Undo</Button>}
          {first && <Button onClick={() => window.avanzel.ask.openPage(pageName(first.path))}>{inObsidian ? "Open in Obsidian" : "Open the page"}</Button>}
        </Actions>
      )}
    </>
  );
}

/**
 * ⌘Z as macOS reads it on any keyboard: Z, or on a layout without Latin letters, the key in Z's place. Another modifier
 * makes it another shortcut: ⌘⇧Z is Redo.
 */
function isUndoKey(event: KeyboardEvent): boolean {
  if (!event.metaKey || event.shiftKey || event.altKey || event.ctrlKey) return false;
  return event.key.toLowerCase() === "z" || (event.code === "KeyZ" && !/^[a-z]$/i.test(event.key));
}

/** While `on`, ⌘Z undoes the filing, and never reaches the Edit menu's Undo, which has nothing to undo here. */
function useUndoKey(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const undo = (event: KeyboardEvent) => {
      if (!isUndoKey(event)) return;
      event.preventDefault();
      api.undo();
    };
    window.addEventListener("keydown", undo);
    return () => window.removeEventListener("keydown", undo);
  }, [on]);
}

/**
 * A failed filing's Notice, in the capsule's words (failedFiling): what happened, and what is safe. An agent asking to sign in
 * says how, with the command set as code, and Open Terminal comes beside Try again; any other failure offers Try again alone,
 * which files the note again. A note gone from the inbox has nothing to try again: Continue goes on.
 */
function Failure({ filing, eveningReview }: { filing: Failed; eveningReview: boolean }) {
  const problem = failedFiling(filing, new Date(), eveningReview);
  if (filing.line === NOTE_GONE) return <Notice tone="error" title={problem.title}>{problem.body}</Notice>;
  return (
    <Notice
      tone="error"
      title={problem.title}
      actions={
        <Actions align="start">
          {filing.failure?.kind === "signin" && <Button size="small" onClick={() => api.openTerminal()}>Open Terminal</Button>}
          <Button size="small" variant="primary" onClick={() => api.fileAgain()}>Try again</Button>
        </Actions>
      }
    >
      {problemBody(problem)}
    </Notice>
  );
}
