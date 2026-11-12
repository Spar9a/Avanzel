// Settings → Privacy: everything about what Avanzel is allowed and what it keeps. The permissions it asks macOS for, each with what it is for and
// where it stands; the apps and sites whose dictations are kept nowhere; and what leaves this Mac. Allow…, Open System Settings and Quit and
// reopen act at once. The pane needs no library, but for the lists, and follows System Settings: main sends it a fresh snapshot whenever
// Settings has the focus again.
import { Button, Group, GroupRow, Row, Stack, Text } from "@avanzel/ui";
import { useState, type ReactNode } from "react";
import type { PermissionStatus } from "../../../shared/ipc.ts";
import { leavesThisMacLine, PERMISSION_NOT_ASKED, SKIP_APPS_HELP, skipAppsSummary, SKIP_NOTE, SKIP_SITES_HELP, skipSitesSummary } from "../copy.ts";
import { useCursorPermissions } from "../cursor-permissions.ts";
import { LinesField, type LibraryDrafts, type TextEdit } from "../lines-field.tsx";
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
          <Button
            size="small"
            variant="secondary"
            onClick={() => attemptChange({ onChange, attempt }, () => api.requestPermission("microphone"), PERMISSION_NOT_ASKED)}
          >
            Allow…
          </Button>
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

/**
 * A permission that dictating into any app needs: Allowed, or the button that asks macOS and opens where it is turned on. `granted` is null until
 * macOS has answered: the row is there, so the window keeps its height when the answer comes, and says nothing yet.
 */
function DictationPermissionRow({ label, description, granted, onAsk }: { label: string; description: string; granted: boolean | null; onAsk(): void }): ReactNode {
  return (
    <GroupRow label={label} description={description}>
      {granted !== null && (
        <div role="group" aria-label={label}>
          {granted ? <Text variant="footnote" tone="ok">Allowed</Text> : <Button size="small" variant="secondary" onClick={onAsk}>Open System Settings</Button>}
        </div>
      )}
    </GroupRow>
  );
}

/**
 * A list of what is never kept: the row says what the library keeps on it, and Edit… opens its list, with how an item is written and what it
 * can't promise. Each change is saved at once, and its draft is Settings'. An item main refuses is told by Settings, and the row goes on saying
 * what is really kept.
 */
function SkipRow({ label, summary, help, edit }: { label: string; summary: string; help: string; edit: TextEdit }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <GroupRow label={label} description={summary}>
        <div role="group" aria-label={label}>
          <Button size="small" variant="secondary" onClick={() => setOpen((now) => !now)}>{open ? "Done" : "Edit…"}</Button>
        </div>
      </GroupRow>
      {open && (
        <div className="settings-editor">
          <Stack gap={6}>
            <LinesField label={label} edit={edit} />
            <Text variant="footnote" tone="secondary">{help}</Text>
          </Stack>
        </div>
      )}
    </>
  );
}

/** The Privacy pane: the permissions, what is never kept, and what leaves this Mac. */
export function Privacy({ snap, onChange, attempt, drafts }: PaneProps & { drafts: LibraryDrafts }): ReactNode {
  const { state, ask } = useCursorPermissions(snap.app.cursorDictation.enabled);
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
        {/* A Mac that can't dictate into any app has no use for these, and says so once it has answered. */}
        {state?.available !== false && (
          <>
            <DictationPermissionRow label="Accessibility" description="To paste what you dictate." granted={state?.accessibility ?? null} onAsk={() => void ask("accessibility")} />
            <DictationPermissionRow label="Input Monitoring" description="To see the dictation key." granted={state?.inputMonitoring ?? null} onAsk={() => void ask("input-monitoring")} />
          </>
        )}
      </Group>
      {/* The lists are the library's: with none open, or one Avanzel can't find, there is nowhere to keep them. */}
      {snap.library?.exists && (
        <Group label="Never kept" note={SKIP_NOTE}>
          <SkipRow label="Apps to skip" summary={skipAppsSummary(snap.library.dictationSkipApps)} help={SKIP_APPS_HELP} edit={drafts.skipApps} />
          <SkipRow label="Sites to skip" summary={skipSitesSummary(snap.library.dictationSkipSites)} help={SKIP_SITES_HELP} edit={drafts.skipSites} />
        </Group>
      )}
      <Group label="What leaves this Mac">
        {/* Not a row: a paragraph, in a box of the window's own, padded as a row is. */}
        <div className="settings-words">
          <Text variant="callout">{leavesThisMacLine(snap.voice)}</Text>
        </div>
      </Group>
    </Stack>
  );
}
