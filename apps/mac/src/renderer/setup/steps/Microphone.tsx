// Step 3, Can I hear you?: the microphone's permission, asked behind one Continue before the first thought, so macOS's own
// prompt comes with the reason on screen. The step shows only while macOS hasn't allowed the microphone. Continue has macOS
// ask; a grant moves on to the first thought. A microphone turned down says where to allow it, and Skip goes on to typing.
// Skip before macOS has asked leaves that to the first thought's own primer, at the first press. Back from the first thought
// lands here until it is allowed, and then the step says so, with Continue.
import { Button, Kbd, Notice, Stack, Text, Zel } from "@avanzel/ui";
import { useState } from "react";
import { prettyAccelerator } from "../../../main/shortcuts.ts";
import { Frame, type StepProps } from "../frame.tsx";

const api = window.avanzel.setup;

export function Microphone({ snap, go }: StepProps) {
  const status = snap.permissions.microphone;
  const [asking, setAsking] = useState(false);
  const turnedDown = status === "denied" || status === "restricted";
  const ask = () => {
    if (asking) return;
    setAsking(true);
    const done = () => setAsking(false);
    void api.askForMicrophone().then((next) => {
      done();
      if (next === "granted") go("think");
    }, done);
  };
  const on = status === "granted";
  let actions;
  if (on) {
    actions = <Button variant="primary" onClick={() => go("think")}>Continue</Button>;
  } else if (turnedDown) {
    actions = (
      <>
        <Button variant="quiet" onClick={() => go("think")}>Skip</Button>
        <Button variant="primary" onClick={() => window.avanzel.settings.openPrivacy("microphone")}>Open System Settings</Button>
      </>
    );
  } else {
    actions = (
      <>
        <Button variant="quiet" onClick={() => go("think")}>Skip</Button>
        <Button variant="primary" onClick={ask}>Continue</Button>
      </>
    );
  }
  return (
    <Frame
      model={snap.model}
      stage={
        <div className="permission">
          <Zel mood={turnedDown ? "needs-you" : "idle"} size="large" look="right" />
        </div>
      }
      actions={actions}
    >
      <Stack gap={12}>
        <Text variant="heading" focusable>{on ? "I can hear you." : "Can I hear you?"}</Text>
        {on ? (
          <Text variant="callout">
            Press <Kbd>{prettyAccelerator(snap.shortcut)}</Kbd> anywhere to talk to me.
          </Text>
        ) : (
          <Text variant="callout">
            Next, macOS asks about the microphone. I listen only while you can see me listening, and your voice becomes text on this Mac.
          </Text>
        )}
        {turnedDown && (
          <Notice tone="error" title="Avanzel can't hear you yet.">
            Allow it in System Settings, under Microphone. Until then, you can type your thoughts.
          </Notice>
        )}
        {!on && !turnedDown && <Text variant="footnote" tone="secondary">Skip, and I'll ask the first time you talk to me.</Text>}
      </Stack>
    </Frame>
  );
}
