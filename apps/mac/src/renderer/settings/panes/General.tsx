// Settings → General: the library, where it is and what it holds, with its six shelves under it; when a thought is
// filed; and opening at login. Without a library, the Notice that says why stands where the library would be, and the
// other two groups follow as usual. Each control applies at once.
import { Button, Group, GroupRow, Row, Segmented, SHELVES, ShelfTag, Stack, Switch, type SegmentedOption } from "@avanzel/ui";
import type { ReactNode } from "react";
import type { FileMode } from "../../../shared/ipc.ts";
import { libraryLine } from "../copy.ts";
import { NoLibrary, type PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** When a thought is filed: now, by the agent, or at the evening review. */
const FILE_MODES: readonly SegmentedOption<FileMode>[] = [
  { value: "now", label: "Right away" },
  { value: "evening", label: "Tonight" },
];

export function General({ snap, onChange }: PaneProps): ReactNode {
  const lib = snap.library;
  return (
    <Stack gap={20}>
      {lib?.exists ? (
        <Group label="Library">
          <GroupRow label={lib.label} description={libraryLine(lib.shelves, lib.isGit)}>
            <Row gap={8}>
              <Button size="small" variant="secondary" onClick={() => api.showLibrary()}>Show in Finder</Button>
              {snap.opensInObsidian && (
                <Button size="small" variant="secondary" onClick={() => api.openLibrary()}>Open in Obsidian</Button>
              )}
              <Button size="small" variant="quiet" onClick={async () => onChange(await api.chooseLibrary())}>Change…</Button>
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
        <NoLibrary snap={snap} onChange={onChange} />
      )}
      <Group label="After you speak">
        <GroupRow label="File each thought" description="Right away uses your agent now. Tonight waits for the evening review.">
          <Segmented label="When to file" options={FILE_MODES} value={snap.app.fileMode} onChange={async (fileMode) => onChange(await api.setApp({ fileMode }))} />
        </GroupRow>
      </Group>
      <Group label="Startup">
        <Switch
          label="Open Avanzel when you log in"
          checked={snap.app.launchAtLogin}
          onChange={async (launchAtLogin) => onChange(await api.setApp({ launchAtLogin }))}
        />
      </Group>
    </Stack>
  );
}
