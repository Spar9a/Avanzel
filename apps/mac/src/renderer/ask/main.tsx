// Ask: a question about the library, answered from the library only. Each turn is the question over its answer, as setup's
// Ask step shows one: the answer's lines, the pages its [[links]] name (each a button that opens it, beside its shelf),
// and who answered in how many seconds. While the agent looks, a line says what it is doing, and from 10 s on for how
// long, beside Stop, which gives the question up. When it couldn't answer, a Notice says what happened and that the library
// hasn't changed (or what the run changed); the newest turn's offers the one fix: Ask again, Open Terminal for a sign-in
// (beside Ask again), or Open Settings when the library's agent isn't installed. The newest turn is on top. Before the first
// question a line says where answers come from, or, while the six shelves hold no pages, to say something first; under it, up to
// three questions about the pages filed last, each in words beside Ask this, which asks it. The newest answer that can be kept
// offers Save as a page: the agent writes the answer the person was shown as a page, while a line says what it is doing, beside a
// Stop. It ends with where the page is, beside Undo, which takes the save back, and Open; or with Stopped, and the offer again; or
// with a Notice that says what the save left and offers Save again. An Undo ends with Undone and the offer again, or, when git refuses
// it, with a Notice under the saved line, which keeps Open. One question is answered, or answer saved, at a time, and Esc closes the
// window, which gives up whichever is going on.
import "@avanzel/ui/base.css";
import { Actions, Button, Notice, Row, ShelfTag, Spinner, Stack, Text, TextField } from "@avanzel/ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AskResult, AvanzelBridge, SaveResult } from "../../shared/ipc.ts";
import { avanzelFailure, saveProblem, undoRefused, type AskProblem } from "../../shared/problems.ts";
import { pageName } from "../../shared/wikilinks.ts";
import { problemBody } from "../common/problem.tsx";
import { remoteMessage } from "../settings/copy.ts";
import { isShelf, sourceTitle } from "../setup/copy.ts";
import { answeredLine, ASKING_LINES, emptyLine, failedAnswer, savedLine, SAVING_LINES, stoppedSaveLine, undoneLine, waitingLine, type WaitLines } from "./copy.ts";
import "./styles.css";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

const api = window.avanzel.ask;

/** How often the waiting line counts. */
const TICK_MS = 250;

/** How a turn ended: null while the agent looks, "stopped" once Stop gave it up, else what main sent back. */
type Outcome = AskResult | "stopped" | null;

/**
 * A turn's answer being saved as a page, or saved: `result` is null while the save runs, and then what main sent back. `stopping`:
 * Stop gave the save up, and main hasn't said how it ended, which may be as late as the end of a filing the save waits behind.
 * `undo`: the saved page's Undo, none until it is pressed. It is asked while main takes the save back, then undone, or refused when
 * git said no. A save pressed again replaces the whole of it.
 */
interface Saving {
  result: SaveResult | null;
  stopping?: true;
  undo?: "asked" | "undone" | "refused";
}

interface Turn {
  /** Counts up from the first question, so a turn keeps its place in the page as newer ones come above it. */
  id: number;
  question: string;
  outcome: Outcome;
  /** Its answer's save: none until Save as a page is pressed on it. */
  saving?: Saving;
}

/** What the question being answered is doing, as main last said it (null: nothing yet), and since when. */
interface Progress {
  message: string | null;
  /** When it was asked, or when main last said what it does: the waiting line counts the seconds from then. */
  since: number;
}

/** The time now, read again every `ms` while `ticking`: only the turn whose agent looks redraws as its seconds count. */
function useClock(ms: number, ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms, ticking]);
  return now;
}

