// The time now, read again every `ms`: what a card that counts seconds is drawn from. The capsule's cards use this one; setup's frame
// and Ask's window each keep a copy of it for now.
import { useEffect, useState } from "react";

/** `ms` is how often the time is read again; null is never (nothing ticks, and the time is that of the last read). */
export function useNow(ms: number | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (ms === null) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
