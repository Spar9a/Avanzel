// Settings → Voice: the shortcuts, with a Notice for each one that has a problem; dictating into any app, its key and the
// permission it lacks; the microphone Avanzel listens with; the speech model that turns what it hears into text; and the library's
// dictionary of names and terms. Each control applies at once, the dictionary when the focus leaves its field.
import { Actions, Button, Group, GroupRow, Kbd, Notice, Progress, Row, Stack, Switch, Text, TextArea } from "@avanzel/ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ACTION_NAMES, inMenuLine, prettyAccelerator } from "../../../main/shortcuts.ts";
import type { CursorKey, CursorPermissionState, ModelStatus, SettingsSnapshot, Shortcuts } from "../../../shared/ipc.ts";
import { downloadFailedProblem, voiceSettingsProblem } from "../../../shared/problems.ts";
import { passesThrough, toAccelerator } from "../accelerator.ts";
import {
  CURSOR_DICTATION_DESCRIPTION,
  CURSOR_KEY_DESCRIPTION,
  cursorKeyName,
  cursorKeyOptions,
  cursorStatus,
  DICTIONARY_DESCRIPTION,
  DOWNLOAD_NOT_STARTED,
  microphoneName,
  microphoneOptions,
  speechModelLine,
  type InputDevice,
} from "../copy.ts";
import { failed, followSnapshot, saved, sent, startDraft, toSend, typed, type DictionaryDraft } from "../dictionary-draft.ts";
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

/**
 * What macOS has granted for dictating into any app, null until the first answer. It is asked again when the setting changes (the
 * helper starts or stops) and when this window gets the focus back, which is where the person is after granting a permission in
 * System Settings. An answer that comes after a newer question was asked is dropped, so the older one can't overwrite it.
 */