function Ask() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [progress, setProgress] = useState<Progress>(() => ({ message: null, since: Date.now() }));
  // The pages on the six shelves (null until counted), which decide the line under the field before the first question, and the
  // questions suggested under that line (none until read).
  const [pages, setPages] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const counter = useRef(0);
  const field = useRef<HTMLInputElement>(null);
  const busy = turns.some((turn) => turn.outcome === null || turn.saving?.result === null);

  // Whatever main says next starts the count again: the seconds are those of what the question is doing now.
  useEffect(() => api.onProgress((message) => setProgress({ message, since: Date.now() })), []);
  // The shelves are counted and the suggestions read when the window opens, and again whenever it has the focus: a note may have
  // been filed meanwhile. They are read together and drawn together, so what shows was read at one moment; a read that fails
  // leaves both as they were.
  useEffect(() => {
    const read = () =>
      void Promise.all([api.libraryPages(), api.suggestions()]).then(
        ([count, questions]) => {
          setPages(count);
          setSuggestions(questions);
        },
        () => undefined,
      );
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);
  // Esc closes the window wherever the focus is: in the field, or on a page's button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") api.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Asks `words`, as a new turn on top; whether it did. One run at a time: while a question is answered or an answer saved, asking
   * does nothing. What main sends back for a turn Stop has given up is dropped: that turn says "Stopped.".
   */
  const ask = (words: string): boolean => {
    const asked = words.trim();
    if (!asked || busy) return false;
    const id = counter.current++;
    setProgress({ message: null, since: Date.now() });
    setTurns((prev) => [{ id, question: asked, outcome: null }, ...prev]);
    void api.ask(asked).then((result) =>
      setTurns((prev) => prev.map((turn) => (turn.id === id && turn.outcome === null ? { ...turn, outcome: result } : turn))),
    );
    return true;
  };

  /**
   * Saves the answer `turn` shows as a page, as its newest answered turn offers; whether it did. One run at a time: while a question
   * is answered or an answer saved, saving does nothing. The save is the library's it came from (`AskResult.library`): main refuses
   * it in another. A save that main can't take is read as one that failed, so a turn never stays busy. The field gets the focus, which
   * the button that was pressed leaves.
   */
  const save = (turn: Turn) => {
    const { id, question: asked, outcome } = turn;
    if (busy || outcome === null || outcome === "stopped" || !outcome.ok) return;
    const setSaving = (next: Saving) => setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, saving: next } : t)));
    setProgress({ message: null, since: Date.now() });
    setSaving({ result: null });
    void api
      .save(asked, outcome.answer, outcome.library)
      .catch((error: unknown): SaveResult => ({ kind: "unsaved", agent: "Avanzel", failure: avanzelFailure(remoteMessage(error)), partial: null }))
      .then((result) => setSaving({ result }));
    field.current?.focus();
  };

  /**
   * Undo, on the turn whose answer was saved with a commit (`SaveResult.commit`): git takes the save back, once, in the library it was
   * saved in, and the turn tells how it went (`Saving.undo`): Undone, with the offer back on the newest turn, or a Notice that git
   * refused it. It is not an agent's run, so it stops nothing and waits for nothing: a question or a save can go on beside it. A reply
   * main can't give is read as a refusal, so the button never waits for ever. The field gets the focus, which the button that was pressed
   * leaves.
   */
  const undo = (turn: Turn) => {
    const { id, saving } = turn;
    const saved = saving?.result;
    if (saved?.kind !== "saved" || saved.commit === null || saving?.undo !== undefined) return;
    const setUndo = (next: NonNullable<Saving["undo"]>) =>
      setTurns((prev) => prev.map((t) => (t.id === id && t.saving ? { ...t, saving: { ...t.saving, undo: next } } : t)));
    setUndo("asked");
    void api
      .undoSave(saved.commit)
      .catch(() => false)
      .then((undone) => setUndo(undone ? "undone" : "refused"));
    field.current?.focus();
  };

  /**
   * Stop: what runs is given up, and the field, which gets the focus, is free for the next. A question says "Stopped." at once. A
   * save says it is stopping until main answers (`Saving.stopping`): its result is what the turn tells, and it is the save's own
   * if Stop came as it ended.
   */
  const stop = () => {
    api.cancel();
    setTurns((prev) =>
      prev.map((turn) =>
        turn.outcome === null ? { ...turn, outcome: "stopped" } : turn.saving?.result === null ? { ...turn, saving: { result: null, stopping: true } } : turn,
      ),
    );
    field.current?.focus();
  };

  return (
    <main className="ask">
      <div className="ask-drag" />
      <div className="ask-field">
        {/* Return asks the field's words, and empties it once they are asked; while a question is answered, it keeps them. */}
        <TextField
          ref={field}
          label="Ask your library"
          labelHidden
          placeholder="Ask your library…"
          value={question}
          onChange={setQuestion}
          onEnter={() => {
            if (ask(question)) setQuestion("");
          }}
          autoFocus
        />
      </div>
      <div className="ask-turns">
        {turns.length === 0 ? (
          <>
            <div className="ask-empty">
              <Text variant="callout" tone="secondary">{emptyLine(pages)}</Text>
            </div>
            {suggestions.length > 0 && (
              // Before the first question only. Ask this asks the question as a new turn, which takes them away, and gives the field
              // the focus, ready for the next; what is typed there stays.
              <div className="ask-suggestions">
                <Stack gap={8}>
                  {suggestions.map((suggested) => (
                    <Suggestion
                      key={suggested}
                      question={suggested}
                      onAsk={() => {
                        ask(suggested);
                        field.current?.focus();
                      }}
                    />
                  ))}
                </Stack>
              </div>
            )}
          </>
        ) : (
          <Stack gap={24}>
            {turns.map((turn, place) => (
              <article key={turn.id}>
                <Stack gap={8}>
                  <Text variant="headline" as="h2">{turn.question}</Text>
                  {turn.outcome !== null && turn.outcome !== "stopped" && !turn.outcome.ok ? (
                    <Failed
                      problem={failedAnswer(turn.outcome, new Date())}
                      // Only the newest turn offers its fix: a failure a later question has come after is past. Ask again keeps
                      // what is typed in the field, which gets the focus as Ask again goes.
                      again={
                        place === 0
                          ? {
                              label: "Ask again",
                              onPress: () => {
                                ask(turn.question);
                                field.current?.focus();
                              },
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <Reply outcome={turn.outcome} progress={progress} onStop={stop} />
                  )}
                  <SaveAsPage turn={turn} newest={place === 0} progress={progress} onSave={() => save(turn)} onUndo={() => undo(turn)} onStop={stop} />
                </Stack>
              </article>
            ))}
          </Stack>
        )}
      </div>
    </main>
  );
}

/**
 * A question suggested about a page filed last, as setup's Ask step shows its own: the question in words beside the button that
 * asks it, which stays short however long a title is, so the words wrap in the line they have. The group is named by those words,
 * so Ask this says what it asks. Each has its own id, which is why it is a component: a hook can't run for each item of a list.
 */
function Suggestion({ question, onAsk }: { question: string; onAsk(): void }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <Row gap={12} justify="between">
        <div className="ask-offer">
          <Text variant="callout" id={id}>{question}</Text>
        </div>
        <Button size="small" onClick={onAsk}>Ask this</Button>
      </Row>
    </div>
  );
}

