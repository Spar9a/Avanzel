// Settings → Shortcuts: each action's shortcut, which works in every app, with a Notice for each one that has a problem. A shortcut
// changes by its keyboard button and the next whole shortcut pressed; a taken one offers the free ones to use instead.
import { Actions, Button, Group, GroupRow, Kbd, Notice, Row, Stack, Text } from "@avanzel/ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ACTION_NAMES, inMenuLine, prettyAccelerator } from "../../../main/shortcuts.ts";
import type { Shortcuts } from "../../../shared/ipc.ts";
import { passesThrough, toAccelerator } from "../accelerator.ts";
import { attemptChange, type PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** The Shortcuts pane: a row for each action, and the problems of those that don't work, each with the free ones to use instead. */
export function ShortcutsPane(props: PaneProps): ReactNode {
  const { snap, onChange, attempt } = props;
  // The shortcut being recorded, if any: one at a time.
  const [recording, setRecording] = useState<keyof Shortcuts | null>(null);
  // Each shortcut row's group of controls, to put the focus on its Change when a button the person used has gone.
  const groups = useRef<Partial<Record<keyof Shortcuts, HTMLDivElement | null>>>({});
  const rows = Object.entries(ACTION_NAMES) as [keyof Shortcuts, string][];
  const problems = rows.flatMap(([key]) => {
    const message = snap.shortcutProblems[key];
    // The snapshot lists the best free shortcut first; it goes last here, where a row of buttons keeps its primary.
    return message ? [{ key, message, alternatives: [...(snap.shortcutAlternatives[key] ?? [])].reverse() }] : [];
  });
  // The pane has one primary button, the fix of the first Notice that has one to offer: the best free shortcut of the
  // first problem with any, or else Try again. A Notice with nothing to offer leaves it to the next.
  const primaryKey = problems.find(({ alternatives }) => alternatives.length > 0)?.key;

  /** `accelerator` becomes `key`'s shortcut, and the focus goes to that row's Change. */
  const save = async (key: keyof Shortcuts, accelerator: string) => {
    await attemptChange(props, () => api.setApp({ shortcuts: { ...snap.app.shortcuts, [key]: accelerator } }));
    groups.current[key]?.querySelector("button")?.focus();
  };

  // While a shortcut is recorded, the next whole shortcut pressed anywhere in the window is saved: one with ⌃ or ⌥, or a
  // bare F-key (toAccelerator). Leaving the window ends it, as does leaving the row (its group's onBlur) and leaving the
  // pane, which unmounts this. A layout effect, so the listening stops in the same commit that ends the recording or
  // takes the pane away: a key pressed on the next pane, even at once, is never taken for this one.
  useLayoutEffect(() => {
    if (recording === null) return;
    const listen = (event: KeyboardEvent) => {
      if (event.key === "Tab") return; // the focus may leave the row, which ends the recording
      if (passesThrough(event)) return; // a ⌘ key it never takes is the app's: ⌘Q still quits while it listens
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return setRecording(null);
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
  useLayoutEffect(() => {
    if (!listening) return;
    api.recordingShortcut(true);
    return () => api.recordingShortcut(false);
  }, [listening]);

  return (
    <Stack gap={20}>
      <Group label="In every app">
        {rows.map(([key, name]) => (
          <GroupRow key={key} label={name}>
            <div
              role="group"
              aria-label={name}
              ref={(group) => {
                groups.current[key] = group;
              }}
              onBlur={(event) => {
                // The focus went to another control, or to nothing: this row's recording is over.
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRecording((now) => (now === key ? null : now));
              }}
            >
              <Row gap={8}>
                {/* While it listens, the row asks for the keys in place of the shortcut it has. */}
                {/* One fixed box for both, so neither the button nor the row moves when it starts or stops listening. */}
                <div className="settings-shortcut">
                  {recording === key ? (
                    <>
                      <Text variant="footnote" tone="secondary">Press the new shortcut…</Text>
                      <Text variant="caption" tone="secondary">Esc to stop</Text>
                    </>
                  ) : (
                    <Kbd>{prettyAccelerator(snap.app.shortcuts[key])}</Kbd>
                  )}
                </div>
                <Button
                  size="small"
                  variant={recording === key ? "primary" : "quiet"}
                  icon="type"
                  label={recording === key ? "Press the new shortcut…" : "Change"}
                  onClick={() => setRecording((now) => (now === key ? null : key))}
                />
              </Row>
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
    </Stack>
  );
}
