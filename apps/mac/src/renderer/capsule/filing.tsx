// The capsule while an agent files the words: the filing card (`FilingCard`, which the panel's Capture shows too), with Hide as the
// card's close button in its corner.
import { FilingCard } from "../common/filing-card.tsx";
import { api, type StateOf } from "./api.ts";
import type { Scene } from "./scene.tsx";
import { Words } from "./words.tsx";

export { filingProgress } from "../common/filing-card.tsx";

/** The card, and no bar: everything a filing shows and offers is on the card (`FilingCard`). */
export function filingScene(state: StateOf<"filing">): Scene {
  return {
    card: (
      <FilingCard
        state={state}
        words={<Words>{state.text}</Words>}
        onEdit={() => api.edit()}
        onStop={() => api.cancelFiling()}
        onClose={() => api.dismiss()}
      />
    ),
  };
}