/**
 * What a question or a save says from its start to its end, in a status region that stays: VoiceOver hears the line the agent
 * starts with, then what `children` say once it ends, as that takes the line's place. While it is `running`, a spinner, the waiting
 * line (`lines`) and a quiet Stop, which says it is stopping (`stopping`) until the run's result has come. From 10 s on the line
 * counts the seconds outside the region, so they aren't read out at each tick.
 */
function StatusRow({
  running,
  progress,
  lines,
  stopping = false,
  onStop,
  children,
}: {
  running: boolean;
  progress: Progress;
  lines: WaitLines;
  stopping?: boolean;
  onStop(): void;
  children?: ReactNode;
}) {
  const now = useClock(TICK_MS, running);
  const { line, counting } = waitingLine(progress.message, (now - progress.since) / 1000, lines);
  return (
    <Row gap={8}>
      {running && <Spinner size="small" />}
      <div className="ask-reply">
        <div role="status">{running ? !counting && <Text variant="footnote" tone="secondary">{line}</Text> : children}</div>
        {running && counting && <Text variant="footnote" tone="secondary" numeric>{line}</Text>}
      </div>
      {running && <Button size="small" variant="quiet" busy={stopping} onClick={onStop}>Stop</Button>}
    </Row>
  );
}

/** A turn's reply: while the agent looks the waiting line, then the answer, or "Stopped." (`StatusRow`). */
function Reply({ outcome, progress, onStop }: { outcome: Outcome; progress: Progress; onStop(): void }) {
  return (
    <StatusRow running={outcome === null} progress={progress} lines={ASKING_LINES} onStop={onStop}>
      {outcome === "stopped" ? <Text variant="footnote" tone="secondary">Stopped.</Text> : outcome !== null && <Answer result={outcome} />}
    </StatusRow>
  );
}

