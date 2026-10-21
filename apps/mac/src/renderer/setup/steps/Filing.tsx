// Step 4, Watch me file it: the first thought is filed while the person watches. The stage holds their words on a card,
// Zel, and the tabs of the six shelves the filing goes to. The working line counts the agent's seconds, with Cancel;
// then the heading says it is all filed, over the receipt of its pages. A cancelled filing says what stayed and offers
// to file it again; a failed one says why in a Notice with its one fix. The heading sits in a status region, so
// VoiceOver hears the start and the end, not each second. There is no Back: the filing goes on by itself, even once
// the window closes.
import { Actions, Button, Card, Notice, Receipt, Row, SHELVES, ShelfTag, Stack, Text, Zel, type ZelMood } from "@avanzel/ui";
import type { ReactNode } from "react";
import { NOTE_GONE, type SetupFiling } from "../../../shared/ipc.ts";
import { cancelledLine, failedLine, filedHeading, receiptPages, workingLine } from "../copy.ts";
import { Frame, useNow, type StepProps } from "../frame.tsx";

const api = window.avanzel.setup;

/** How often the working line counts. */
const TICK_MS = 250;

/** Zel at each moment: thinking while the agent works, worried by a failure, glad once the thought is filed. */
const MOOD: Record<SetupFiling["kind"], ZelMood> = { running: "thinking", filed: "filed", failed: "needs-you", cancelled: "idle" };

type Running = Extract<SetupFiling, { kind: "running" }>;
type Failed = Extract<SetupFiling, { kind: "failed" }>;

export function Filing({ snap, go }: StepProps) {
  const filing = snap.filing;
  if (!filing) return null; // the controller enters this step as it hands the thought over, so there is always one
  // One primary per moment: while File it again or a failure's fix shows, it holds the primary, and Continue steps back.
  const fix = filing.kind === "cancelled" || (filing.kind === "failed" && filing.line !== NOTE_GONE);
  const receipt = filing.kind === "filed" ? receiptPages(filing.pages).pages : [];
  return (
    <Frame
      model={snap.model}
      stage={<FilingStage filing={filing} />}
      actions={filing.kind === "running" ? undefined : <Button variant={fix ? "secondary" : "primary"} onClick={() => go("done")}>Continue</Button>}
    >
      <Stack gap={12}>
        <div role="status">
          <Text variant="heading">{heading(filing)}</Text>
        </div>
        {filing.kind === "running" && <Working filing={filing} />}
        {receipt.length > 0 && <Receipt pages={receipt} />}
        {filing.kind === "cancelled" && (
          <>
            <Text variant="callout">{cancelledLine(filing.agent, filing.partial)}</Text>
            <Actions align="start">
              {/* Focus lands here, where Cancel was. */}
              <Button variant="primary" autoFocus onClick={() => api.fileAgain()}>File it again</Button>
            </Actions>
          </>
        )}
        {filing.kind === "failed" && <Failure filing={filing} />}
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
    default:
      return "Watch me file it.";
  }
}

/**
 * The stage: the card with the person's words, which are in the inbox until they are filed, Zel by it, and the six
 * shelves' tabs below, where the filing goes.
 */
function FilingStage({ filing }: { filing: SetupFiling }) {
  const inInbox = filing.kind !== "filed" && !(filing.kind === "failed" && filing.line === NOTE_GONE);
  return (
    <div className="filing">
      <div className="filing-card">
        <Card label="Thought" meta={inInbox ? "Inbox" : undefined}>{filing.words}</Card>
      </div>
      <Row justify="end">
        <Zel mood={MOOD[filing.kind]} size="medium" />
      </Row>
      <Row gap={4} wrap justify="center">
        {SHELVES.map((shelf) => <ShelfTag key={shelf} shelf={shelf} variant="tab" />)}
      </Row>
    </div>
  );
}

/**
 * While the agent works: how long it has worked, or that another run has the library, beside Cancel. Only this redraws
 * as the seconds count. The agent's actions, a row each, are to go in this Stack under the working line.
 */
function Working({ filing }: { filing: Running }) {
  const now = useNow(TICK_MS);
  return (
    <Stack gap={8}>
      <Row gap={8} justify="between">
        <Text variant="footnote" tone="secondary" numeric>
          {filing.waiting ? "Waiting for another Avanzel run to finish…" : workingLine(filing.agent, (now - filing.startedAt) / 1000)}
        </Text>
        <Button size="small" busy={filing.cancelling} onClick={() => api.cancelFiling()}>Cancel</Button>
      </Row>
    </Stack>
  );
}

/**
 * A failed filing's Notice: an agent asking to sign in says how, with Open Terminal; any other failure gives the agent's
 * own line. Try again files the note again. A note gone from the inbox has nothing to try again: Continue goes on.
 */
function Failure({ filing }: { filing: Failed }) {
  const tryAgain = <Button size="small" variant="primary" onClick={() => api.fileAgain()}>Try again</Button>;
  if (filing.signedOut) {
    return (
      <Notice
        tone="error"
        title={`${filing.agent} isn't signed in on this Mac.`}
        actions={
          <Actions align="start">
            <Button size="small" onClick={() => api.openTerminal()}>Open Terminal</Button>
            {tryAgain}
          </Actions>
        }
      >
        {signInBody(filing)}
      </Notice>
    );
  }
  return (
    <Notice tone="error" title={`${filing.agent} couldn't file it.`} actions={filing.line === NOTE_GONE ? undefined : <Actions align="start">{tryAgain}</Actions>}>
      {failedLine(filing.line)}
    </Notice>
  );
}

/** How to sign the agent in, then file the note again; meanwhile the words wait in the inbox. */
function signInBody({ harness, agent }: Failed): ReactNode {
  switch (harness) {
    case "claude":
      return <>Run <Text variant="code">claude</Text> once in Terminal and sign in, then try again. Your words are safe in the inbox.</>;
    case "codex":
      return <>Run <Text variant="code">codex login</Text> in Terminal, then try again. Your words are safe in the inbox.</>;
    default:
      return <>Sign in to {agent} in Terminal, then try again. Your words are safe in the inbox.</>;
  }
}
