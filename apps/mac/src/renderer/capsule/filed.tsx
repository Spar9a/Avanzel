// The capsule once a filing ends well: one card of paper with the person's words, stamped, and in its foot who filed them and how long
// it took, with Undo and Open at its right and Hide in its corner; and, when the librarian suggests a new shelf, the question under the
// pages. The panel's Processing tab draws the same card. Nothing here ticks.
import { Actions, Button, Card, Stack, Text } from "@avanzel/ui";
import { useState } from "react";
import type { ShelfAsk } from "../../shared/ipc.ts";
import { stampDate } from "../common/stamp.ts";
import { useStampDate } from "../common/use-stamp-date.ts";
import { api, type StateOf } from "./api.ts";
import { agentShelfLine, EDIT_FIRST, filedLine, MAKE_SHELF, NOT_NOW, notedLine, SAY_NO, shelfAskLine } from "./copy.ts";
import { Pages } from "./pages.tsx";
import type { Scene } from "./scene.tsx";
import { Words } from "./words.tsx";

/** Whether the filing wrote pages to list: a filing that only noted its capture (`noted`) wrote none, and has no receipt. */
const hasReceipt = (state: StateOf<"filed">) => !state.noted && state.pages.length > 0;

/**
 * A filing that wrote pages is stamped Filed, lands with a thunk, and lists the pages under the words, which are cut off after three
 * lines to leave them room: the stamp stands where the first line would run on, so words that fill two lines on the filing card, which
 * has none, need a third here. The bar offers Hide, Undo while the filing has a commit to take back, and Open, the moment's one primary,
 * which opens the first page. Undo is busy from its press, as Stop is on the filing card: the card is replaced by what came of it.
 *
 * A filing that wrote no page (`noted`: the agent logged the capture and found nothing to add) says there is nothing new, stamped
 * Noted, and offers no Open: Hide, and Undo while there is a commit.
 *
 * Either card, when the agent had changed the capture and the engine put the person's words back (`restored`), says so in its head, in
 * the caption slot beside the label: "Your exact words are kept." The stamp, the footer and the words' lines stay as they are. Said of
 * words, so only when there are some: the engine puts a capture back whenever the agent changed its file, an annotated screenshot with no
 * comment included, and a card that says "No comment" does not also say its words are kept.
 *
 * "Show the last receipt" puts the same card up again (`reprint`): a filing that ended some time ago is not being stamped now, so the stamp
 * is still, and prints the day the thought was filed and not today's. Everything else on the card and the bar is as it was. A reprint of a
 * capture with no words (a note dropped into the inbox by hand with none, or an archive that can't be read) says "No comment" on its card
 * as a Saved card with no words does, and not a blank ruled sheet, which in a product that keeps the person's exact words would read as
 * words that were lost. A card a filing puts up always has words.
 */
export function filedScene(state: StateOf<"filed">): Scene {
  return { card: <FiledCard state={state} /> };
}

/**
 * One card that holds it all: the words, stamped; in its foot what came of them ("No note was made. Claude Code noted it in the log.",
 * or who filed them and the pages), with Undo and Open at its right; Hide is its close button in the corner. The foot's first line is a
 * live region, so VoiceOver hears how the filing ended.
 */
function FiledCard({ state }: { state: StateOf<"filed"> }) {
  const cameOn = useStampDate(); // the day the card came, not the day it is redrawn
  const day = state.reprint ? stampDate(new Date(state.reprint.filedAt)) : cameOn; // a reprint prints the day the thought was filed
  const receipt = hasReceipt(state);
  return (
    <Card
      look="panel"
      label="Thought"
      meta={state.restored && state.text ? "Your exact words are kept." : undefined}
      placeholder="No comment"
      stamp={state.noted ? { word: "noted", date: day } : { word: "filed", date: day, animate: !state.reprint }}
      onClose={() => api.dismiss()}
      footer={
        <Stack gap={6}>
          <span role="status">
            <Text variant="footnote" tone={state.noted ? "default" : "secondary"}>
              {state.noted ? `No note was made. ${notedLine(state.agent)}` : filedLine(state.agent, state.seconds)}
            </Text>
          </span>
          {receipt && <Pages pages={state.pages} />}
          {state.suggestion && <ShelfQuestion ask={state.suggestion} opens={receipt} />}
        </Stack>
      }
      actions={<FiledActions state={state} />}
    >
      {state.text ? <Words lines={receipt ? 3 : 4}>{state.text}</Words> : null}
    </Card>
  );
}

/**
 * The question under the pages, when the librarian suggests a new shelf for them (`suggestion`): its name, and under it, quieter, the
 * definition that would go into AGENTS.md, so the owner reads it before saying yes; then Not now (the card goes, and Library keeps asking)
 * and Make shelf, which is the moment's primary only when the card has no Open (`opens`). Make shelf is busy from its press until the card
 * is replaced by what came of it, as Undo is. A folder the agent started on its own has no definition yet: the card says so, and offers No
 * (turn it down) and Edit first, which opens Settings' shelf form on it to say what belongs there.
 */
function ShelfQuestion({ ask, opens }: { ask: ShelfAsk; opens: boolean }) {
  const [answer, setAnswer] = useState<"make" | "no" | null>(null);
  const yes = opens ? "secondary" : "primary";
  return (
    <Stack gap={6}>
      {ask.agentMade ? (
        <Text variant="footnote">{agentShelfLine(ask.folder)}</Text>
      ) : (
        <Stack gap={2}>
          <Text variant="footnote">{shelfAskLine(ask.name)}</Text>
          <Text variant="footnote" tone="secondary">{ask.definition}</Text>
        </Stack>
      )}
      {ask.agentMade ? (
        <Actions align="start">
          <Button
            size="small"
            variant="quiet"
            busy={answer === "no"}
            onClick={() => {
              setAnswer("no");
              api.declineShelf();
            }}
          >
            {SAY_NO}
          </Button>
          <Button size="small" variant={yes} disabled={answer !== null} onClick={() => window.avanzel.settings.openShelfDraft(ask)}>{EDIT_FIRST}</Button>
        </Actions>
      ) : (
        <Actions align="start">
          <Button size="small" variant="quiet" disabled={answer !== null} onClick={() => api.shelfLater()}>{NOT_NOW}</Button>
          <Button
            size="small"
            variant={yes}
            busy={answer === "make"}
            onClick={() => {
              setAnswer("make");
              api.makeShelf();
            }}
          >
            {MAKE_SHELF}
          </Button>
        </Actions>
      )}
    </Stack>
  );
}

/**
 * The card's buttons. Undo answers once: it is busy from its press until the card is replaced by what came of it, and that is held here,
 * in the buttons' own state, which ends with them when the card is the next state's.
 */
function FiledActions({ state }: { state: StateOf<"filed"> }) {
  const [undoing, setUndoing] = useState(false);
  if (!state.canUndo && !hasReceipt(state)) return null;
  return (
    <>
      {state.canUndo && (
        <Button
          size="regular"
          busy={undoing}
          onClick={() => {
            setUndoing(true);
            api.undo();
          }}
        >
          Undo
        </Button>
      )}
      {hasReceipt(state) && <Button size="regular" variant="primary" onClick={() => api.open()}>Open</Button>}
    </>
  );
}