/**
 * What a turn does with its answer, under its reply. The newest answered turn offers Save as a page, unless its answer has been
 * saved, is being saved, or failed to be: a save that stopped, or was undone, is offered again. The save has its own status region
 * (`StatusRow`), mounted empty with the offer and kept, in the same place in the tree, while the turn has the offer or a save, so that its
 * first line is a change VoiceOver reads. While it is empty it takes no slot of its own (`.ask-save-line`).
 * - While it saves: the waiting line and Stop.
 * - Saved: where the page is, with Undo, which takes the save back (none without git, where the save has no commit), and Open. The saved
 *   line names that group, so each Open says which page it opens. They stay on their turn under newer questions.
 * - Undone: that the page is gone from the library, and the offer again on the newest turn.
 * - An Undo git refused: a Notice under the saved line, which keeps Open and offers no second try.
 * - Stopped: what the save left, and the offer.
 * A save that saved nothing is a Notice, outside the region, with the fix Save again on the newest turn (`Failed`), and none on an older one.
 */
function SaveAsPage({
  turn,
  newest,
  progress,
  onSave,
  onUndo,
  onStop,
}: {
  turn: Turn;
  newest: boolean;
  progress: Progress;
  onSave(): void;
  onUndo(): void;
  onStop(): void;
}) {
  const lineId = useId();
  const { outcome, saving } = turn;
  const result = saving?.result ?? null;
  const undo = saving?.undo;
  // The save whose page stands (its line, Undo and Open), or the one that was taken back (its line says so).
  const saved = result?.kind === "saved" && undo !== "undone" ? result : null;
  const undone = result?.kind === "saved" && undo === "undone" ? result : null;
  const answered = outcome !== null && outcome !== "stopped" && outcome.ok && outcome.paragraphs.length > 0;
  const offered = newest && answered && (saving === undefined || result?.kind === "stopped" || undone !== null);
  if (!offered && saving === undefined) return null;
  return (
    <div role={saved ? "group" : undefined} aria-labelledby={saved ? lineId : undefined}>
      <Stack gap={8}>
        <div className="ask-save-line">
          <StatusRow running={result === null && saving !== undefined} progress={progress} lines={SAVING_LINES} stopping={saving?.stopping === true} onStop={onStop}>
            {saved && <Text variant="footnote" tone="secondary" id={lineId}>{savedLine(saved.page)}</Text>}
            {undone && <Text variant="footnote" tone="secondary">{undoneLine(undone.page)}</Text>}
            {result?.kind === "stopped" && <Text variant="footnote" tone="secondary">{stoppedSaveLine(result.agent, result.partial)}</Text>}
          </StatusRow>
        </div>
        {result?.kind === "unsaved" && (
          <Failed
            problem={saveProblem(result.failure, result.agent, result.partial, new Date())}
            again={newest ? { label: "Save again", onPress: onSave, withSettings: true } : undefined}
          />
        )}
        {undo === "refused" && <Notice tone="error" title={undoRefused.title}>{undoRefused.body}</Notice>}
        {(offered || saved) && (
          <Actions align="start">
            {offered && <Button size="small" onClick={onSave}>Save as a page</Button>}
            {saved && saved.commit !== null && undo !== "refused" && <Button size="small" busy={undo === "asked"} onClick={onUndo}>Undo</Button>}
            {saved && <Button size="small" onClick={() => api.openPage(pageName(saved.page.path))}>Open</Button>}
          </Actions>
        )}
      </Stack>
    </div>
  );
}

