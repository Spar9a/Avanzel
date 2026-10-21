// Step 3, What's on your mind this week?: the first thought. Here setup tests the shortcut with a real press. The stage
// draws it as keycaps, which press themselves twice as a hint each time the step opens: the step's one orchestrated
// moment, which Reduce Motion leaves out, the keycaps up from the start. A press says the shortcut is free. One another
// app holds is named at once, and with no press within the wait the step asks whether it did nothing; both offer free
// ones to use instead, or Settings → Voice when none is free. Zel waits on the stage. Recording the thought comes later.
import { Actions, Button, Card, Kbd, Notice, Row, Stack, Text, Zel } from "@avanzel/ui";
import { useEffect, useState } from "react";
import { keyCaps, prettyAccelerator, takenMessage } from "../../../main/shortcuts.ts";
import type { SetupPress } from "../../../shared/ipc.ts";
import { Frame, type StepProps } from "../frame.tsx";

const api = window.avanzel.setup;

/**
 * The keycaps' self-press, beat by beat: down at 700 ms for 200 ms, and again at 1600 ms. Each beat starts once the
 * one before it is drawn, so a busy Mac still shows both presses.
 */
const BEATS = [700, 200, 700, 200] as const;

export function Think({ snap, go }: StepProps) {
  const [still] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (still || beat >= BEATS.length) return;
    const timer = setTimeout(() => setBeat(beat + 1), BEATS[beat]);
    return () => clearTimeout(timer);
  }, [still, beat]);
  const { press } = snap;
  // The odd beats are down. Once a press is heard the hint has done its work, and the keycaps stay up.
  const pressed = !still && !press.heard && beat % 2 === 1;
  const shortcut = prettyAccelerator(snap.shortcut);
  return (
    <Frame
      model={snap.model}
      stage={
        <div className="think">
          <Card label="Thought" placeholder="Your words will appear here." />
          <Row gap={6} justify="center">
            {keyCaps(snap.shortcut).map((cap, i) => (
              <Kbd key={i} size="key" pressed={pressed}>{cap}</Kbd>
            ))}
          </Row>
          <Row justify="end">
            <Zel mood="idle" size="medium" />
          </Row>
        </div>
      }
      actions={<Button variant="quiet" onClick={() => go("found")}>Back</Button>}
    >
      <Stack gap={12}>
        <Text variant="heading">What's on your mind this week?</Text>
        <Text variant="callout">
          Press <Kbd>{shortcut}</Kbd>, ramble for half a minute, then press it again. I'll sort it out.
        </Text>
        <Text variant="footnote" tone="secondary">If you're stuck, try a goal, someone you work with, or an idea you keep coming back to.</Text>
        {press.heard && <Text variant="footnote" tone="secondary">{`${shortcut} is free on this Mac, so it works in every app. Esc cancels.`}</Text>}
        <PressNotice press={press} accelerator={snap.shortcut} />
      </Stack>
    </Frame>
  );
}

/**
 * The Notice of a shortcut that may not work: another app holds it (an error), or no press arrived within the wait, so
 * another app may hold it though it registered. Each offers the free ones, the best last as the primary, or Settings →
 * Voice when none is free. Nothing while the shortcut works or the step still waits for a press.
 */
function PressNotice({ press, accelerator }: { press: SetupPress; accelerator: string }) {
  if (!press.taken && !press.silent) return null;
  const free = press.alternatives.length > 0;
  const actions = (
    <Actions align="start">
      {free ? (
        press.alternatives
          .map((alternative, i) => (
            <Button key={alternative} size="small" variant={i === 0 ? "primary" : "secondary"} onClick={() => void api.useShortcut(alternative)}>
              {`Use ${prettyAccelerator(alternative)}`}
            </Button>
          ))
          .reverse()
      ) : (
        <Button size="small" variant="primary" onClick={() => window.avanzel.capsule.openSettingsFor("open-settings:voice")}>
          Open Settings
        </Button>
      )}
    </Actions>
  );
  if (press.taken) {
    return (
      <Notice tone="error" title={takenMessage(accelerator, press.holder)} actions={actions}>
        {free ? "Pick another shortcut." : "Pick another one in Settings → Voice."}
      </Notice>
    );
  }
  // With none free, the way out is Settings, and the holder isn't named.
  const maybe = `Another app may be using it${free && press.holder ? `, probably ${press.holder}` : ""}.`;
  return (
    <Notice title={`Did ${prettyAccelerator(accelerator)} do nothing?`} actions={actions}>
      {free ? `${maybe} Try another shortcut.` : `${maybe} Pick another one in Settings → Voice.`}
    </Notice>
  );
}
