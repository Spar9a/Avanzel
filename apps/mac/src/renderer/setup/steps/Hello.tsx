// Step 1, Hello: Zel wakes up and stamps hello on an empty card, then says what Avanzel does. The wake and the stamp
// are the step's one orchestrated moment; under Reduce Motion they are there from the start.
import { Button, Card, Kbd, Row, Stack, Text, Zel } from "@avanzel/ui";
import { useEffect, useState } from "react";
import { prettyAccelerator } from "../../../main/shortcuts.ts";
import { stampDate } from "../copy.ts";
import { Frame, type StepProps } from "../frame.tsx";

/** When Zel wakes, and when the stamp lands. */
const WAKE_MS = 900;
const STAMP_MS = 1600;

export function Hello({ snap, go }: StepProps) {
  const [still] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [today] = useState(() => new Date());
  const [awake, setAwake] = useState(still);
  const [stamped, setStamped] = useState(still);
  useEffect(() => {
    if (still) return;
    const timers = [setTimeout(() => setAwake(true), WAKE_MS), setTimeout(() => setStamped(true), STAMP_MS)];
    return () => timers.forEach(clearTimeout);
  }, [still]);
  return (
    <Frame
      model={snap.model}
      stage={
        <div className="hello">
          {/* The stamp lands in the card's own corner, as Filing's does, and carries the day, so the card's header
              has no date of its own. */}
          <Card label="Thought" placeholder="Nothing here yet." stamp={stamped ? { word: "hello", date: stampDate(today), animate: !still } : undefined} />
          {/* Zel looks up at the card it stamps. */}
          <Row justify="end">
            <Zel mood={awake ? "idle" : "asleep"} size="medium" look="up" />
          </Row>
        </div>
      }
      actions={<Button variant="primary" size="large" onClick={() => go("found")}>Set me up</Button>}
    >
      <Stack gap={12}>
        <Text variant="heading" focusable>Hi, I'm Zel.</Text>
        <Text variant="callout">
          Talk to me anytime with <Kbd>{prettyAccelerator(snap.shortcut)}</Kbd>. I write each thought on a card and file it in a library of plain notes on your Mac.
        </Text>
      </Stack>
    </Frame>
  );
}
