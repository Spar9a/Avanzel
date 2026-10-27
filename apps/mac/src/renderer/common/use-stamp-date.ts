// The day a card's stamp prints, taken once per card, for the capsule's cards that stamp one (Filed and Saved). The day as a stamp prints
// it (`stampDate`) is stamp.ts's, which knows nothing of React, so that setup's copy and its node tests import none.
import { useState } from "react";
import { stampDate } from "./stamp.ts";

/** The day a card came, as its stamp prints it: taken once, when the card is first drawn, so that a redraw never changes it or plays the stamp again. */
export function useStampDate(): string {
  const [day] = useState(() => stampDate(new Date()));
  return day;
}
