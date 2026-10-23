// Ask: a question about the library, answered from the library only. Each turn is the question over its answer, as setup's
// Ask step shows one: the answer's lines, the pages its [[links]] name (each a button that opens it, beside its shelf),
// and who answered in how many seconds. While the agent looks, a line says what it is doing, and from 10 s on for how
// long, beside Stop, which gives the question up. When it couldn't answer, a Notice says so and that the library hasn't
// changed, and the newest turn's offers Ask again. The newest turn is on top. One question is answered at a time, and Esc
// closes the window, which gives up a question that is still being answered.
import "@avanzel/ui/base.css";
import { Actions, Button, Notice, Row, ShelfTag, Spinner, Stack, Text, TextField } from "@avanzel/ui";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AskResult, AvanzelBridge } from "../../shared/ipc.ts";
import { pageName } from "../../shared/wikilinks.ts";
import { isShelf, sourceTitle } from "../setup/copy.ts";
import { answeredLine, failureLines, waitingLine } from "./copy.ts";
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
  const counter = useRef(0);
  const field = useRef<HTMLInputElement>(null);
  const busy = turns.some((turn) => turn.outcome === null);

  // Whatever main says next starts the count again: the seconds are those of what the question is doing now.
  useEffect(() => api.onProgress((message) => setProgress({ message, since: Date.now() })), []);
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
          <div className="ask-empty">
            <Text variant="callout" tone="secondary">Answers come from your library only, with links to the pages they use.</Text>
          </div>
        ) : (
          <Stack gap={24}>
            {turns.map((turn, place) => (
              <article key={turn.id}>
                <Stack gap={8}>
                  <Text variant="headline" as="h2">{turn.question}</Text>
                  {turn.outcome !== null && turn.outcome !== "stopped" && !turn.outcome.ok ? (
                    <Failed
                      answer={turn.outcome.answer}
                      // Only the newest turn offers it: a failure a later question has come after is past. Ask again keeps
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
 * A failed answer: what happened is the Notice's title; its body says the library hasn't changed, then what the agent
 * said last. Given `onAskAgain`, its one fix asks the question again. A Notice is an alert itself, so it sits outside
 * the turn's status region.
 */
function Failed({ answer, onAskAgain }: { answer: string; onAskAgain?: (() => void) | undefined }) {
  const { title, body } = failureLines(answer);
  return (
    <Notice
      tone="error"
      title={title}
      actions={
        onAskAgain && (
          <Actions align="start">
            <Button size="small" variant="primary" onClick={onAskAgain}>Ask again</Button>
          </Actions>
        )
      }
    >
      {body}
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
