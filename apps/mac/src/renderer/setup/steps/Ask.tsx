// Step 5, Ask me about it: a question about the first thought's pages, answered from the library only, with the pages
// the answer used. The stage holds the question on a card (the suggestion in full, until one is asked) and Zel, who
// looks up at it, thinks while the agent looks and is worried by a failure. The suggestion shows in words beside Ask
// this, which asks it; any other question is typed in Ask your library, and Return asks it. While the agent looks, a
// line counts its seconds and Skip gives the question up. Then the answer, over the pages its [[links]] name, each of
// which opens. A question that fails is told in a Notice with the Ask window's fix: Ask again, Open Terminal for a sign-in, or
// Open Settings when the library's agent isn't there. Skip is the quiet way on until there is an answer, then Continue;
// there is no Back. An Undo that lands here (Continue pressed as it began) takes the suggestion with it, and the step says so.
import { Actions, Button, Card, Notice, Row, ShelfTag, Stack, Text, TextField, Zel, type ZelMood } from "@avanzel/ui";
import { useId, useRef, useState } from "react";
import type { SetupAnswer } from "../../../shared/ipc.ts";
import { pageName } from "../../../shared/wikilinks.ts";
import { problemBody } from "../../common/problem.tsx";
import { askingLine, failedAnswer, isShelf, sourceTitle } from "../copy.ts";
import { afterAsk } from "../flow.ts";
import { Frame, useNow, type StepProps } from "../frame.tsx";

const api = window.avanzel.setup;

/** How often the asking line counts. */
const TICK_MS = 250;

type Asking = Extract<SetupAnswer, { kind: "asking" }>;
type Answered = Extract<SetupAnswer, { kind: "answered" }>;
type Failed = Extract<SetupAnswer, { kind: "failed" }>;

export function Ask({ snap, go }: StepProps) {
  const [question, setQuestion] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const offerId = useId();
  const { answer, suggestion } = snap;
  const asking = answer?.kind === "asking";
  // One question at a time: while one is answered, asking does nothing, and the box keeps its words. The box empties
  // only when its own words are asked, so the suggestion never takes away what the person is typing.
  const ask = (words: string): boolean => {
    if (!words.trim() || asking) return false;
    void api.ask(words);
    return true;
  };
  // The suggestion until a question is asked, and again once it fails itself, when it is a way to try again. After
  // another question fails, the card shows that one, so Ask this would ask something the step doesn't show.
  const offer = answer === null || (answer.kind === "failed" && answer.question === suggestion) ? suggestion : null;
  const skip = () => {
    api.skipAsk();
    go(afterAsk(snap.permissions));
  };
  const mood: ZelMood = asking ? "thinking" : answer?.kind === "failed" ? "needs-you" : "idle";
  return (
    <Frame
      model={snap.model}
      stage={<AskStage question={answer?.question ?? null} suggestion={suggestion} mood={mood} />}
      actions={
        answer?.kind === "answered" ? (
          <Button variant="primary" onClick={() => go(afterAsk(snap.permissions))}>Continue</Button>
        ) : (
          <Button variant="quiet" onClick={skip}>Skip</Button>
        )
      }
    >
      <Stack gap={12}>
        <Text variant="heading" focusable>Ask me about it.</Text>
        <Text variant="callout">I answer from your library only, and show you the notes I used.</Text>
        {snap.filing?.kind === "undone" && <Notice title="Undone.">Everything is back as it was, and your words are in the inbox.</Notice>}
        {offer && (
          // The suggestion in words, beside the button that asks it, which stays short however long a title is. The
          // group is named by those words, so Ask this says what it asks.
          <div role="group" aria-labelledby={offerId}>
            <Row gap={12} justify="between">
              <div className="ask-offer">
                <Text variant="callout" id={offerId}>{offer}</Text>
              </div>
              {/* It goes while its question is answered: the focus goes to the box, ready for the next question. */}
              <Button
                onClick={() => {
                  ask(offer);
                  field.current?.focus();
                }}
              >
                Ask this
              </Button>
            </Row>
          </div>
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
          <Failure
            answer={answer}
            // The question that failed was emptied from the box when it was asked, so only this button can ask it again; what is
            // typed meanwhile stays, and the focus goes to the box.
            onAskAgain={() => {
              ask(answer.question);
              field.current?.focus();
            }}
          />
        )}
      </Stack>
    </Frame>
  );
}

/**
 * A question that failed, as the Ask window tells it (failedAnswer): what happened, that the library hasn't changed (or what the
 * run changed), and what to do; and its one fix, the moment's primary, which comes last: Ask again; for an agent that isn't signed
 * in, Open Terminal, with Ask again beside it, secondary; for an agent that isn't there, Open Settings on Agents, since asking
 * again would only fail again. The step keeps its own ways on: Ask this asks the suggestion, and Skip goes on.
 */
function Failure({ answer, onAskAgain }: { answer: Failed; onAskAgain(): void }) {
  const problem = failedAnswer(answer, new Date());
  return (
    <Notice
      tone="error"
      title={problem.title}
      actions={
        <Actions align="start">
          {!problem.settings && (
            <Button size="small" variant={problem.terminal ? "secondary" : "primary"} onClick={onAskAgain}>Ask again</Button>
          )}
          {problem.terminal && <Button size="small" variant="primary" onClick={() => api.openTerminal()}>Open Terminal</Button>}
          {problem.settings && (
            <Button size="small" variant="primary" onClick={() => window.avanzel.capsule.openSettingsFor("open-settings:agents")}>Open Settings</Button>
          )}
        </Actions>
      }
    >
      {problemBody(problem)}
    </Notice>
  );
}

/**
 * The stage: the question on its card, the suggestion in its place until one is asked, and Zel under it, looking up at
 * it: thinking while the agent looks, worried when it couldn't answer.
 */
function AskStage({ question, suggestion, mood }: { question: string | null; suggestion: string | null; mood: ZelMood }) {
  return (
    <div className="ask">
      <div className="ask-card">
        <Card label="Question" placeholder={suggestion ?? undefined}>{question ?? undefined}</Card>
      </div>
      <Row justify="end">
        <Zel mood={mood} size="medium" look="up" />
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
 * when it is on one. A long title is shortened (sourceTitle), so its link fits the step; a row too wide for the step
 * puts the link under its shelf, which keeps its whole name rather than being squeezed.
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
          <Text variant="footnote" tone="secondary">Notes I used:</Text>
          {answer.sources.map((page) => (
            <Row key={page.path} gap={6} wrap>
              {isShelf(page.shelf) && <ShelfTag shelf={page.shelf} />}
              <Button variant="page" wrap onClick={() => window.avanzel.ask.openPage(pageName(page.path))}>{sourceTitle(page.title)}</Button>
            </Row>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
