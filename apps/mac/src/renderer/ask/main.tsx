// Ask: a question about the library, answered from the library only. Each turn is the question over its answer, as setup's
// Ask step shows one: the answer's lines, the pages its [[links]] name (each a button that opens it, beside its shelf),
// and who answered in how many seconds. While the agent looks, a line says what it is doing; when it couldn't answer, a
// Notice says so. The newest turn is on top. One question is answered at a time, and Esc closes the window, which gives
// up a question that is still being answered.
import "@avanzel/ui/base.css";
import { Button, Notice, Row, ShelfTag, Spinner, Stack, Text, TextField } from "@avanzel/ui";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AskResult, AvanzelBridge } from "../../shared/ipc.ts";
import { pageName } from "../../shared/wikilinks.ts";
import { isShelf, sourceTitle } from "../setup/copy.ts";
import { answeredLine, failureLines } from "./copy.ts";
import "./styles.css";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

const api = window.avanzel.ask;

interface Turn {
  /** Counts up from the first question, so a turn keeps its place in the page as newer ones come above it. */
  id: number;
  question: string;
  /** Null while the agent looks. */
  result: AskResult | null;
}

function Ask() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  /** What the pending question is doing now, as main last reported it (null: nothing reported yet). */
  const [progress, setProgress] = useState<string | null>(null);
  const counter = useRef(0);
  const busy = turns.some((turn) => turn.result === null);

  useEffect(() => api.onProgress(setProgress), []);
  // Esc closes the window wherever the focus is: in the field, or on a page's button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") api.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // One question at a time: while one is answered, asking does nothing, and the field keeps its words.
  const ask = () => {
    const words = question.trim();
    if (!words || busy) return;
    const id = counter.current++;
    setQuestion("");
    setProgress(null);
    setTurns((prev) => [{ id, question: words, result: null }, ...prev]);
    void api.ask(words).then((result) => setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, result } : turn))));
  };

  return (
    <main className="ask">
      <div className="ask-drag" />
      <div className="ask-field">
        <TextField label="Ask your library" labelHidden placeholder="Ask your library…" value={question} onChange={setQuestion} onEnter={ask} autoFocus />
      </div>
      <div className="ask-turns">
        {turns.length === 0 ? (
          <div className="ask-empty">
            <Text variant="callout" tone="secondary">Answers come from your library only, with links to the pages they use.</Text>
          </div>
        ) : (
          <Stack gap={24}>
            {turns.map((turn) => (
              <article key={turn.id}>
                <Stack gap={8}>
                  <Text variant="headline" as="h2">{turn.question}</Text>
                  {turn.result !== null && !turn.result.ok ? (
                    <Failed answer={turn.result.answer} />
                  ) : (
                    // The region that stays while the agent looks: VoiceOver hears the answer as it replaces the line before it.
                    <div role="status">
                      {turn.result === null ? (
                        <Row gap={8}>
                          <Spinner size="small" />
                          <Text variant="footnote" tone="secondary">{progress ?? "Looking through your library…"}</Text>
                        </Row>
                      ) : (
                        <Answer result={turn.result} />
                      )}
                    </div>
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
 * A failed answer: what happened is the Notice's title, and what the agent said last its body. A Notice is an alert
 * itself, so it sits outside the turn's status region.
 */
function Failed({ answer }: { answer: string }) {
  const { title, body } = failureLines(answer);
  return (
    <Notice tone="error" title={title}>
      {body || undefined}
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
