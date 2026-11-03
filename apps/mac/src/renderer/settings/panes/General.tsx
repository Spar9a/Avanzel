// Settings → General: the library, where it is and what it holds, with its six shelves under it; when a thought is
// filed; and opening at login. Without a library, the Notice that says why stands where the library would be,
// and the other groups follow as usual. Each control applies at once.
import { Actions, Button, Group, GroupRow, Notice, Row, Segmented, SHELVES, ShelfTag, Stack, Switch, type SegmentedOption } from "@avanzel/ui";
import type { ReactNode } from "react";
import type { FileMode } from "../../../shared/ipc.ts";
import { fileModeLine, libraryLine } from "../copy.ts";
import { attemptChange, NoLibrary, type PaneProps } from "../parts.tsx";
import type { ReviewEdits } from "./Reviews.tsx";

const api = window.avanzel.settings;

/** When a thought is filed: now, by the agent, or at the evening review. */
const FILE_MODES: readonly SegmentedOption<FileMode>[] = [
  { value: "now", label: "Right away" },
  { value: "evening", label: "Tonight" },
];

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
              they sit in a box of their own. No counts: a tab's badge is the drawer's "new" count, not a total. */}
          <div className="settings-shelves">
            <Row gap={6} wrap>
              {SHELVES.map((shelf) => <ShelfTag key={shelf} shelf={shelf} variant="tab" />)}
            </Row>
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
