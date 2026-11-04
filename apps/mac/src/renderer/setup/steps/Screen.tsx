// Step 7, Can I see your screen?: Screen Recording's permission, after the first thought has been filed and asked about, as
// capturing the screen with a comment is the one thing that needs it. The step shows only while macOS hasn't allowed it.
// macOS has no prompt to answer: Open System Settings opens the Screen Recording pane (after one capture that makes macOS
// list Avanzel there), where the person turns it on. macOS applies the grant only when Avanzel starts again, so the end of
// setup reopens Avanzel once, which the step and the last step say. Skip goes on without it; Settings, under Privacy, has it later.
import { Button, Notice, Stack, Text, Zel } from "@avanzel/ui";
import { Frame, type StepProps } from "../frame.tsx";

const api = window.avanzel.setup;

export function Screen({ snap, go }: StepProps) {
  const on = snap.permissions.screen === "granted";
  const opened = snap.screenOpened;
  let actions;
  if (on || opened) {
    actions = <Button variant="primary" onClick={() => go("done")}>Continue</Button>;
  } else {
    actions = (
      <>
        <Button variant="quiet" onClick={() => go("done")}>Skip</Button>
        <Button variant="primary" onClick={() => api.openScreenSettings()}>Open System Settings</Button>
      </>
    );
  }
  return (
    <Frame
      model={snap.model}
      stage={
        <div className="permission">
          <Zel mood="idle" size="large" look="right" />
        </div>
      }
      actions={actions}
    >
      <Stack gap={12}>
        <Text variant="heading" focusable>{on ? "Screen recording is on." : "Can I see your screen?"}</Text>
        {on ? (
          <Text variant="callout">{opened ? "macOS applies it when I start again, so I'll reopen once you finish." : "I look only when you capture the screen with a comment."}</Text>
        ) : (
          <Text variant="callout">
            I look at the screen only when you capture it with a comment, and the picture goes to your agent with your words.
          </Text>
        )}
        {opened && !on && (
          <Notice
            title="Turn on Avanzel under Screen Recording."
            actions={<Button size="small" onClick={() => api.openScreenSettings()}>Open System Settings</Button>}
          >
            macOS applies it when I start again, so I'll reopen once you finish.
          </Notice>
        )}
        {!on && !opened && <Text variant="footnote" tone="secondary">Skip, and you can allow it later in Settings, under Privacy.</Text>}
      </Stack>
    </Frame>
  );
}
