// The capsule once words are saved to the inbox, and not filed yet: the person's words on a card, over a bar that says Saved. Hide is
// its only button. A screen comment's card is labelled with the app and holds its screenshot, its page's title and its address.
import { Card, Row, Stack, Text } from "@avanzel/ui";
import { useStampDate } from "../common/use-stamp-date.ts";
import type { StateOf } from "./api.ts";
import { Hide } from "./hide.tsx";
import type { Scene } from "./scene.tsx";
import { Words } from "./words.tsx";

/**
 * A thought saved for the evening review is stamped Saved, and the card says where it is (`note`, main's words: when the review
 * files it, or only that it is in the inbox while the review is off), then a line about its recording, if there is one (`detail`).
 * A screen comment holds a screenshot as well, at the side of the page's title and address, over the note; its words are cut off
 * after three lines to leave them room (the stamp takes the first line's end, so words that fill two lines without it need a third),
 * or after two when the card has a line about the recording too (`detail`), which may take two lines of its own and leaves the panel no
 * room for a third. A comment with no words says so. Words whose filing was undone (`undone`) are not stamped: the filing that would be
 * is gone, and the card says they are in the inbox again.
 *
 * The screenshot has no frame (owner item 16: on white paper a white page has no edge, which a framed thumbnail in `packages/ui`
 * would give it).
 */
export function savedScene(state: StateOf<"saved">): Scene {
  return {
    card: <SavedCard state={state} />,
    bar: { mood: "filed", line: state.undone ? "Undone" : "Saved", actions: <Hide /> },
  };
}

function SavedCard({ state }: { state: StateOf<"saved"> }) {
  const day = useStampDate(); // the day the card came, not the day it is redrawn
  const screen = state.thumbnail !== undefined || state.context !== undefined;
  const app = state.context?.app;
  const title = state.context?.title;
  const address = state.context?.url?.replace(/^https?:\/\//, "");
  return (
    <Card
      look="panel"
      label={screen ? (app ?? "Screen") : "Thought"}
      placeholder="No comment"
      stamp={state.undone ? undefined : { word: "saved", date: day }}
      footer={
        <Stack gap={8}>
          {(state.thumbnail !== undefined || title || address) && (
            <Row gap={12} align="start">
              {state.thumbnail !== undefined && <img className="shot" src={state.thumbnail} alt={app ? `Screenshot of ${app}` : "Screenshot"} />}
              <div className="context">
                <Stack gap={2}>
                  {title && <Text variant="caption" truncate>{title}</Text>}
                  {address && <Text variant="caption" tone="secondary" truncate>{address}</Text>}
                </Stack>
              </div>
            </Row>
          )}
          <Stack gap={4}>
            <Text variant="footnote">{state.note}</Text>
            {state.detail && <Text variant="footnote" tone="secondary">{state.detail}</Text>}
          </Stack>
        </Stack>
      }
    >
      {state.text ? <Words lines={screen ? (state.detail ? 2 : 3) : 4}>{state.text}</Words> : null}
    </Card>
  );
}
