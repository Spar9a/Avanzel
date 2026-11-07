// Settings → Voice: dictating into any app, its key, the permission it
// lacks, and the library's log of it and skip lists; the microphone Avanzel listens with; the speech model that turns what it hears
// into text; and the library's dictionary of names and terms. Each control applies at once, a field of lines when the focus leaves it.
import { Actions, Button, Group, GroupRow, ListField, Notice, Progress, Row, Stack, Switch, Text, TextArea } from "@avanzel/ui";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { CursorKey, CursorPermissionState, LibraryPatch, ModelStatus, SettingsSnapshot } from "../../../shared/ipc.ts";
import { downloadFailedProblem, voiceSettingsProblem } from "../../../shared/problems.ts";
import {
  CURSOR_DICTATION_DESCRIPTION,
  CURSOR_KEY_DESCRIPTION,
  cursorKeyName,
  cursorKeyOptions,
  cursorStatus,
  DICTATION_LOG_DESCRIPTION,
  DICTATION_LOG_LABEL,
  DICTIONARY_DESCRIPTION,
  DOWNLOAD_NOT_STARTED,
  microphoneName,
  microphoneOptions,
  SKIP_APPS_DESCRIPTION,
  SKIP_SITES_DESCRIPTION,
  speechModelLine,
  type InputDevice,
} from "../copy.ts";
import { failed, followSnapshot, saved, sent, startDraft, toSend, typed, type TextDraft } from "../dictionary-draft.ts";
import { attemptChange, ChooseButton, EmbeddedSettings, type PaneProps } from "../parts.tsx";

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
 * With a library open, the library's own settings follow: whether it keeps a day file of what is dictated, which applies at once,
 * and the skip lists, saved when the focus leaves each (their drafts are the window's, `useVoiceDrafts`).
 */
function CursorDictationGroup({ drafts, ...props }: PaneProps & { drafts: VoiceDrafts }): ReactNode {
  const { enabled, key } = props.snap.app.cursorDictation;
  const library = props.snap.library?.exists ? props.snap.library : null;
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
      {library && (
        <>
          <Switch
            label={DICTATION_LOG_LABEL}
            description={DICTATION_LOG_DESCRIPTION}
            checked={library.dictationLog}
            onChange={(on) => attemptChange(props, () => api.setLibrary({ dictationLog: on }))}
          />
          <GroupRow label="Apps to skip" description={SKIP_APPS_DESCRIPTION}>
            <LinesField label="Apps to skip" edit={drafts.skipApps} rows={4} />
          </GroupRow>
          <GroupRow label="Sites to skip" description={SKIP_SITES_DESCRIPTION}>
            <LinesField label="Sites to skip" edit={drafts.skipSites} rows={3} />
          </GroupRow>
        </>
      )}
    </Group>
  );
}

/** A field of the library's lines in Voice: how its text is read from a snapshot, and the patch that saves the lines typed. */
interface LibraryTextField {
  text(snap: SettingsSnapshot): string;
  patch(lines: string[]): LibraryPatch;
}

/** The Dictionary field: the library's lines, one per line. */
const DICTIONARY_FIELD: LibraryTextField = {
  text: (snap) => (snap.library?.dictionary ?? []).join("\n"),
  patch: (lines) => ({ dictionary: lines }),
};

/** The skip lists of dictating into any app: bundle ids, and websites, one per line. */
const SKIP_APPS_FIELD: LibraryTextField = {
  text: (snap) => (snap.library?.dictationSkipApps ?? []).join("\n"),
  patch: (lines) => ({ dictationSkipApps: lines }),
};
const SKIP_SITES_FIELD: LibraryTextField = {
  text: (snap) => (snap.library?.dictationSkipSites ?? []).join("\n"),
  patch: (lines) => ({ dictationSkipSites: lines }),
};

/** A field's draft and its save, which the Settings window keeps (useLibraryTextEdit), so they outlast the pane. */
export interface TextEdit {
  draft: string;
  setDraft(text: string): void;
  /** Saves the draft, unless it is what the library holds or what a save on its way holds. */
  save(): Promise<void>;
}

/** Every draft of the Voice pane, kept by the Settings window (`useVoiceDrafts`). */
export interface VoiceDrafts {
  dictionary: TextEdit;
  skipApps: TextEdit;
  skipSites: TextEdit;
}

/**
 * The draft of a field of the library's lines, for the Settings shell to keep: a save waits its turn behind filing runs, and the
 * person may leave the pane and come back meanwhile, which must find the draft as it was, not the older lines of the snapshot before
 * the save. Once saved, the draft is the lines main kept (blank and repeated ones dropped, spaces tidied, a site made its host),
 * unless more was typed while the save waited. A draft not edited since the last snapshot follows the next one (`followSnapshot`),
 * so a save of another field, whose snapshot has this field's lines too, leaves an edit here alone. A save main refuses (too many
 * lines, one too long, one it can't read) leaves the draft as typed, and the window says why: leaving the field again tries again.
 * Another library's draft starts from its own lines.
 */
