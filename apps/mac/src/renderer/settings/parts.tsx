// What Settings' panes share: the props each pane is given, the Notice a pane shows in place of the library while none
// is open, and Choose…, which opens a native menu.
import { Actions, Button, Notice } from "@avanzel/ui";
import { useRef, type ReactNode } from "react";
import type { PickOption, SettingsSnapshot } from "../../shared/ipc.ts";
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

/**
 * "Choose…" in a group named `label`; its menu pops up at the group's bottom left (getBoundingClientRect). This stands
 * in for a pop-up button: the row says the value in words, and Choose… opens a native menu of `options` (the list for a
 * microphone, a review's day or its agent). `onChoose` gets the value of the item picked, and a menu that closes
 * without a pick does nothing. The group's name is what VoiceOver says, and what tests find the row's button by, when
 * several rows each have a Choose….
 */
export function ChooseButton({ label, options, onChoose }: { label: string; options: readonly PickOption[]; onChoose(value: string): void }): ReactNode {
  const group = useRef<HTMLDivElement>(null);
  const choose = async () => {
    const box = group.current?.getBoundingClientRect();
    const value = await api.pick(options, box ? { x: box.left, y: box.bottom } : null);
    if (value !== null) onChoose(value);
  };
  return (
    <div ref={group} role="group" aria-label={label}>
      <Button size="small" variant="secondary" onClick={choose}>Choose…</Button>
    </div>
  );
}
