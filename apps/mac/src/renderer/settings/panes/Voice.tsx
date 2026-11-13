// Settings → Voice: only what is about the voice itself. The microphone Avanzel listens with, the speech model that turns what it hears into
// text (chosen for the library by the languages it hears), and the library's dictionary of names and terms. Each control applies at once,
// the field of lines when the focus leaves it.
import { Actions, Button, Group, GroupRow, Notice, Progress, Row, Stack, Text } from "@avanzel/ui";
import { useEffect, useState, type ReactNode } from "react";
import type { ModelStatus } from "../../../shared/ipc.ts";
import { downloadFailedProblem, voiceSettingsProblem } from "../../../shared/problems.ts";
import {
  DICTIONARY_DESCRIPTION,
  DOWNLOAD_NOT_STARTED,
  microphoneName,
  microphoneOptions,
  SPEECH_CHOICE_NOTE,
  speechModelLine,
  speechModelName,
  speechModelOption,
  speechSwitchFailedProblem,
  speechSwitchLine,
  type InputDevice,
} from "../copy.ts";
import { LinesField, type LibraryDrafts, type TextEdit } from "../lines-field.tsx";
import { attemptChange, PickButton, type PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** The microphone's row: what it is for, and the device in use, which a press changes. A choice applies at once. */
function MicrophoneRow(props: PaneProps): ReactNode {
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
  return (
    <GroupRow label="Microphone" description="Avanzel listens only while the capsule shows it listening.">
      <PickButton
        label="Microphone"
        value={microphoneName(id, devices)}
        options={microphoneOptions(id, devices)}
        onChoose={(value) => attemptChange(props, () => api.setApp({ microphoneId: value || null }))}
      />
    </GroupRow>
  );
}

/** The names and terms the speech is corrected to, one per line, saved when the focus leaves the field. The draft is the window's. */
function DictionaryGroup({ dictionary }: { dictionary: TextEdit }): ReactNode {
  return (
    <Group label="Dictionary" note={DICTIONARY_DESCRIPTION}>
      <div className="settings-words">
        <LinesField label="Dictionary" edit={dictionary} />
      </div>
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
 * The library's speech model, each by its name, the languages it hears and its size. One on this Mac is used at once; one that isn't
 * downloads first (`SpeechSwitchRow`) while the model in use goes on hearing, and choosing the one in use again stops that download.
 * A model the library names that the engine doesn't run checks none, and the button asks for a choice rather than show its name.
 */
function SpeechModelPicker(props: PaneProps): ReactNode {
  const { snap } = props;
  return (
    <PickButton
      label="Choose a model"
      value=""
      options={snap.speechModels.map((info) => ({ value: info.id, label: speechModelOption(info), checked: info.id === snap.voice.model }))}
      onChoose={(id) => attemptChange(props, () => api.setLibrary({ speechModel: id }))}
    />
  );
}

/** The row of a chosen speech model's download, under the model in use: what downloads, how far it is, and Cancel. */
function SpeechSwitchRow(props: PaneProps): ReactNode {
  const change = props.snap.speechModelSwitch;
  if (change?.kind !== "downloading") return null;
  const name = speechModelName(change.id);
  return (
    <GroupRow label="Downloading" description={speechSwitchLine(change.id)}>
      <Row gap={8}>
        <div className="settings-meter">
          <Progress label={`Downloading ${name}`} value={change.totalBytes > 0 ? change.receivedBytes / change.totalBytes : undefined} />
        </div>
        {change.totalBytes > 0 && <Text variant="footnote" tone="secondary" as="span">{`${mb(change.receivedBytes)} of ${mb(change.totalBytes)} MB`}</Text>}
        <Button size="small" variant="quiet" onClick={() => attemptChange(props, () => api.cancelSpeechModelDownload())}>Cancel</Button>
      </Row>
    </GroupRow>
  );
}

/** The Notice of a chosen speech model whose download stopped: Try again chooses it again; Not now leaves the model in use as it is. */
function SpeechSwitchProblem(props: PaneProps): ReactNode {
  const change = props.snap.speechModelSwitch;
  if (change?.kind !== "failed") return null;
  const problem = speechSwitchFailedProblem(change.message, change.resumable);
  return (
    <Notice
      tone="error"
      title={problem.title}
      actions={
        <Actions align="start">
          <Button size="small" variant="primary" onClick={() => attemptChange(props, () => api.setLibrary({ speechModel: change.id }))}>Try again</Button>
          <Button size="small" variant="quiet" onClick={() => attemptChange(props, () => api.cancelSpeechModelDownload())}>Not now</Button>
        </Actions>
      }
    >
      {problem.body}
    </Notice>
  );
}

/**
 * The Notice under the Speech group while the model is in an error: a download that didn't finish, with why and Try
 * again (which continues where it stopped when part of it was kept), or voice settings in the library's config file that
 * Avanzel can't use, with why, which Try again couldn't help: they are fixed in that file. Either way the words are the
 * capsule's card's, from the same builder (shared/problems.ts), and say what is safe meanwhile. Try again is the pane's one primary.
 */
function SpeechProblem({ model, onDownload }: { model: ModelStatus; onDownload(): void }): ReactNode {
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
          <Button size="small" variant="primary" onClick={onDownload}>Try again</Button>
        </Actions>
      }
    >
      {problem.body}
    </Notice>
  );
}

/** The Voice pane: the microphone, the speech model, and the dictionary, which is the library's. */
export function Voice({ drafts, ...props }: PaneProps & { drafts: LibraryDrafts }): ReactNode {
  const { snap } = props;
  const download = () => attemptChange(props, () => api.downloadModel(), DOWNLOAD_NOT_STARTED);
  // The model is the library's: with none open, or one whose voice is a command, there is nothing to choose, only the model's state.
  const choosable = !!snap.library?.exists && snap.voice.backend === "onnx-asr" && snap.model.kind !== "downloading";
  return (
    <Stack gap={20}>
      {/* The choice's reason is the group's note, not its row's: the models' names make the pop-up too wide to share a row with it. */}
      <Group label="Listening" note={choosable ? SPEECH_CHOICE_NOTE : undefined}>
        <MicrophoneRow {...props} />
        <GroupRow label="Speech model" description={speechModelLine(snap.voice)}>
          <SpeechControl model={snap.model} onDownload={download} />
        </GroupRow>
        {choosable && (
          <GroupRow label="Choose a model">
            <SpeechModelPicker {...props} />
          </GroupRow>
        )}
        <SpeechSwitchRow {...props} />
      </Group>
      <SpeechProblem model={snap.model} onDownload={download} />
      <SpeechSwitchProblem {...props} />
      {/* The dictionary is the library's: with none open, or one Avanzel can't find, there is nowhere to keep it. */}
      {snap.library?.exists && <DictionaryGroup dictionary={drafts.dictionary} />}
    </Stack>
  );
}
