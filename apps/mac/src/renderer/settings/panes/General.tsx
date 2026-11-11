// Settings → General: the library, where it is and what it holds, with its six shelves under it; when a thought is
// filed; Avanzel's version and its updates; and opening at login. Without a library, the Notice that says why stands where
// the library would be, and the other groups follow as usual. Each control applies at once. The shortcuts have a pane of their own.
import { Actions, Button, Group, GroupRow, Notice, Progress, Row, Segmented, ShelfDrawer, Stack, Switch, Text, type SegmentedOption } from "@avanzel/ui";
import { useState, type ReactNode } from "react";
import type { FileMode, UpdateStatus } from "../../../shared/ipc.ts";
import { fileModeLine, libraryLine, RESTART_NOT_STARTED, UPDATE_CHECK_NOT_STARTED, updateLine, versionLabel } from "../copy.ts";
import { attemptChange, NoLibrary, type PaneProps } from "../parts.tsx";
import type { ReviewEdits } from "./Reviews.tsx";

const api = window.avanzel.settings;

/** When a thought is filed: now, by the agent, or at the evening review. */
const FILE_MODES: readonly SegmentedOption<FileMode>[] = [
  { value: "now", label: "Right away" },
  { value: "evening", label: "Tonight" },
];

/** The Updates row's control, at its right, as the update is: Check now, the download's progress, Restart to update, or Try again. */
function UpdateControl({ status, onCheck, onRestart }: { status: UpdateStatus; onCheck(): void; onRestart(): void }): ReactNode {
  switch (status.kind) {
    case "off":
      return null;
    case "idle":
    case "current":
      return <Button size="small" variant="secondary" onClick={onCheck}>Check now</Button>;
    case "checking":
      return <Button size="small" variant="secondary" busy>Check now</Button>;
    case "downloading":
      return (
        <Row gap={8}>
          <div className="settings-meter">
            <Progress label="Downloading the update" value={status.percent / 100} />
          </div>
          <Text variant="footnote" tone="secondary" as="span" numeric>{`${status.percent}%`}</Text>
        </Row>
      );
    case "ready":
      // Busy once pressed: the restart has begun, or waits for what is in progress, as the line says.
      return (
        <Button size="small" variant="primary" busy={status.restarting || status.waitingFor !== null} onClick={onRestart}>
          Restart to update
        </Button>
      );
    case "problem":
      return <Button size="small" variant="secondary" onClick={onCheck}>Try again</Button>;
  }
}

/**
 * Avanzel's version and its update: the row's line says what the update is doing, its button what can be done about it, and the switch
 * lets Avanzel look by itself (on until the person turns it off; Check now works either way). A screen reader hears the line change once
 * the person has asked for something here. A build that doesn't look for updates says so, and has neither the button nor a switch to use.
 */
function UpdatesGroup(props: PaneProps): ReactNode {
  const { snap } = props;
  const { update } = snap;
  const [asked, setAsked] = useState(false);
  const check = () => {
    setAsked(true);
    void attemptChange(props, () => api.checkForUpdates(), UPDATE_CHECK_NOT_STARTED);
  };
  const restart = () => {
    setAsked(true);
    void attemptChange(props, () => api.restartToUpdate(), RESTART_NOT_STARTED);
  };
  return (
    <Group label="Updates">
      <GroupRow label={versionLabel(update.version)} description={updateLine(update, snap.app.checkForUpdates, new Date())} live={asked}>
        <UpdateControl status={update.status} onCheck={check} onRestart={restart} />
      </GroupRow>
      <Switch
        label="Check for updates automatically"
        checked={snap.app.checkForUpdates}
        disabled={update.status.kind === "off"}
        onChange={(checkForUpdates) => attemptChange(props, () => api.setApp({ checkForUpdates }))}
      />
    </Group>
  );
}

/**
 * The General pane. `edits` are the Settings window's (useReviewEdits): turning the evening review on here saves it as
 * the Reviews pane does, and waits as its switch does while a save of it is on its way. A save main refuses is told by the
 * window ("That change wasn't saved."), as any change here is, and only there: the failure `edits` kept of it, which the
 * Reviews pane would tell again under the review, is cleared.
 */
export function General(props: PaneProps & { edits: ReviewEdits }): ReactNode {
  const { snap, onChange, attempt, edits } = props;
  const lib = snap.library;
  // The evening review, as the Reviews pane tells it from the others: by its kind. Tonight files only while it is on.
  const evening = snap.tasks.find((task) => task.kind === "evening-review") ?? null;
  return (
    <Stack gap={20}>
      {lib?.exists ? (
        <Group label="Library">
          <GroupRow label={lib.label} description={libraryLine(lib.shelves, lib.isGit, lib.autoCommit, lib.gitUsable)}>
            <Row gap={8}>
              <Button size="small" variant="secondary" onClick={() => api.showLibrary()}>Show in Finder</Button>
              {snap.opensInObsidian && (
                <Button size="small" variant="secondary" onClick={() => api.openLibrary()}>Open in Obsidian</Button>
              )}
              <Button size="small" variant="secondary" onClick={() => attemptChange(props, () => api.chooseLibrary())}>Change…</Button>
            </Row>
          </GroupRow>
          {/* The shelves, in the library's panel under its row: a row holds a label and a control, not a line of tabs, so
              they sit in a box of their own. Each tab carries its total, read as "3 notes". */}
          <div className="settings-shelves">
            <ShelfDrawer total align="start" counts={lib.shelves} />
          </div>
        </Group>
      ) : (
        <NoLibrary snap={snap} onChange={onChange} attempt={attempt} />
      )}
      <Group label="After you speak">
        <GroupRow label="File each thought" description={fileModeLine(evening)}>
          <Segmented label="When to file" options={FILE_MODES} value={snap.app.fileMode} onChange={(fileMode) => attemptChange(props, () => api.setApp({ fileMode }))} />
        </GroupRow>
      </Group>
      {/* Tonight waits for a review that is off: new thoughts would wait in the inbox until someone runs it. */}
      {snap.app.fileMode === "evening" && evening && !evening.enabled && (
        <Notice
          title="The evening review is off, so new thoughts stay in the inbox."
          actions={
            <Actions align="start">
              <Button
                size="small"
                variant="primary"
                busy={edits.saving.has(evening.id)}
                onClick={async () => {
                  // The window tells a refusal, which `attempt` answers with undefined, and that is the one telling of it: the
                  // failure `edits` kept would show it a second time under the review on Reviews.
                  if ((await attempt(() => edits.save(evening, { enabled: true }))) === undefined) edits.clearFailure(evening.id);
                }}
              >
                Turn on the evening review
              </Button>
            </Actions>
          }
        >
          They're safe there.
        </Notice>
      )}
      <UpdatesGroup {...props} />
      <Group label="Startup">
        <Switch
          label="Open Avanzel when you log in"
          checked={snap.app.launchAtLogin}
          onChange={(launchAtLogin) => attemptChange(props, () => api.setApp({ launchAtLogin }))}
        />
      </Group>
    </Stack>
  );
}