function useCursorPermissions(enabled: boolean): { state: CursorPermissionState | null; ask(): Promise<void> } {
  const [state, setState] = useState<CursorPermissionState | null>(null);
  const asked = useRef(0);
  const check = (question: () => Promise<CursorPermissionState>) => {
    const mine = ++asked.current;
    return question().then(
      (answer) => {
        if (mine === asked.current) setState(answer);
      },
      // A question main couldn't answer leaves the line as it was.
      () => undefined,
    );
  };
  useEffect(() => {
    const again = () => void check(() => api.cursorPermissions());
    again();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [enabled]);
  return { state, ask: () => check(() => api.askCursorPermissions()) };
}

/**
 * Voice's "Dictate into any app" group: the switch, the key, and a line on what macOS has granted, with the button that asks for the
 * rest. The line shows while the switch is off too, so the person can grant before turning it on; turning it on with a permission
 * missing still turns it on, and the line says what to do. A Mac without the helper gets one line and controls that are off.
 */
function CursorDictationGroup(props: PaneProps): ReactNode {
  const { enabled, key } = props.snap.app.cursorDictation;
  const { state, ask } = useCursorPermissions(enabled);
  const status = state && cursorStatus(state);
  const off = state !== null && !state.available;
  return (
    <Group label="Dictate into any app">
      <Switch
        label="Dictate into any app"
        description={CURSOR_DICTATION_DESCRIPTION}
        checked={enabled}
        disabled={off}
        onChange={(on) => attemptChange(props, () => api.setCursorDictation({ enabled: on }))}
      />
      <GroupRow label={cursorKeyName(key)} description={CURSOR_KEY_DESCRIPTION}>
        <ChooseButton
          label="Dictation key"
          valueLabel={cursorKeyName(key)}
          options={cursorKeyOptions(key)}
          disabled={off}
          onChoose={(value) => attemptChange(props, () => api.setCursorDictation({ key: value as CursorKey }))}
        />
      </GroupRow>
      {status && (
        <GroupRow label={status.line}>
          {status.fix && (
            <Button size="small" variant="secondary" onClick={() => void ask()}>
              {status.fix}
            </Button>
          )}
        </GroupRow>
      )}
    </Group>
  );
}

/** The Dictionary field's text: the library's lines, one per line. */
const dictionaryText = (snap: SettingsSnapshot) => (snap.library?.dictionary ?? []).join("\n");

/** The Dictionary field's draft and its save, which the Settings window keeps (useDictionaryEdit), so they outlast the pane. */
export interface DictionaryEdit {
  draft: string;
  setDraft(text: string): void;
  /** Saves the draft, unless it is what the library holds or what a save on its way holds. */
  save(): Promise<void>;
}

/**
 * The Dictionary field's draft, for the Settings shell to keep: a save waits its turn behind filing runs, and the person may
 * leave the pane and come back meanwhile, which must find the draft as it was, not the older lines of the snapshot before the
 * save. Once saved, the draft is the lines main kept (blank and repeated ones dropped, spaces tidied), unless more was typed while
 * the save waited. A draft not edited since the last snapshot follows the next one (`followSnapshot`). A save main refuses (too
 * many lines, one too long) leaves the draft as typed, and the window says why: leaving the field again tries again. Another
 * library's draft starts from its own lines.
 */
export function useDictionaryEdit(
  snap: SettingsSnapshot | null,
  onChange: PaneProps["onChange"],
  attempt: PaneProps["attempt"],
): DictionaryEdit {
  const library = snap?.library?.exists ? snap.library.path : null;
  const text = snap ? dictionaryText(snap) : "";
  const [state, setState] = useState(() => startDraft(library, text));
  const followed = followSnapshot(state, library, text);
  if (followed !== state) setState(followed);
  // The state as last drawn or changed here, so two blurs before the next draw send one save.
  const latest = useRef(followed);
  latest.current = followed;
  const change = (step: (now: DictionaryDraft) => DictionaryDraft) => {
    latest.current = step(latest.current);
    setState(step);
  };
  const save = async () => {
    const sending = toSend(latest.current);
    if (sending === null) return;
    change((now) => sent(now, sending));
    const next = await attempt(() => api.setLibrary({ dictionary: sending.split("\n") }));
    if (!next) return change((now) => failed(now, sending));
    onChange(next);
    change((now) => saved(now, sending, dictionaryText(next)));
  };
  return { draft: followed.draft, setDraft: (typedText) => change((now) => typed(now, typedText)), save };
}

/**
 * Voice's "Dictionary" group: the names and terms the speech is corrected to, one per line, saved when the focus leaves the
 * field. The draft is the window's (`useDictionaryEdit`).
 */
function DictionaryGroup({ dictionary }: { dictionary: DictionaryEdit }): ReactNode {
  return (
    <Group label="Dictionary">
      <GroupRow label="Names and terms" description={DICTIONARY_DESCRIPTION}>
        {/* TextArea takes no onBlur, so the box around it hears the focus leave (React's onBlur bubbles). */}
        <div className="settings-dictionary" onBlur={() => void dictionary.save()}>
          <TextArea label="Dictionary" labelHidden rows={5} value={dictionary.draft} onChange={dictionary.setDraft} />
        </div>
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
 * Avanzel can't use, with why, which Try again couldn't help: they are fixed in that file. Either way the words are the
 * capsule's card's, from the same builder (shared/problems.ts), and say what is safe meanwhile. `primary` says whether Try again
 * is the pane's primary button, which it isn't when a shortcut's Notice has a free shortcut to offer.
 */
function SpeechProblem({ model, primary, onDownload }: { model: ModelStatus; primary: boolean; onDownload(): void }): ReactNode {
  if (model.kind !== "error") return null;
  if (model.cause === "settings") {
    const settings = voiceSettingsProblem(model.message);
    return (
      <Notice tone="error" title={settings.title}>
        {settings.body}
      </Notice>
    );
  }
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

/** The Voice pane: the shortcuts and their problems, MicrophoneGroup, the speech model, and the window's dictionary draft. */
export function Voice({ dictionary, ...props }: PaneProps & { dictionary: DictionaryEdit }): ReactNode {
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

  const download = () => attemptChange(props, () => api.downloadModel(), DOWNLOAD_NOT_STARTED);
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
      <CursorDictationGroup {...props} />
      <MicrophoneGroup {...props} />
      <Group label="Speech">
        <GroupRow label="Speech model" description={speechModelLine(snap.voice)}>
          <SpeechControl model={snap.model} onDownload={download} />
        </GroupRow>
      </Group>
      <SpeechProblem model={snap.model} primary={primaryKey === undefined} onDownload={download} />
      {/* The dictionary is the library's: with none open, or one Avanzel can't find, there is nowhere to keep it. */}
      {snap.library?.exists && <DictionaryGroup dictionary={dictionary} />}
    </Stack>
  );
}
