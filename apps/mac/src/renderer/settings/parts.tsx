// What Settings' panes share: the props each pane is given, how a change is made, the Notice a pane shows in place of the
// library while none is open, and the pop-up button, which opens a native menu.
import { Actions, Button, Notice, PopUp } from "@avanzel/ui";
import { useRef, type ReactNode } from "react";
import type { PickOption, SettingsSnapshot } from "../../shared/ipc.ts";
import { asSentence } from "./copy.ts";

const api = window.avanzel.settings;

/** What each pane is given: the window's snapshot, the way to replace it with the one a change sends back, and `attempt`. */
export interface PaneProps {
  snap: SettingsSnapshot;
  /** Draws `snapshot`, the one a change that worked sent back. The window forgets the problem an earlier refused change left. */
  onChange(snapshot: SettingsSnapshot): void;
  /**
   * Makes a call to main that main may refuse (a rejected promise: a file it can't write, a folder it won't take). A refusal
   * doesn't go unheard: the window tells it in a Notice, which goes with the next change that works or the next pane. A call
   * that saves a setting is told as "That change wasn't saved.", with why and what the setting keeps. Any other call, a check or
   * a run, saves nothing: it gives its own `title`, what didn't happen, and the Notice tells only why. Resolves with what the
   * call sent back, or undefined when it was refused.
   */
  attempt<T>(run: () => Promise<T>, title?: string): Promise<T | undefined>;
}

/**
 * A change that sends back the snapshot to draw (setApp, setLibrary, …): made through `attempt`, and drawn when it worked. A
 * change main refuses draws nothing, and the window tells it. `title` is for a call that saves no setting (see `attempt`).
 */
export async function attemptChange(
  { onChange, attempt }: Pick<PaneProps, "onChange" | "attempt">,
  run: () => Promise<SettingsSnapshot>,
  title?: string,
): Promise<void> {
  const next = await attempt(run, title);
  if (next) onChange(next);
}

/**
 * The Notice without a library: libraryProblem's, with Choose a folder…; then, for a library Avanzel has but can't find
 * (moved, renamed or unmounted, at launch or while it ran), where it was, with Choose a folder…, its fix, and Set up a new
 * library, which opens setup at the usual place, not the one that went; else, with no library at all, the no-library one,
 * with Set up Avanzel….
 */
export function NoLibrary({ snap, onChange, attempt }: PaneProps): ReactNode {
  // A folder main won't take (the home folder, say) is told in the window's Notice, beside this one, which offers it again.
  const choose = () => attemptChange({ onChange, attempt }, () => api.chooseLibrary());
  if (snap.libraryProblem) {
    return (
      <Notice
        tone="error"
        title={asSentence(snap.libraryProblem)}
        actions={
          <Actions align="start">
            <Button size="small" variant="primary" onClick={choose}>Choose a folder…</Button>
          </Actions>
        }
      >
        Choose it again once it's fixed, or choose another folder.
      </Notice>
    );
  }
  if (snap.library && !snap.library.exists) {
    return (
      <Notice
        tone="error"
        title={`Avanzel can't find your library at ${snap.library.label}.`}
        actions={
          <Actions align="start">
            {/* Choosing it again is the fix and the primary; a new library is the other way, so it is a secondary. */}
            <Button size="small" onClick={() => api.openSetup()}>Set up a new library</Button>
            <Button size="small" variant="primary" onClick={choose}>Choose a folder…</Button>
          </Actions>
        }
      >
        Choose it again once it's back, or choose another folder.
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
 * A pop-up button for a row: it shows `value`, and a press opens a native menu of `options` under it, with the current one checked (the
 * list for a microphone, the dictation key, a review's day or its agent). `onChoose` gets the value of the item picked, and a menu that
 * closes without a pick does nothing. `label` says what is chosen, so VoiceOver hears "Day: Sunday", and tests find the button by that.
 */
export function PickButton({ label, value, options, onChoose, disabled }: {
  label: string;
  value: string;
  options: readonly PickOption[];
  onChoose(value: string): void;
  /** The choice can't be made now (dictating into any app on a Mac that can't); the button is there but off. */
  disabled?: boolean;
}): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const choose = async () => {
    const at = box.current?.getBoundingClientRect();
    const picked = await api.pick(options, at ? { x: at.left, y: at.bottom } : null);
    if (picked !== null) onChoose(picked);
  };
  return (
    <div ref={box}>
      <PopUp label={label} value={value} disabled={disabled} onClick={() => void choose()} />
    </div>
  );
}
