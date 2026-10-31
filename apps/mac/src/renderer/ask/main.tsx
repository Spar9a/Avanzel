// Ask: a question about the library, answered from the library only. Each turn is the question over its answer, as setup's
// Ask step shows one: the answer's lines, the pages its [[links]] name (each a button that opens it, beside its shelf),
// and who answered in how many seconds. While the agent looks, a line says what it is doing, and from 10 s on for how
// long, beside Stop, which gives the question up. When it couldn't answer, a Notice says what happened and that the library
// hasn't changed (or what the run changed); the newest turn's offers the one fix: Ask again, Open Terminal for a sign-in
// (beside Ask again), or Open Settings when the library's agent isn't installed. The newest turn is on top. Before the first
// question a line says where answers come from, or, while the six shelves hold no pages, to say something first; under it, up to
// three questions about the pages filed last, each in words beside Ask this, which asks it. One question is answered at a time,
// and Esc closes the window, which gives up a question that is still being answered.
import "@avanzel/ui/base.css";
import { Actions, Button, Notice, Row, ShelfTag, Spinner, Stack, Text, TextField } from "@avanzel/ui";
import { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AskResult, AvanzelBridge } from "../../shared/ipc.ts";
import { pageName } from "../../shared/wikilinks.ts";
import { problemBody } from "../common/problem.tsx";
import { isShelf, sourceTitle } from "../setup/copy.ts";
import { answeredLine, emptyLine, failedAnswer, waitingLine } from "./copy.ts";
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

interface Turn {
  /** Counts up from the first question, so a turn keeps its place in the page as newer ones come above it. */
  id: number;
  question: string;
  outcome: Outcome;
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
  const busy = turns.some((turn) => turn.outcome === null);

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
   * Asks `words`, as a new turn on top; whether it did. One question at a time: while one is answered, asking does
   * nothing. What main sends back for a turn Stop has given up is dropped: that turn says "Stopped.".
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

  /** Stop: the question being answered is given up, and the field, which gets the focus, is free for the next. */
  const stop = () => {
    api.cancel();
    setTurns((prev) => prev.map((turn) => (turn.outcome === null ? { ...turn, outcome: "stopped" } : turn)));
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
                      result={turn.outcome}
                      // Only the newest turn offers its fix: a failure a later question has come after is past. Ask again keeps
                      // what is typed in the field, which gets the focus as Ask again goes.
                      onAskAgain={
                        place === 0
                          ? () => {
                              ask(turn.question);
                              field.current?.focus();
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <Reply outcome={turn.outcome} progress={progress} onStop={stop} />
                  )}
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
 * A turn's reply, in a status region that stays from the question to its end: VoiceOver hears the line the agent starts
 * with, then the answer, or "Stopped.", as it takes that line's place. While the agent looks, a spinner, the waiting line
 * and a quiet Stop. From 10 s on the line counts the seconds outside the region, so they aren't read out at each tick.
 */
function Reply({ outcome, progress, onStop }: { outcome: Outcome; progress: Progress; onStop(): void }) {
  const looking = outcome === null;
  const now = useClock(TICK_MS, looking);
  const { line, counting } = waitingLine(progress.message, (now - progress.since) / 1000);
  return (
    <Row gap={8}>
      {looking && <Spinner size="small" />}
      <div className="ask-reply">
        <div role="status">
          {outcome === null ? (
            !counting && <Text variant="footnote" tone="secondary">{line}</Text>
          ) : outcome === "stopped" ? (
            <Text variant="footnote" tone="secondary">Stopped.</Text>
          ) : (
            <Answer result={outcome} />
          )}
        </div>
        {looking && counting && <Text variant="footnote" tone="secondary" numeric>{line}</Text>}
      </div>
      {looking && <Button size="small" variant="quiet" onClick={onStop}>Stop</Button>}
    </Row>
  );
}

/**
 * A failed answer: what happened is the Notice's title; its body says the library hasn't changed (or what the run changed)
 * and what to do, with the command to run set as code (failedAnswer). Given `onAskAgain`, it offers the one fix, the moment's
 * only primary: Ask again; for an agent that isn't signed in, Open Terminal (through setup's channel, which opens it), with Ask
 * again beside it, secondary; for an agent that isn't there, Open Settings on Agents (through the capsule's, which opens
 * Settings), since asking again would only fail again. The primary comes last. A Notice is an alert itself, so it sits outside
 * the turn's status region.
 */
function Failed({ result, onAskAgain }: { result: AskResult; onAskAgain?: (() => void) | undefined }) {
  const problem = failedAnswer(result, new Date());
  return (
    <Notice
      tone="error"
      title={problem.title}
      actions={
        onAskAgain && (
          <Actions align="start">
            {!problem.settings && (
              <Button size="small" variant={problem.terminal ? "secondary" : "primary"} onClick={onAskAgain}>Ask again</Button>
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
