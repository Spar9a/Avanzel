// Settings → Privacy: the two permissions Avanzel asks macOS for, each with what it is for and where it stands, and what
// leaves this Mac. Allow… and Open System Settings act at once. The pane needs no library.
import { Button, Group, GroupRow, Stack, Text } from "@avanzel/ui";
import type { ReactNode } from "react";
import type { PermissionStatus } from "../../../shared/ipc.ts";
import type { PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** A permission Avanzel asks macOS for: the microphone, or Screen Recording ("screen", as the bridge names it). */
type Permission = "microphone" | "screen";

interface PermissionRowProps {
  kind: Permission;
  /** The row's name, which also names its group of controls. */
  label: string;
  /** What the permission is for. */
  description: string;
  status: PermissionStatus;
  onChange: PaneProps["onChange"];
}

/**
 * One permission's row: what it is for, and a control that says where it stands. It is Allowed once macOS has allowed it;
 * Allow…, for the microphone while macOS hasn't asked; and otherwise Open System Settings, where the person turns it on.
 * Screen recording never offers Allow…: Electron can't tell its "never asked" from "denied". The control is a group named
 * for the row, so VoiceOver says which permission it belongs to, and tests find it by that name.
 */
function PermissionRow({ kind, label, description, status, onChange }: PermissionRowProps): ReactNode {
  return (
    <GroupRow label={label} description={description}>
      <div role="group" aria-label={label}>
        {status === "granted" ? (
          <Text variant="footnote" tone="ok">Allowed</Text>
        ) : kind === "microphone" && status === "not-determined" ? (
          <Button size="small" variant="secondary" onClick={async () => onChange(await api.requestPermission("microphone"))}>Allow…</Button>
        ) : (
          <Button size="small" variant="secondary" onClick={() => api.openPrivacy(kind)}>Open System Settings</Button>
        )}
      </div>
    </GroupRow>
  );
}

/** The Privacy pane: the permissions, and what leaves this Mac. */
export function Privacy({ snap, onChange }: PaneProps): ReactNode {
  return (
    <Stack gap={20}>
      <Group label="Permissions" note="After you allow screen recording, quit and reopen Avanzel: macOS applies it only then.">
        <PermissionRow
          kind="microphone"
          label="Microphone"
          description="Only while the capsule shows it listening."
          status={snap.permissions.microphone}
          onChange={onChange}
        />
        <PermissionRow
          kind="screen"
          label="Screen recording"
          description="Needed only to capture the screen with a comment."
          status={snap.permissions.screen}
          onChange={onChange}
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
