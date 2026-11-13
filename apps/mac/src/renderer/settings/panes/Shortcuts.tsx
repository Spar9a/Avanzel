// Settings → Shortcuts: a key cap for each action, which works in every app and which a press changes, and a Notice for each one that
// has a problem, with the free ones to use instead.
import { Actions, Button, Group, GroupRow, Notice, ShortcutField, Stack } from "@avanzel/ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ACTION_NAMES, inMenuLine, prettyAccelerator } from "../../../main/shortcuts.ts";
import type { Shortcuts as ShortcutKeys } from "../../../shared/ipc.ts";
import { passesThrough, refusedShortcut, toAccelerator } from "../accelerator.ts";
import { shortcutRefusedLine } from "../copy.ts";
import type { PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** What a screen reader is told of a recording given up. */
const NOT_CHANGED = "Not changed";

/** The Shortcuts pane: the shortcuts, whose first fix offered is the pane's one primary button. */
export function ShortcutsPane(props: PaneProps): ReactNode {
  return (
    <Stack gap={20}>
      <Shortcuts {...props} primary />
    </Stack>
  );
}

/** `primary`: the fix of the first Notice that has one to offer may be the pane's one primary button. */
export function Shortcuts({ primary, ...props }: PaneProps & { primary: boolean }): ReactNode {
  const { snap, onChange, attempt } = props;
  // The shortcut being recorded, if any: one at a time.
  const [recording, setRecording] = useState<keyof ShortcutKeys | null>(null);
  // How the last recording ended, which its field tells a screen reader, as nothing else on screen says so.
  const [saved, setSaved] = useState<{ key: keyof ShortcutKeys; said: string } | null>(null);
  // The last whole shortcut pressed while recording that it won't take (no ⌃ or ⌥), as the keys to try instead: its row says why, as
  // the recording keeps listening and would otherwise look stuck. A new recording starts without one.
  const [refused, setRefused] = useState<string | null>(null);
  // Each shortcut row's box, to put the focus back on its field when a button the person used has gone.
  const boxes = useRef<Partial<Record<keyof ShortcutKeys, HTMLDivElement | null>>>({});
  const rows = Object.entries(ACTION_NAMES) as [keyof ShortcutKeys, string][];
  const problems = rows.flatMap(([key]) => {
    const message = snap.shortcutProblems[key];
    // The snapshot lists the best free shortcut first; it goes last here, where a row of buttons keeps its primary.
    return message ? [{ key, message, alternatives: [...(snap.shortcutAlternatives[key] ?? [])].reverse() }] : [];
  });
  // The best free shortcut of the first problem with any. A Notice with nothing to offer leaves it to the next.
  const primaryKey = primary ? problems.find(({ alternatives }) => alternatives.length > 0)?.key : undefined;

  /**
   * `accelerator` becomes `key`'s shortcut, and the focus goes to that row's field. It is said to be saved only when it was, and works: a refusal is told
   * by the window, and another app's holding it by its row's Notice.
   */
  const save = async (key: keyof ShortcutKeys, accelerator: string) => {
    const next = await attempt(() => api.setApp({ shortcuts: { ...snap.app.shortcuts, [key]: accelerator } }));
    if (next) {
      onChange(next);
      if (!next.shortcutProblems[key]) setSaved({ key, said: `Saved ${prettyAccelerator(accelerator)}` });
    }
    boxes.current[key]?.querySelector("button")?.focus();
  };

  // While a shortcut is recorded, the next whole shortcut pressed anywhere in the window is saved: one with ⌃ or ⌥, or a
  // bare F-key (toAccelerator). Leaving the window ends it, as does leaving the row (its group's onBlur) and leaving the
  // pane, which unmounts this. A layout effect, so the listening stops in the same commit that ends the recording or
  // takes the pane away: a key pressed on the next pane, even at once, is never taken for this one.
  useLayoutEffect(() => {
    if (recording === null) return;
    const listen = (event: KeyboardEvent) => {
      if (event.key === "Tab") return; // the focus may leave the row, which ends the recording
      // ⌘⇧R or ⇧R is a whole shortcut it won't take: said before a ⌘ key goes on to the app, which it still does.
      const instead = refusedShortcut(event);
      if (instead) setRefused(instead);
      if (passesThrough(event)) return; // a ⌘ key it never takes is the app's: ⌘Q still quits while it listens
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setSaved({ key: recording, said: NOT_CHANGED });
        return setRecording(null);
      }
      const accelerator = toAccelerator(event);
      if (!accelerator) return; // only modifiers so far, or a key apps use themselves: keep listening
      setRecording(null);
      void save(recording, accelerator);
    };
    const stop = () => setRecording(null);
    window.addEventListener("keydown", listen, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", listen, true);
      window.removeEventListener("blur", stop);
    };
  }, [recording, snap, onChange, attempt]);

  // While it records, Avanzel's own shortcuts are let go: macOS would hand a key Avanzel holds to it, and the page would never see it.
  const listening = recording !== null;
  // A recording that starts, moves to another row, or ends says nothing yet of keys it won't take.
  useLayoutEffect(() => setRefused(null), [recording]);
  useLayoutEffect(() => {
    if (!listening) return;
    api.recordingShortcut(true);
    return () => api.recordingShortcut(false);
  }, [listening]);

  return (
    <>
      <Group label="Shortcuts" note="They work in every app. Click one to change it.">
        {rows.map(([key, name]) => (
          <GroupRow
            key={key}
            label={name}
            description={recording === key && refused ? shortcutRefusedLine(refused) : undefined}
            live={recording === key && refused !== null}
          >
            <div
              ref={(box) => {
                boxes.current[key] = box;
              }}
              onBlur={(event) => {
                // The focus went to another control, or to nothing: this row's recording is over.
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRecording((now) => (now === key ? null : now));
              }}
            >
              <ShortcutField
                label={name}
                value={prettyAccelerator(snap.app.shortcuts[key])}
                recording={recording === key}
                saved={saved?.key === key ? saved.said : undefined}
                onClick={() => {
                  setSaved(recording === key ? { key, said: NOT_CHANGED } : null);
                  setRecording((now) => (now === key ? null : key));
                }}
              />
            </div>
          </GroupRow>
        ))}
      </Group>
      {/* One Notice for each shortcut with a problem. The primary is the best free shortcut of the one primaryKey names. */}
      {problems.map(({ key, message, alternatives }) => (
        <Notice
          key={key}
          tone="error"
          title={message}
          actions={
            alternatives.length > 0 ? (
              <Actions align="start">
                {alternatives.map((accelerator, place) => (
                  <Button
                    key={accelerator}
                    size="small"
                    variant={key === primaryKey && place === alternatives.length - 1 ? "primary" : "secondary"}
                    onClick={() => void save(key, accelerator)}
                  >
                    {`Use ${prettyAccelerator(accelerator)}`}
                  </Button>
                ))}
              </Actions>
            ) : undefined
          }
        >
          {/* Where the action's item is, in the capsule's words (`inMenuLine`); without a library the menu has no such item yet. */}
          {snap.library?.exists ? inMenuLine(key) : undefined}
        </Notice>
      ))}
    </>
  );
}