/** What a failure's Notice offers to try again: the fix that asks, or saves, the same again. */
interface Again {
  label: "Ask again" | "Save again";
  onPress(): void;
  /**
   * Stays beside Open Settings, secondary. A question leaves its Ask again out there, since trying again would only fail again until
   * the settings are mended. A save keeps Save again: the answer it was pressed on can be saved nowhere but its turn, so once the
   * settings are mended this is the only way.
   */
  withSettings?: true;
}

/**
 * A failed answer or save: what happened is the Notice's title; its body says what is safe (that the library hasn't changed, or what
 * the run changed or left) and what to do, with the command to run set as code (`failedAnswer`, `saveProblem`). Given `again`, it
 * offers the one fix, the moment's only primary: Ask again, or Save again; for an agent that isn't signed in, Open Terminal (through
 * setup's channel, which opens it), with that beside it, secondary; for an agent that isn't there, Open Settings on Agents (through the
 * capsule's, which opens Settings), since trying again would only fail again: a save keeps Save again beside it, secondary
 * (`Again.withSettings`). The primary comes last. A Notice is an alert itself, so it sits outside the turn's status regions.
 */
function Failed({ problem, again }: { problem: AskProblem; again?: Again | undefined }) {
  return (
    <Notice
      tone="error"
      title={problem.title}
      actions={
        again && (
          <Actions align="start">
            {(!problem.settings || again.withSettings) && (
              <Button size="small" variant={problem.terminal || problem.settings ? "secondary" : "primary"} onClick={again.onPress}>{again.label}</Button>
            )}
            {problem.terminal && <Button size="small" variant="primary" onClick={() => window.avanzel.setup.openTerminal()}>Open Terminal</Button>}
            {problem.settings && (
              <Button size="small" variant="primary" onClick={() => window.avanzel.capsule.openSettingsFor("open-settings:agents")}>Open Settings</Button>
            )}
          </Actions>
        )
      }
    >
      {problemBody(problem)}
    </Notice>
  );
}

/**
 * An answer: its lines, then the pages its links name, each a button with its title that opens it, beside its shelf when
 * it is on one, and last who answered in how many seconds. A button never wraps its words, so a title longer than a line
 * is shortened (sourceTitle), as in setup's Ask step, rather than running out of the window.
 */
function Answer({ result }: { result: AskResult }) {
  return (
    <Stack gap={12}>
      <Stack gap={6}>
        {result.paragraphs.map((paragraph, i) => (
          <Text key={i}>{paragraph}</Text>
        ))}
      </Stack>
      {result.sources.length > 0 && (
        <Stack gap={4}>
          <Text variant="footnote" tone="secondary">Pages used:</Text>
          {result.sources.map((page) => (
            <Row key={page.path} gap={6} wrap>
              {isShelf(page.shelf) && <ShelfTag shelf={page.shelf} />}
              <Button variant="link" onClick={() => api.openPage(pageName(page.path))}>{sourceTitle(page.title)}</Button>
            </Row>
          ))}
        </Stack>
      )}
      <Text variant="footnote" tone="secondary" numeric>{answeredLine(result.agent, result.seconds)}</Text>
    </Stack>
  );
}

createRoot(document.getElementById("root")!).render(<Ask />);
