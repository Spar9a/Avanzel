// What the capsule's cards share: the bar's Hide button, the person's words as a card sets them, and a clock to count seconds by.
import { Button } from "@avanzel/ui";
import { useEffect, useState } from "react";

const api = window.avanzel.capsule;

/**
 * Hide, the first button of the bar of every card that is not a problem: a quiet icon that puts the card away. Whatever work the
 * card was about goes on (a filing ends in its notification).
 */
export function Hide() {
  return <Button variant="quiet" size="small" icon="close" label="Hide" onClick={() => api.dismiss()} />;
}

/**
 * The person's words as a card sets them: their line breaks kept, and cut off after four lines, where the panel has no more room
 * (the layout's max height, owner item 11). The words are cut here, not the whole card, so that its footer, which holds what the
 * agent is doing, always shows. All the words are in the page, for a screen reader and for selecting.
 */
export function Words({ children }: { children: string }) {
  return <div className="words">{children}</div>;
}

/** The time now, read again every `ms`: for a card that counts seconds. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
