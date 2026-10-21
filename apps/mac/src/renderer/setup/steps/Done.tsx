// Step 6, You're all set: how to talk to Avanzel from now on, and where it waits, beside Zel at rest. Two switches apply
// at once, as Settings' own do: opening at login, which this step turned on the first time it showed, and the library's
// evening review, which isn't there when the library has none. Each comes back through setup:changed. Start using
// Avanzel ends setup; there is no Back.
import { Button, Group, Kbd, Stack, Switch, Text, Zel } from "@avanzel/ui";
import { prettyAccelerator } from "../../../main/shortcuts.ts";
import { reviewLabel } from "../copy.ts";
import { Frame, type StepProps } from "../frame.tsx";

const { setup, settings } = window.avanzel;

export function Done({ snap }: StepProps) {
  const review = snap.eveningReview;
  return (
    <Frame
      model={snap.model}
      stage={
        <div className="done">
          <Zel mood="idle" size="large" />
        </div>
      }
      actions={<Button variant="primary" onClick={() => setup.finish()}>Start using Avanzel</Button>}
    >
      <Stack gap={12}>
        <Text variant="heading">You're all set.</Text>
        <Text variant="callout">
          Press <Kbd>{prettyAccelerator(snap.shortcut)}</Kbd> anywhere to talk to me. I'll wait in the menu bar.
        </Text>
        <Group>
          <Switch label="Open Avanzel when I log in" checked={snap.launchAtLogin} onChange={(on) => void settings.setApp({ launchAtLogin: on })} />
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
      </Stack>
    </Frame>
  );
}
