// Settings → Voice: the shortcuts, with a Notice for each one that has a problem; the microphone Avanzel listens with;
// and the speech model that turns what it hears into text. Each control applies at once.
import { Actions, Button, Group, GroupRow, Kbd, Notice, Progress, Row, Stack, Text } from "@avanzel/ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ACTION_NAMES, prettyAccelerator } from "../../../main/shortcuts.ts";
import type { ModelStatus, Shortcuts } from "../../../shared/ipc.ts";
import { downloadFailedProblem } from "../../../shared/problems.ts";
import { passesThrough, toAccelerator } from "../accelerator.ts";
import { asSentence, microphoneName, microphoneOptions, speechModelLine, type InputDevice } from "../copy.ts";
import { attemptChange, ChooseButton, type PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** Voice's "Microphone" group: the device in use, and Choose…. A choice applies at once. */
export function MicrophoneGroup(props: PaneProps): ReactNode {
  const { snap } = props;
  // The audio inputs this Mac lists, once the page has asked: null until then, so that a chosen microphone isn't called
  // "not connected" before anyone has looked. The "default" entry stands for whatever macOS uses, which System default
  // already is, so it isn't a device of its own.
  const [devices, setDevices] = useState<InputDevice[] | null>(null);
  useEffect(() => {
    void navigator.mediaDevices
      .enumerateDevices()
      .then((all) => setDevices(all.filter((device) => device.kind === "audioinput" && device.deviceId !== "default")));
  }, []);
  const id = snap.app.microphoneId;
  const name = microphoneName(id, devices);
  return (
    <Group label="Microphone">
      <GroupRow label={name} description="Avanzel listens only while the capsule shows it listening.">
        <ChooseButton
          label="Microphone"
          valueLabel={name}
          options={microphoneOptions(id, devices)}
          onChoose={(value) => attemptChange(props, () => api.setApp({ microphoneId: value || null }))}
        />
      </GroupRow>
    </Group>
  );
}

/** Whole megabytes, as the capsule counts a download. */
const mb = (bytes: number) => Math.round(bytes / 1e6);

/** The speech model row's control: Ready, Download, or the download's progress. A failed one has its Notice instead. */
function SpeechControl({ model, onDownload }: { model: ModelStatus; onDownload(): void }): ReactNode {
  switch (model.kind) {
    case "ready":
      return <Text variant="footnote" tone="ok" as="span">Ready</Text>;
    case "missing":
      return (
        <Button size="small" variant="secondary" onClick={onDownload}>
          {model.bytes > 0 ? `Download (${mb(model.bytes)} MB)` : "Download"}
        </Button>
      );
    case "downloading":
      // The total is known before the first byte; should it ever not be, the bar has no length and there is no count.
      return (
        <Row gap={8}>
          <div className="settings-meter">
            <Progress label="Downloading the speech model" value={model.totalBytes > 0 ? model.receivedBytes / model.totalBytes : undefined} />
          </div>
          {model.totalBytes > 0 && <Text variant="footnote" tone="secondary" as="span">{`${mb(model.receivedBytes)} of ${mb(model.totalBytes)} MB`}</Text>}
        </Row>
      );
    case "error":
      return null;
  }
}

/**
 * The Notice under the Speech group while the model is in an error: a download that didn't finish, with why and Try
 * again (which continues where it stopped when part of it was kept), or voice settings in the library's config file that
 * Avanzel can't use, with why, which Try again couldn't help: they are fixed in that file. Either way, typing works
 * meanwhile. `primary` says whether Try again is the pane's primary button, which it isn't when a shortcut's Notice has
 * a free shortcut to offer.
 */
function SpeechProblem({ model, primary, onDownload }: { model: ModelStatus; primary: boolean; onDownload(): void }): ReactNode {
  if (model.kind !== "error") return null;
  if (model.cause === "settings") {
    return (
      <Notice tone="error" title="Avanzel can't use the voice settings in this library's config file.">
        {`${asSentence(model.message)} Typing a thought works meanwhile.`}
      </Notice>
    );
  }
  // The same words as the capsule's card.
  const problem = downloadFailedProblem(model.message, model.resumable);
  return (
    <Notice
      tone="error"
      title={problem.title}
      actions={
        <Actions align="start">
          <Button size="small" variant={primary ? "primary" : "secondary"} onClick={onDownload}>Try again</Button>
        </Actions>
      }
    >
      {problem.body}
    </Notice>
  );
}

/** The Voice pane: the shortcuts and their problems, MicrophoneGroup, and the speech model. */
export function Voice(props: PaneProps): ReactNode {
  const { snap, onChange, attempt } = props;
  // The shortcut being recorded, if any: one at a time.
  const [recording, setRecording] = useState<keyof Shortcuts | null>(null);
  // Each shortcut row's group of controls, to put the focus on its Change when a button the person used has gone.
  const groups = useRef<Partial<Record<keyof Shortcuts, HTMLDivElement | null>>>({});
  const rows = Object.entries(ACTION_NAMES) as [keyof Shortcuts, string][];
  const problems = rows.flatMap(([key, name]) => {
    const message = snap.shortcutProblems[key];
    // The snapshot lists the best free shortcut first; it goes last here, where a row of buttons keeps its primary.
    return message ? [{ key, name, message, alternatives: [...(snap.shortcutAlternatives[key] ?? [])].reverse() }] : [];
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

  const download = () => attemptChange(props, () => api.downloadModel());
  return (
    <Stack gap={20}>
      <Group label="Shortcuts" note="They work in every app.">
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
                <Kbd>{prettyAccelerator(snap.app.shortcuts[key])}</Kbd>
                <Button size="small" variant="secondary" onClick={() => setRecording((now) => (now === key ? null : key))}>
                  {recording === key ? "Type the new shortcut…" : "Change"}
                </Button>
              </Row>
            </div>
          </GroupRow>
        ))}
      </Group>
      {/* One Notice for each shortcut with a problem. The primary is the best free shortcut of the one primaryKey names. */}
      {problems.map(({ key, name, message, alternatives }) => (
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
          {/* Without a library the menu has no such item yet. */}
          {snap.library?.exists ? `“${name}” is still in the menu bar.` : undefined}
        </Notice>
      ))}
      <MicrophoneGroup {...props} />
      <Group label="Speech">
        <GroupRow label="Speech model" description={speechModelLine(snap.voice)}>
          <SpeechControl model={snap.model} onDownload={download} />
        </GroupRow>
      </Group>
      <SpeechProblem model={snap.model} primary={primaryKey === undefined} onDownload={download} />
    </Stack>
  );
}
