// The capsule once a filing ends well: the person's words on a card, stamped, over a bar that says who filed them and how long it
// took, with Hide, Undo and Open. Nothing here ticks: the bar is a live region, and its one line stays the same.
import { Button, Card, Text } from "@avanzel/ui";
import { useState } from "react";
import { stampDate } from "../common/stamp.ts";
import { useStampDate } from "../common/use-stamp-date.ts";
import { api, type StateOf } from "./api.ts";
import { filedLine, notedLine } from "./copy.ts";
import { Hide } from "./hide.tsx";
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
  return {
    card: <FiledCard state={state} />,
    bar: {
      mood: "filed",
      line: state.noted ? "Nothing new to file" : filedLine(state.agent, state.seconds),
      actions: <FiledActions state={state} />,
    },
  };
}

function FiledCard({ state }: { state: StateOf<"filed"> }) {
  const cameOn = useStampDate(); // the day the card came, not the day it is redrawn
  const day = state.reprint ? stampDate(new Date(state.reprint.filedAt)) : cameOn; // a reprint prints the day the thought was filed
  const receipt = hasReceipt(state);
  return (
    <Card
      label="Thought"
      meta={state.restored && state.text ? "Your exact words are kept." : undefined}
      placeholder="No comment"
      stamp={state.noted ? { word: "noted", date: day } : { word: "filed", date: day, animate: !state.reprint }}
      footer={state.noted ? <Text variant="footnote">{notedLine(state.agent)}</Text> : receipt ? <Pages pages={state.pages} /> : undefined}
    >
      {state.text ? <Words lines={receipt ? 3 : 4}>{state.text}</Words> : null}
    </Card>
  );
}

/**
 * The bar's buttons. Undo answers once: it is busy from its press until the card is replaced by what came of it, and that is held here,
 * in the buttons' own state, which ends with them when the bar's buttons are the next state's.
 */
function FiledActions({ state }: { state: StateOf<"filed"> }) {
  const [undoing, setUndoing] = useState(false);
  return (
    <>
      <Hide />
      {state.canUndo && (
        <Button
          size="small"
          busy={undoing}
          onClick={() => {
            setUndoing(true);
            api.undo();
          }}
        >
          Undo
        </Button>
      )}
      {hasReceipt(state) && <Button size="small" variant="primary" onClick={() => api.open()}>Open</Button>}
    </>
  );
}
