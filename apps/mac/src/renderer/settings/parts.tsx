// What Settings' panes share: the props each pane is given, and the Notice a pane shows in place of the library while
// none is open.
import { Actions, Button, Notice } from "@avanzel/ui";
import type { ReactNode } from "react";
import type { SettingsSnapshot } from "../../shared/ipc.ts";
import { asSentence } from "./copy.ts";

const api = window.avanzel.settings;

/** What each pane is given: the window's snapshot, and the way to replace it with the one a change sends back. */
export interface PaneProps {
  snap: SettingsSnapshot;
  onChange(snapshot: SettingsSnapshot): void;
}

/** The Notice without a library: libraryProblem's, with Choose a folder…, or the no-library one, with Set up Avanzel…. */
export function NoLibrary({ snap, onChange }: PaneProps): ReactNode {
  if (snap.libraryProblem) {
    return (
      <Notice
        tone="error"
        title={asSentence(snap.libraryProblem)}
        actions={
          <Actions align="start">
            <Button size="small" variant="primary" onClick={async () => onChange(await api.chooseLibrary())}>Choose a folder…</Button>
          </Actions>
        }
      >
        Choose it again once it's fixed, or choose another folder.
      </Notice>
    );
  }
  return (
    <Notice
      title="Avanzel has no library open."
      actions={
        <Actions align="start">
          <Button size="small" variant="primary" onClick={() => api.openSetup()}>Set up Avanzel…</Button>
        </Actions>
      }
    >
      Setup makes one, or opens the one you have.
    </Notice>
  );
}
