// A screen comment's screenshot on a card of its own, above the bar, for as long as the comment is heard and its words are made.
import { Card } from "@avanzel/ui";
import type { ScreenContext } from "../../shared/ipc.ts";

/**
 * A card labelled with the app the screen is of, holding the thumbnail. It has no ruling: it holds no words. The state that listens
 * and the state that transcribes draw this one card, in the same place, so it stays where it is between them, as large as it was;
 * the saved card that follows shows the screenshot smaller, in its footer (owner item 16).
 */
export function ScreenshotCard({ thumbnail, context }: { thumbnail: string; context?: ScreenContext }) {
  const app = context?.app;
  return (
    <Card look="panel" label={app ?? "Screen"} ruled={false}>
      <img className="thumbnail" src={thumbnail} alt={app ? `Screenshot of ${app}` : "Screenshot"} />
    </Card>
  );
}
