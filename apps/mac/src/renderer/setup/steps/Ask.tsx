// Step 5, Ask me about it: a question about the first thought's pages, answered from the library only, with the pages
// the answer used. The stage holds the question on a card (the suggestion, until one is asked) and Zel, who thinks while
// the agent looks. The suggestion is one click away; any other question is typed in Ask your library, and Return asks
// it. While the agent looks, a line counts its seconds and Skip gives the question up. Then the answer, over the pages
// its [[links]] name, each of which opens. Skip is the quiet way on until there is an answer, then Continue; there is
// no Back. An Undo that lands here (Continue pressed as it began) takes the suggestion with it, and the step says so.
import { Actions, Button, Card, Notice, Row, ShelfTag, Stack, Text, TextField, Zel } from "@avanzel/ui";
import { useRef, useState } from "react";
import type { SetupAnswer } from "../../../shared/ipc.ts";
import { pageName } from "../../../shared/wikilinks.ts";
import { askingLine, isShelf, ownLine } from "../copy.ts";
import { Frame, useNow, type StepProps } from "../frame.tsx";

const api = window.avanzel.setup;

/** How often the asking line counts. */
const TICK_MS = 250;

type Asking = Extract<SetupAnswer, { kind: "asking" }>;
type Answered = Extract<SetupAnswer, { kind: "answered" }>;

export function Ask({ snap, go }: StepProps) {
  const [question, setQuestion] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const { answer, suggestion } = snap;
  const asking = answer?.kind === "asking";
  // One question at a time: while one is answered, asking does nothing, and the box keeps its words. The box empties
  // only when its own words are asked, so the suggestion never takes away what the person is typing.
  const ask = (words: string): boolean => {
    if (!words.trim() || asking) return false;
    void api.ask(words);
    return true;
  };
  // The suggestion until a question is asked, and again once one fails, when it is a way to try again.
  const offer = answer === null || answer.kind === "failed" ? suggestion : null;
  const skip = () => {
    api.skipAsk();
    go("done");
  };
  return (
    <Frame
      model={snap.model}
      stage={<AskStage question={answer?.question ?? null} suggestion={suggestion} asking={asking} />}
      actions={
        answer?.kind === "answered" ? (
          <Button variant="primary" onClick={() => go("done")}>Continue</Button>
        ) : (
          <Button variant="quiet" onClick={skip}>Skip</Button>
        )
      }
    >
      <Stack gap={12}>
        <Text variant="heading">Ask me about it.</Text>
        <Text variant="callout">I answer from your library only, and show you the pages I used.</Text>
        {snap.filing?.kind === "undone" && <Notice title="Undone.">Everything is back as it was, and your words are in the inbox.</Notice>}
        {offer && (
          <Actions align="start">
            {/* It goes while its question is answered: the focus goes to the box, ready for the next question. */}
            <Button
              onClick={() => {
                ask(offer);
                field.current?.focus();
              }}
            >
              {offer}
            </Button>
          </Actions>
        )}
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
        {answer?.kind === "asking" && <AskingLine answer={answer} />}
        {/* VoiceOver hears the answer once it is in, not each second before it. */}
        <div role="status">{answer?.kind === "answered" && <Answer answer={answer} />}</div>
        {answer?.kind === "failed" && (
          <Notice tone="error" title={`${answer.agent} couldn't answer.`}>{ownLine(answer.line) || undefined}</Notice>
        )}
      </Stack>
    </Frame>
  );
}

/** The stage: the question on its card, the suggestion in its place until one is asked, and Zel, thinking while the agent looks. */
function AskStage({ question, suggestion, asking }: { question: string | null; suggestion: string | null; asking: boolean }) {
  return (
    <div className="ask">
      <div className="ask-card">
        <Card label="Question" placeholder={suggestion ?? undefined}>{question ?? undefined}</Card>
      </div>
      <Row justify="end">
        <Zel mood={asking ? "thinking" : "idle"} size="medium" />
      </Row>
    </div>
  );
}

/** While the agent looks: its seconds so far, or that another run has the library. Only this redraws as they count. */
function AskingLine({ answer }: { answer: Asking }) {
  const now = useNow(TICK_MS);
  return (
    <Text variant="footnote" tone="secondary" numeric>
      {answer.waiting ? "Waiting for the filing in progress to finish…" : askingLine((now - answer.startedAt) / 1000)}
    </Text>
  );
}

/**
 * The answer: the question over its lines, then the pages its links name, each a title that opens it, beside its shelf
 * when it is on one.
 */
function Answer({ answer }: { answer: Answered }) {
  return (
    <Stack gap={12}>
      <Stack gap={6}>
        <Text variant="headline">{answer.question}</Text>
        {answer.paragraphs.map((paragraph, i) => (
          <Text key={i}>{paragraph}</Text>
        ))}
      </Stack>
      {answer.sources.length > 0 && (
        <Stack gap={4}>
          <Text variant="footnote" tone="secondary">Pages I used:</Text>
          {answer.sources.map((page) => (
            <Row key={page.path} gap={6}>
              {isShelf(page.shelf) && <ShelfTag shelf={page.shelf} />}
              <Button variant="link" onClick={() => window.avanzel.ask.openPage(pageName(page.path))}>{page.title}</Button>
            </Row>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
