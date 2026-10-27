// Step 6, You're all set: how to talk to Avanzel from now on, and where it waits, beside Zel at rest. Until the speech
// model is ready, it promises no talking: it says why it can't hear yet, as the first-thought step does, and how to
// type a thought instead (Type a thought's shortcut while it works, else the menu bar's Type a thought…). Three switches
// apply at once, as Settings' own do: opening at login, which this step turned on the first time it showed, Play sounds,
// which is off until the person turns it on, and the library's evening review, which isn't there when the library has
// none. Each comes back through setup:changed. Preview sounds plays the sounds whatever the setting; it sits below the
// Group, since a Group draws only its direct children as rows and a Switch has no place for a button of its own. Start
// using Avanzel ends setup (`finish`): the window flies into the menu bar. There is no Back.
import { Actions, Button, Group, Kbd, Stack, Switch, Text, Zel } from "@avanzel/ui";
import { prettyAccelerator } from "../../../main/shortcuts.ts";
import { playSound, previewSounds, releaseSounds } from "../../common/sounds.ts";
import { earsLine, reviewLabel } from "../copy.ts";
import { Frame, type StepProps } from "../frame.tsx";

const { settings } = window.avanzel;

export function Done({ snap, finish }: StepProps & { finish(): void }) {
  const review = snap.eveningReview;
  const ears = snap.hears ? null : earsLine(snap.model);
  return (
    <Frame
      model={snap.model}
      stage={
        <div className="done">
          {/* Zel looks over at the step. */}
          <Zel mood="idle" size="large" look="right" />
        </div>
      }
      actions={<Button variant="primary" onClick={() => finish()}>Start using Avanzel</Button>}
    >
      <Stack gap={12}>
        <Text variant="heading">You're all set.</Text>
        {snap.hears ? (
          <Text variant="callout">
            Press <Kbd>{prettyAccelerator(snap.shortcut)}</Kbd> anywhere to talk to me. I'll wait in the menu bar.
          </Text>
        ) : (
          <>
            {ears && <Text variant="callout">{ears}</Text>}
            {/* Type a thought's shortcut, while it works; else the menu bar's Type a thought…, which always does. */}
            {snap.typeShortcut ? (
              <Text variant="callout">
                Press <Kbd>{prettyAccelerator(snap.typeShortcut)}</Kbd> anywhere to type a thought. I'll wait in the menu bar.
              </Text>
            ) : (
              <Text variant="callout">Choose Type a thought… in the menu bar to type one. I'll wait there.</Text>
            )}
          </>
        )}
        <Group>
          <Switch label="Open Avanzel when I log in" checked={snap.launchAtLogin} onChange={(on) => void settings.setApp({ launchAtLogin: on })} />
          <Switch
            label="Play sounds"
            checked={snap.sounds}
            // Once saved: the Stamp says that they are on, so it isn't played for a change that wasn't kept. Off lets go of the audio device.
            onChange={(sounds) => void settings.setApp({ sounds }).then(() => (sounds ? playSound("stamp") : releaseSounds()))}
          />
          {review && (
            <Switch
              label={reviewLabel(review.schedule)}
              description="Files anything still in the inbox and writes a short summary."
              checked={review.enabled}
              onChange={(enabled) => {
                const { id, name, schedule, agent, instructions } = review;
                void settings.saveTask({ id, name, schedule, agent, enabled, instructions });
              }}
            />
          )}
        </Group>
        <Actions align="start">
          <Button size="small" variant="secondary" onClick={() => previewSounds()}>Preview sounds</Button>
        </Actions>
      </Stack>
    </Frame>
  );
}