function useLibraryTextEdit(
  snap: SettingsSnapshot | null,
  onChange: PaneProps["onChange"],
  attempt: PaneProps["attempt"],
  field: LibraryTextField,
): TextEdit {
  const library = snap?.library?.exists ? snap.library.path : null;
  const text = snap ? field.text(snap) : "";
  const [state, setState] = useState(() => startDraft(library, text));
  const followed = followSnapshot(state, library, text);
  if (followed !== state) setState(followed);
  // The state as last drawn or changed here, so two blurs before the next draw send one save.
  const latest = useRef(followed);
  latest.current = followed;
  const change = (step: (now: TextDraft) => TextDraft) => {
    latest.current = step(latest.current);
    setState(step);
  };
  const save = async () => {
    const sending = toSend(latest.current);
    if (sending === null) return;
    change((now) => sent(now, sending));
    const next = await attempt(() => api.setLibrary(field.patch(sending.split("\n"))));
    if (!next) return change((now) => failed(now, sending));
    onChange(next);
    change((now) => saved(now, sending, field.text(next)));
  };
  return { draft: followed.draft, setDraft: (typedText) => change((now) => typed(now, typedText)), save };
}

/** The Voice pane's drafts (the Dictionary and the two skip lists), for the Settings window to keep (`useLibraryTextEdit`). */
export function useVoiceDrafts(snap: SettingsSnapshot | null, onChange: PaneProps["onChange"], attempt: PaneProps["attempt"]): VoiceDrafts {
  return {
    dictionary: useLibraryTextEdit(snap, onChange, attempt, DICTIONARY_FIELD),
    skipApps: useLibraryTextEdit(snap, onChange, attempt, SKIP_APPS_FIELD),
    skipSites: useLibraryTextEdit(snap, onChange, attempt, SKIP_SITES_FIELD),
  };
}

/** What each list's field shows while empty, as an example of what goes in it. */
const LIST_PLACEHOLDERS: Record<string, string> = {
  "Apps to skip": "com.apple.Passwords",
  "Sites to skip": "bank.example.com",
  Dictionary: "Avanzel = avant cell",
};

/** What each list counts, for its closed button: "10 apps". */
const LIST_NOUNS: Record<string, { one: string; many: string }> = {
  "Apps to skip": { one: "app", many: "apps" },
  "Sites to skip": { one: "site", many: "sites" },
  Dictionary: { one: "term", many: "terms" },
};

/**
 * A field of lines in a row of a Group, saved when the focus leaves it. TextArea takes no onBlur, so the box around it hears the focus
 * leave (React's onBlur bubbles).
 */
function LinesField({ label, edit, rows }: { label: string; edit: TextEdit; rows: number }): ReactNode {
  const embedded = useContext(EmbeddedSettings);
  // In the menu bar panel: a pop-up button that says what the list holds, and opens on the field and the items, one at a time, each
  // with its own Remove; each change is saved at once.
  if (embedded) {
    const items = edit.draft.split("\n").map((line) => line.trim()).filter(Boolean);
    return (
      <ListField
        label={label}
        items={items}
        collapsed={LIST_NOUNS[label] ?? { one: "item", many: "items" }}
        placeholder={LIST_PLACEHOLDERS[label]}
        onChange={(next) => {
          edit.setDraft(next.join("\n"));
          void edit.save();
        }}
      />
    );
  }
  return (
    <div className="settings-lines" onBlur={() => void edit.save()}>
      <TextArea label={label} labelHidden rows={rows} value={edit.draft} onChange={edit.setDraft} />
    </div>
  );
}

/**
 * Voice's "Dictionary" group: the names and terms the speech is corrected to, one per line, saved when the focus leaves the
 * field. The draft is the window's (`useVoiceDrafts`).
 */
function DictionaryGroup({ dictionary }: { dictionary: TextEdit }): ReactNode {
  return (
    <Group label="Dictionary">
      <GroupRow label="Names and terms" description={DICTIONARY_DESCRIPTION}>
        <LinesField label="Dictionary" edit={dictionary} rows={5} />
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
 * is the pane's primary button.
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

/**
 * The Voice pane: dictating into any app, MicrophoneGroup, the speech model, and the dictionary. The shortcuts have a pane of their
 * own (`ShortcutsPane`).
 */
export function Voice({ drafts, ...props }: PaneProps & { drafts: VoiceDrafts }): ReactNode {
  const { snap } = props;
  const download = () => attemptChange(props, () => api.downloadModel(), DOWNLOAD_NOT_STARTED);
  return (
    <Stack gap={20}>
      <CursorDictationGroup {...props} drafts={drafts} />
      <MicrophoneGroup {...props} />
      <Group label="Speech">
        <GroupRow label="Speech model" description={speechModelLine(snap.voice)}>
          <SpeechControl model={snap.model} onDownload={download} />
        </GroupRow>
      </Group>
      <SpeechProblem model={snap.model} primary onDownload={download} />
      {/* The dictionary is the library's: with none open, or one Avanzel can't find, there is nowhere to keep it. */}
      {snap.library?.exists && <DictionaryGroup dictionary={drafts.dictionary} />}
    </Stack>
  );
}
