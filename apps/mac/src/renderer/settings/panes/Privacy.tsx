// Settings → Privacy: the two permissions Avanzel asks macOS for, each with what it is for and where it stands, and what
// leaves this Mac. Allow…, Open System Settings and Quit and reopen act at once. The pane needs no library, and follows
// System Settings: main sends it a fresh snapshot whenever Settings has the focus again.
import { Button, Group, GroupRow, Row, Stack, Text } from "@avanzel/ui";
import type { ReactNode } from "react";
import type { PermissionStatus } from "../../../shared/ipc.ts";
import { attemptChange, type PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** A permission Avanzel asks macOS for: the microphone, or Screen Recording ("screen", as the bridge names it). */
type Permission = "microphone" | "screen";

interface PermissionRowProps extends Pick<PaneProps, "onChange" | "attempt"> {
  kind: Permission;
  /** The row's name, which also names its group of controls. */
  label: string;
  /** What the permission is for. */
  description: string;
  status: PermissionStatus;
}

/**
 * One permission's row: what it is for, and a control that says where it stands. It is Allowed once macOS has allowed it;
 * Allow…, for the microphone while macOS hasn't asked; and otherwise Open System Settings, where the person turns it on.
 * Screen recording never offers Allow…: Electron can't tell its "never asked" from "denied". It offers Quit and reopen
 * beside Open System Settings, since macOS applies its grant only when Avanzel starts again; both are secondary, as neither
 * is the one fix of a problem. The control is a group named for the row, so VoiceOver says which permission it belongs to,
 * and tests find it by that name.
 */
function PermissionRow({ kind, label, description, status, onChange, attempt }: PermissionRowProps): ReactNode {
  return (
    <GroupRow label={label} description={description}>
      <div role="group" aria-label={label}>
        {status === "granted" ? (
          <Text variant="footnote" tone="ok">Allowed</Text>
        ) : kind === "microphone" && status === "not-determined" ? (
          <Button size="small" variant="secondary" onClick={() => attemptChange({ onChange, attempt }, () => api.requestPermission("microphone"))}>Allow…</Button>
        ) : (
          <Row gap={8}>
            <Button size="small" variant="secondary" onClick={() => api.openPrivacy(kind)}>Open System Settings</Button>
            {kind === "screen" && <Button size="small" variant="secondary" onClick={() => api.relaunch()}>Quit and reopen</Button>}
          </Row>
        )}
      </div>
    </GroupRow>
  );
}

/** The Privacy pane: the permissions, and what leaves this Mac. */
export function Privacy({ snap, onChange, attempt }: PaneProps): ReactNode {
  return (
    <Stack gap={20}>
      <Group label="Permissions" note="After you allow screen recording, quit and reopen Avanzel: macOS applies it only then.">
        <PermissionRow
          kind="microphone"
          label="Microphone"
          description="Only while the capsule shows it listening."
          status={snap.permissions.microphone}
          onChange={onChange}
          attempt={attempt}
        />
        <PermissionRow
          kind="screen"
          label="Screen recording"
          description="Needed only to capture the screen with a comment."
          status={snap.permissions.screen}
          onChange={onChange}
          attempt={attempt}
        />
      </Group>
      <Group label="What leaves this Mac">
        {/* Not a row: a paragraph, in a box of the window's own, padded as a row is. */}
        <div className="settings-words">
          <Text variant="callout">
            Your voice never leaves this Mac. Your words, and any screen you capture with a comment, go only to the agent you
            chose, the same way your code already does.
          </Text>
        </div>
      </Group>
    </Stack>
  );
}
