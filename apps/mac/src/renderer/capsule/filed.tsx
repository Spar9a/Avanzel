// The capsule once a filing ends well: the person's words on a card, stamped, over a bar that says who filed them and how long it
// took, with Hide, Undo and Open. Nothing here ticks: the bar is a live region, and its one line stays the same.
import { Button, CapsuleBar, Card, Text } from "@avanzel/ui";
import { useState } from "react";
import { useStampDate } from "../common/use-stamp-date.ts";
import { api, type StateOf } from "./api.ts";
import { filedLine, notedLine } from "./copy.ts";
import { Hide } from "./hide.tsx";
import { Pages } from "./pages.tsx";
import { Words } from "./words.tsx";

/**
 * A filing that wrote pages is stamped Filed, lands with a thunk, and lists the pages under the words, which are cut off after two
 * lines to leave them room. The bar offers Hide, Undo while the filing has a commit to take back, and Open, the moment's one primary,
 * which opens the first page. Undo is busy from its press, as Stop is on the filing card: the card is replaced by what came of it.
 *
 * A filing that wrote no page (`noted`: the agent logged the capture and found nothing to add) says there is nothing new, stamped
 * Noted, and offers no Open: Hide, and Undo while there is a commit.
 */
export function Filed({ state }: { state: StateOf<"filed"> }) {
  const day = useStampDate(); // the day the card came, not the day it is redrawn
  const [undoing, setUndoing] = useState(false); // Undo answers once: busy from the press until the card is replaced by what came of it
  const receipt = !state.noted && state.pages.length > 0;
  return (
    <div className="stack">
      <Card
        label="Thought"
        stamp={state.noted ? { word: "noted", date: day } : { word: "filed", date: day, animate: true }}
        footer={state.noted ? <Text variant="footnote">{notedLine(state.agent)}</Text> : receipt ? <Pages pages={state.pages} /> : undefined}
      >
        <Words lines={receipt ? 2 : 4}>{state.text}</Words>
      </Card>
      <CapsuleBar
        mood="filed"
        actions={
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
            {receipt && <Button size="small" variant="primary" onClick={() => api.open()}>Open</Button>}
          </>
        }
      >
        {state.noted ? "Nothing new to file" : filedLine(state.agent, state.seconds)}
      </CapsuleBar>
    </div>
  );
}
