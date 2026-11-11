// The panel under the menu bar icon: three tabs, side by side, that slide along as the tab changes. Capture starts something new
// over a quiet moving aura, Library runs the reviews and lists the library's pages (sorted and filtered as the person picks), each
// folding open in place, and Settings is Settings. It arranges @avanzel/ui's parts and paints nothing of its own.
import "@avanzel/ui/base.css";
import { ActionTile, Aura, Button, Confirm, Disclosure, Dust, Expiring, Group, GroupRow, GroupReveal, SpokenField, Switch, FileLink, FilePreview, Items, More, UndoBar, Notice, PageRow, Progress, RecordingStage, Row, Select, SHELF_NAMES, ShelfTag, SHELVES, Spinner, Stack, TabPanel, Tabs, Text, TextField, type Item, type Shelf } from "@avanzel/ui";
import { answeredLine, ASKING_LINES, failedAnswer, waitingLine } from "../ask/copy.ts";
import { problemBody } from "../common/problem.tsx";
import { sourceTitle } from "../setup/copy.ts";
import { addChoices, addLabel, attachedItems } from "../common/attached.ts";
import { FilingCard } from "../common/filing-card.tsx";
import { TriggerListener } from "../capsule/trigger-listener.ts";
import { transcribingLine } from "../../shared/transcribing.ts";
import { filedScene } from "../capsule/filed.tsx";
import { ProblemNotice } from "../capsule/problem-notice.tsx";
import { stoppedScene } from "../capsule/stopped.tsx";
import { ListeningControls } from "../common/listening-controls.tsx";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import { isSettingsPane, PANEL_TABS, type AskResult, type AvanzelBridge, type PanelFiling, type PanelPage, type PanelReview, type PanelSnapshot, type PanelTab, type SettingsPane, type Shortcuts } from "../../shared/ipc.ts";
import { SettingsApp } from "../settings/SettingsApp.tsx";
import { UPDATE_NOT_NOW, updateReadyState } from "../settings/copy.ts";
import { inboxLine, notesLabel, pageDay,reviewOutcome, reviewState, SORTS, sortLabel, sortPages, type PageFilter, type PageSort } from "./copy.ts";
import "./styles.css";

declare global {
  interface Window { avanzel: AvanzelBridge }
}

const api = window.avanzel.panel;
const act = (action: string) => api.act(action);

const isShelf = (value: string | null): value is Shelf => value !== null && (SHELVES as readonly string[]).includes(value);

/** A shortcut as macOS writes it, when it is set and registered. */
function keyOf(snap: PanelSnapshot, key: keyof Shortcuts): string | undefined {
  const accelerator = snap.shortcuts[key];
  if (!accelerator || snap.unregisteredShortcuts.includes(key)) return undefined;
  return prettyAccelerator(accelerator);
}

const BARS = 16;

/** The voice as the capsule hears it, for the panel's own bar: the newest level on the right. */
function useLevels(listening: boolean): number[] {
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.08));
  useEffect(() => {
    if (!listening) return;
    return api.onLevel((level) => setLevels((prev) => [...prev.slice(1), Math.max(0.08, level)]));
  }, [listening]);
  return levels;
}

/** The wave of a paused recording: lying flat. */
const FLAT: readonly number[] = Array(BARS).fill(0.08);

/** How long a recording has run, "0:07", counted from when it began, each second; standing still while it is paused. */
function useElapsed(startedAt: number | null, pausedAt: number | null = null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null || pausedAt !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [startedAt, pausedAt]);
  if (startedAt === null) return "";
  const seconds = Math.max(0, Math.floor(((pausedAt ?? now) - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const LISTENING_LINES: Record<NonNullable<PanelSnapshot["listening"]>["mode"], string> = {
  dictate: "Recording a thought",
  comment: "Recording a comment on the screen",
  call: "Taking notes on a call",
};

/**
 * The recording that listens now, as the capsule shows it: its bar, with Zel listening, the voice and the time, and under it what
 * the capsule offers for it: when it is filed, Stop and Cancel. A dictation into another app ends only by its own key, so it has neither.
 */
/**
 * The recording that listens now takes the whole of Capture (`RecordingStage`): Zel over a wide wave of the voice, the time, and
 * under them what the capsule offers for it, and nothing else until it ends. A call has its own Stop; a dictation into another app
 * ends only by its own key, which the stage says instead of offering buttons.
 */
/**
 * The recording's controls in the panel, under its stage: when it is filed, then its buttons, the first of which (a thought that files
 * a note) is Add, a pop-up menu over it (`Select`): a file, a screenshot, a marked one, or a video of a part of the screen. Under the
 * buttons, what goes with it so far, each with its ×. Dropping files on the recording adds them too. A call has its own Stop; a dictation into another app ends
 * only by its own key, which the stage says instead of offering buttons.
 */
function RecordingControls({ listening }: { listening: NonNullable<PanelSnapshot["listening"]> | null }) {
  if (!listening) return null;
  if (listening.mode === "call") {
    return <Button size="xlarge" variant="primary" icon="stop" onClick={() => act("call-notes-stop")}>Stop taking notes</Button>;
  }
  if (listening.ownKey) return <Text variant="callout" tone="secondary">The key you dictate with ends it.</Text>;
  const adds = takesAdds(listening);
  const list = attachedItems(listening.attached, listening.adding);
  // Add, as a pop-up menu over its own button (`Select`): each way of adding is a panel action of its own.
  const ways = addChoices(listening.adding, {
    file: () => act("recording-attach"),
    screenshot: () => act("recording-screenshot"),
    area: () => act("recording-screenshot-area"),
    marks: () => act("recording-marks"),
    video: () => act("recording-video"),
  });
  const add = adds ? (
    <Select
      label={addLabel(listening.attached.length)}
      trigger={{ icon: "attach", size: "xlarge", count: listening.attached.length }}
      options={ways.map((way) => ({ value: way.label, label: way.label, icon: way.icon }))}
      value={null}
      onChange={(label) => ways.find((way) => way.label === label)?.onSelect()}
    />
  ) : undefined;
  return (
    <Stack gap={16}>
      <ListeningControls
        stacked
        fileMode={listening.fileMode}
        review={listening.review}
        paused={listening.pausedAt !== null}
        onFileMode={(next) => act(`file-mode:${next}`)}
        onCancel={() => act("cancel-recording")}
        onPause={() => act("pause-recording")}
        onStop={() => act("stop-recording")}
        {...(add ? { add } : {})}
      />
      {/* What goes with the recording, under its buttons, each with its ×; a screenshot on its way spins. */}
      {list.length > 0 && <Items items={list} onRemove={(i) => api.removeAttachment(i)} />}
    </Stack>
  );
}

/** "1 thought", "3 thoughts": how VoiceOver reads Processing's count. */
const thoughtsLabel = (count: number) => `${count} ${count === 1 ? "thought" : "thoughts"}`;

/**
 * Processing: what came of the last filing while its card stands (filed with its pages, Undo and Open; stopped; or a problem with its
 * fix), each the card the capsule drew for it before; then the thoughts being filed, the one at work and the queue (`Filings`).
 */
function Processing({ snap, leaving, onLeft }: { snap: PanelSnapshot; leaving: PanelSnapshot["result"]; onLeft: () => void }) {
  const words = snap.transcribing;
  return (
    <div className="panel-pad">
      <Stack gap={16}>
        {/* A recording's words being made: where, with a spinner; Stop once it takes long, which keeps the recording in the inbox. */}
        {words && (
          <Row gap={10} align="center">
            <Spinner />
            <div className="panel-grow">
              <Text variant="callout">{words.slow ? "Still transcribing…" : transcribingLine(words.onThisMac)}</Text>
            </div>
            {words.slow && <Button size="small" icon="stop" onClick={() => window.avanzel.capsule.stopTranscribing()}>Stop</Button>}
          </Row>
        )}
        <Result result={snap.result} hidesAt={snap.resultHidesAt} leaving={leaving} onLeft={onLeft} />
        <Filings filings={snap.filings} />
      </Stack>
    </div>
  );
}

/**
 * What came of the last filing, as the capsule drew it: filed with its pages, a thought that came to no note (noted only, or stopped),
 * or a problem. One that came to no note has a violet line running round its edge until its time is up (`Expiring`). When the card
 * goes (its time is up, or it is put away) it fades and closes up (`Dust`, gently), from the copy the panel kept of it (`leaving`).
 */
function Result({ result, hidesAt, leaving, onLeft }: { result: PanelSnapshot["result"]; hidesAt: number | null; leaving: PanelSnapshot["result"]; onLeft: () => void }) {
  const shown = result ?? leaving;
  // Its time, read once when the card's end is set: a ring whose length changed as the panel redraws would jump.
  const seconds = useMemo(() => (hidesAt === null ? null : (hidesAt - Date.now()) / 1000), [hidesAt]);
  if (!shown) return null;
  const noNote = (shown.kind === "filed" && shown.noted) || shown.kind === "cancelled";
  const card =
    shown.kind === "filed" ? filedScene(shown).card : shown.kind === "cancelled" ? stoppedScene(shown).card : <ProblemNotice state={shown} />;
  return (
    <Dust key={`${shown.kind}-${"text" in shown ? shown.text : shown.message}`} gently removing={!result} onRemoved={onLeft}>
      {noNote ? <Expiring seconds={seconds}>{card}</Expiring> : card}
    </Dust>
  );
}

/**
 * The thoughts being filed: the one at work as the filing card (with Edit and Stop while it is the one the capsule's state holds), and
 * under it, while more wait their turn, the queue, oldest first, each by its words.
 */
function Filings({ filings }: { filings: readonly PanelFiling[] }) {
  if (filings.length === 0) return null;
  const atWork = filings.find((each) => !each.state.waiting) ?? filings[0]!;
  const queue = filings.filter((each) => each !== atWork);
  return (
    <Stack gap={12}>
      <FilingCard
        state={atWork.state}
        words={<Text variant="callout">{atWork.state.text}</Text>}
        {...(atWork.shown ? { onEdit: () => act("filing-edit"), onStop: () => act("filing-stop") } : {})}
      />
      {queue.length > 0 && (
        <Stack gap={8}>
          <Text variant="footnote" tone="secondary">{queue.length === 1 ? "Next in the queue" : `${queue.length} in the queue`}</Text>
          {queue.map((each) => <Queued key={each.id} filing={each} />)}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * A thought waiting its turn, as its own card (`FilingCard`: Waiting to file), with a red bin that asks first and then takes it out of
 * the queue: it isn't filed, and its note goes to the Trash.
 */
function Queued({ filing }: { filing: PanelFiling }) {
  const [asking, setAsking] = useState(false);
  // Deleted: it turns to dust as a note does, and once its room has closed up main takes it out of the queue.
  const [removing, setRemoving] = useState(false);
  return (
    <Dust removing={removing} onRemoved={() => act(`queue-remove:${filing.id}`)}>
      <FilingCard
        state={filing.state}
        words={<Text variant="callout">{filing.state.text}</Text>}
        more={
          <Confirm
            open={asking}
            question="Delete this thought?"
            confirmLabel="Delete"
            onConfirm={() => {
              setAsking(false);
              setRemoving(true);
            }}
            onCancel={() => setAsking(false)}
          >
            <Button size="small" variant="danger" icon="trash" label="Delete this thought" expanded={asking} onClick={() => setAsking(!asking)} />
          </Confirm>
        }
      />
    </Dust>
  );
}

/** Whether files and screenshots can go with the recording: a thought dictated into Avanzel that files a note. */
function takesAdds(listening: NonNullable<PanelSnapshot["listening"]>): boolean {
  return listening.mode === "dictate" && !listening.ownKey && listening.fileMode !== null;
}

/**
 * Capture: the ways to start something new, each done here in the panel. Capture the screen asks how first; Take notes on a call…
 * lists the call apps that run now and everything this Mac plays; Type a thought… folds open a field, whose Return saves the words;
 * Ask your library… goes to Library, with its field ready (`onAsk`).
 */
function Capture({ snap, onAsk }: { snap: PanelSnapshot; onAsk(): void }) {
  // Capture the screen asks how first: the whole screen, or a part picked with macOS's crosshair.
  const [askArea, setAskArea] = useState(false);
  const capture = (action: "capture" | "capture-region") => {
    setAskArea(false);
    act(action);
  };
  // Take a screenshot asks how first: the whole screen, a part, or a part marked in place.
  const [askShot, setAskShot] = useState(false);
  const shoot = (action: "shot-screen" | "shot-area" | "shot-marks") => {
    setAskShot(false);
    act(action);
  };
  // Take notes on a call…: the apps that run a call now, read as the list opens; null while they are read.
  const [callApps, setCallApps] = useState<string[] | null>(null);
  const [askCall, setAskCall] = useState(false);
  const openCalls = useCallback(() => {
    setAskCall(true);
    setCallApps(null);
    void api.callApps().then(setCallApps, () => setCallApps([]));
  }, []);
  useEffect(() => api.onPickCall(openCalls), [openCalls]);
  const pickCall = (pick: string) => {
    setAskCall(false);
    act(`call-notes:${pick}`);
  };
  // Type a thought…: the words stay in the field until they are saved, and stay there when they couldn't be.
  const [typing, setTyping] = useState(false);
  const [words, setWords] = useState("");
  const [saving, setSaving] = useState(false);
  const typeField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typing) typeField.current?.focus({ preventScroll: true });
  }, [typing]);
  const saveWords = () => {
    if (!words.trim() || saving) return;
    setSaving(true);
    api.type(words).then(
      () => {
        setWords("");
        setTyping(false);
        setSaving(false);
      },
      () => setSaving(false),
    );
  };
  const listening = snap.listening;
  // The last recording is kept while the stage leaves, so what it shows doesn't vanish before it has faded.
  const shownRef = useRef(listening);
  if (listening) shownRef.current = listening;
  const shown = shownRef.current;
  const paused = !!shown?.pausedAt;
  const levels = useLevels(!!listening && !paused);
  const time = useElapsed(shown?.startedAt ?? null, shown?.pausedAt ?? null);
  return (
    <RecordingStage
      active={!!listening}
      paused={paused}
      line={paused ? "Paused" : shown ? LISTENING_LINES[shown.mode] : ""}
      time={time}
      levels={paused ? FLAT : levels}
      controls={<RecordingControls listening={shown} />}
      {...(shown && takesAdds(shown) ? { onDropFiles: (files: File[]) => api.attachToRecording(files) } : {})}
    >
      <div className="panel-pad">
        <Stack gap={16}>
          {!snap.libraryReady && (
            <Notice
              tone="info"
              title={snap.libraryProblem ?? "Avanzel has no library yet."}
              actions={<Button variant="primary" size="small" onClick={() => act("setup")}>Set up Avanzel…</Button>}
            >
              Thoughts wait in the inbox until there is one.
            </Notice>
          )}
          <Text variant="headline">{snap.headline}</Text>
          {snap.speechProblem && (
            <Notice
              tone="error"
              title={snap.speechProblem.title}
              actions={
                <Button variant={snap.libraryReady ? "primary" : "secondary"} size="small" onClick={() => act("open-settings:voice")}>
                  Open voice settings
                </Button>
              }
            >
              {snap.speechProblem.line}
            </Notice>
          )}
          <Stack gap={8}>
            {/* One primary at a time: while a problem's fix is offered above, recording is one of the other ways in. */}
            <ActionTile
              order={0}
              tone={snap.libraryReady && !snap.speechProblem ? "primary" : "secondary"}
              icon="mic"
              label="Record a thought"
              hint="Speak, and your agent files it."
              shortcut={keyOf(snap, "dictate")}
              onClick={() => act("dictate")}
            />
            {/* Take a screenshot: of the screen, a part, or a part marked first; then a thought is recorded with it on its Add list. */}
            <ActionTile
              order={1}
              icon="display"
              label="Take a screenshot"
              hint="Then say what it is about."
              shortcut={keyOf(snap, "shot")}
              open={askShot}
              onClick={() => setAskShot(!askShot)}
              choices={
                <>
                  <Button size="small" variant="primary" icon="display" shortcut={keyOf(snap, "shotScreen")} onClick={() => shoot("shot-screen")}>The whole screen</Button>
                  <Button size="small" icon="screen" shortcut={keyOf(snap, "shot")} onClick={() => shoot("shot-area")}>A part</Button>
                  <Button size="small" icon="pen" shortcut={keyOf(snap, "shotMarks")} onClick={() => shoot("shot-marks")}>With marks</Button>
                </>
              }
            />
            <ActionTile
              order={1}
              icon="screen"
              label="Capture the screen"
              hint="With a comment on what is on it."
              shortcut={keyOf(snap, "capture")}
              open={askArea}
              onClick={() => setAskArea(!askArea)}
              choices={
                <>
                  <Button size="small" variant="primary" icon="screen" shortcut={keyOf(snap, "capture")} onClick={() => capture("capture")}>Capture the whole screen</Button>
                  <Button size="small" shortcut={keyOf(snap, "region")} onClick={() => capture("capture-region")}>Pick a part</Button>
                </>
              }
            />
            {snap.callNotesOffer !== "off" && (
              <ActionTile
                order={2}
                icon="call"
                shortcut={keyOf(snap, "call")}
                label={snap.callNotesOffer === "running" ? "Stop taking notes" : "Take notes on a call…"}
                hint={snap.callNotesOffer === "running" ? "The notes are filed when you stop." : "Both sides of the call, as notes."}
                {...(snap.callNotesOffer === "running"
                  ? { onClick: () => act("call-notes-stop") }
                  : {
                      open: askCall,
                      onClick: () => (askCall ? setAskCall(false) : openCalls()),
                      choices: callApps === null ? (
                        <Spinner size="small" label="Looking for calls" />
                      ) : (
                        <>
                          {callApps.map((name, i) => (
                            <Button key={`${name}-${i}`} size="small" variant={i === 0 ? "primary" : "secondary"} icon="call" onClick={() => pickCall(String(i))}>{name}</Button>
                          ))}
                          <Button size="small" variant={callApps.length === 0 ? "primary" : "secondary"} onClick={() => pickCall("everything")}>Everything this Mac plays</Button>
                        </>
                      ),
                    })}
              />
            )}
            <ActionTile
              order={3}
              icon="type"
              label="Type a thought…"
              hint="When speaking isn't right."
              shortcut={keyOf(snap, "type")}
              open={typing}
              onClick={() => setTyping(!typing)}
              choices={
                <div className="panel-fold-field">
                  <TextField
                    ref={typeField}
                    label="Thought"
                    labelHidden
                    placeholder="Type a thought, then press Return"
                    value={words}
                    onChange={setWords}
                    onEnter={saveWords}
                    onEscape={() => setTyping(false)}
                    action={<Button size="small" variant="primary" busy={saving} disabled={!words.trim()} onClick={saveWords}>Save</Button>}
                  />
                </div>
              }
            />
            <ActionTile order={4} icon="search" label="Ask your library…" hint="Answers come from your notes, with links." shortcut={keyOf(snap, "ask")} onClick={onAsk} />
          </Stack>
          <VoiceTrigger trigger={snap.voiceTrigger} />
          <Stack gap={8}>
            {snap.inbox > 0 ? (
              <Row gap={8} justify="between">
                <Text variant="footnote" tone="secondary">{inboxLine(snap.inbox)}</Text>
                <Button size="small" variant="quiet" icon="folder" onClick={() => act("open-inbox")}>Open the inbox</Button>
              </Row>
            ) : (
              <Text variant="footnote" tone="secondary">{inboxLine(snap.inbox)}</Text>
            )}
            {(snap.showableReceipt || snap.undoableFiling || snap.cutShortCalls > 0 || snap.forgettableDictation) && (
              <Row gap={8} wrap>
                {snap.showableReceipt && <Button size="small" onClick={() => act("show-receipt")}>Show the last receipt</Button>}
                {snap.undoableFiling && <Button size="small" icon="undo" shortcut={keyOf(snap, "undo")} onClick={() => act("undo-filing")}>Undo the last filing</Button>}
                {snap.cutShortCalls > 0 && <Button size="small" icon="call" onClick={() => act("finish-cut-short")}>Finish notes for a call that was cut short</Button>}
                {snap.forgettableDictation && <Button size="small" variant="quiet" onClick={() => act("forget-dictation")}>Forget the last dictation</Button>}
              </Row>
            )}
          </Stack>
        </Stack>
      </div>
    </RecordingStage>
  );
}

/** How long the trigger word rests after a change before it is saved: typing it saves it once, not at every letter. */
const TRIGGER_SAVE_MS = 600;
/** How long the microphone beside the trigger word waits for it to be said before it gives up. */
const TRIGGER_LISTEN_MS = 6000;
/** The voice's wave while the trigger word is said: a bar each 60 ms, the newest 40. */
const TRIGGER_WAVE_TICK_MS = 60;
const TRIGGER_WAVE_BARS = 40;

/**
 * Start a thought by voice, at Capture's foot, as Siri starts by its word: off until it is turned on; on, saying the word starts
 * recording a thought, as Record a thought does, and saying its stop word while it records stops it. Each word is any the person
 * picks, typed or said, saved as they stop typing it. While it is on the microphone stays open, which macOS shows, and the line says so.
 */
function VoiceTrigger({ trigger }: { trigger: PanelSnapshot["voiceTrigger"] }) {
  const [word, setWord] = useState(trigger.word);
  useEffect(() => setWord(trigger.word), [trigger.word]);
  const [stopWord, setStopWord] = useState(trigger.stopWord);
  useEffect(() => setStopWord(trigger.stopWord), [trigger.stopWord]);
  useEffect(() => {
    const kept = { word: word.trim(), stopWord: stopWord.trim() };
    if (!kept.word || !kept.stopWord || (kept.word === trigger.word && kept.stopWord === trigger.stopWord)) return;
    const timer = setTimeout(() => void window.avanzel.settings.setApp({ voiceTrigger: { ...trigger, ...kept } }), TRIGGER_SAVE_MS);
    return () => clearTimeout(timer);
  }, [word, stopWord, trigger]);
  // Which field the microphone hears for, while it does: one at a time.
  const [hearingFor, setHearingFor] = useState<"word" | "stop" | null>(null);
  // A word said, rather than typed: the microphone beside its field hears it until a pause (3 s at most), and main makes it into words
  // as speech-to-text will write it when it listens for it. Nothing heard in 6 s gives up. Main ignores the trigger's own ear meanwhile,
  // so saying the word here starts or stops nothing.
  // The voice's wave while it listens: the loudest block of each tick, newest last.
  const [levels, setLevels] = useState<number[]>([]);
  const ear = useRef<{ listener: TriggerListener; finish: (samples: Float32Array | null) => Promise<void> } | null>(null);
  const hear = useCallback(async (field: "word" | "stop") => {
    if (ear.current) return ear.current.finish(null); // Stop: nothing heard is kept
    setLevels([]);
    setHearingFor(field);
    api.hearingTriggerWord(true);
    let done = false;
    let loudest = 0;
    const tick = setInterval(() => {
      setLevels((now) => [...now, loudest].slice(-TRIGGER_WAVE_BARS));
      loudest = 0;
    }, TRIGGER_WAVE_TICK_MS);
    const giveUp = setTimeout(() => void finish(null), TRIGGER_LISTEN_MS);
    const listener = new TriggerListener(
      (samples) => void finish(samples),
      "../capsule/capture-worklet.js",
      (level) => {
        loudest = Math.max(loudest, level);
      },
    );
    const finish = async (samples: Float32Array | null) => {
      if (done) return;
      done = true;
      clearInterval(tick);
      clearTimeout(giveUp);
      ear.current = null;
      await listener.stop();
      const heard = samples ? await api.hearTriggerWord(samples) : null;
      if (heard) (field === "word" ? setWord : setStopWord)(heard);
      setHearingFor(null);
      api.hearingTriggerWord(false);
    };
    ear.current = { listener, finish };
    try {
      await listener.start(null);
    } catch {
      void finish(null);
    }
  }, []);
  useEffect(() => () => void ear.current?.finish(null), []);
  return (
    <Group label="Voice trigger">
      <Switch
        label="Start a thought by voice"
        description={
          trigger.enabled
            ? `Say “${trigger.word}”, and a thought starts recording; say “${trigger.stopWord}”, and it stops. The microphone stays on while this is on.`
            : "Say a word of your own, as you would to Siri, and a thought starts recording."
        }
        checked={trigger.enabled}
        onChange={(enabled) => void window.avanzel.settings.setApp({ voiceTrigger: { ...trigger, enabled } })}
      />
      <GroupReveal open={trigger.enabled}>
        <GroupRow label="Trigger word">
          <SpokenField
            label="Trigger word"
            value={word}
            onChange={setWord}
            placeholder="Avanzel"
            listening={hearingFor === "word"}
            levels={hearingFor === "word" ? levels : []}
            onListen={() => void hear("word")}
            listenLabel="Say the trigger word"
          />
        </GroupRow>
        <GroupRow label="Stop word">
          <SpokenField
            label="Stop word"
            value={stopWord}
            onChange={setStopWord}
            placeholder="Avanzel stop"
            listening={hearingFor === "stop"}
            levels={hearingFor === "stop" ? levels : []}
            onListen={() => void hear("stop")}
            listenLabel="Say the stop word"
          />
        </GroupRow>
      </GroupReveal>
    </Group>
  );
}

function ReviewLine({ review }: { review: PanelReview }) {
  const outcome = reviewOutcome(review);
  return (
    <Stack gap={4}>
      <Row gap={8} justify="between">
        <Stack gap={2}>
          <Text variant="headline">{review.name}</Text>
          <Text variant="footnote" tone="secondary" numeric>{reviewState(review)}</Text>
        </Stack>
        <Button size="small" variant="secondary" icon="play" busy={review.running} onClick={() => act(`task:${review.id}`)}>
          Run now
        </Button>
      </Row>
      {review.running && <Progress label={`${review.name} is running`} />}
      {outcome && <Text variant="footnote" tone="secondary">{outcome}</Text>}
    </Stack>
  );
}

/** A step as the page's lines give it: "☐ Do it" (to do) or "☑ Done" (`library-pages`' marks for `- [ ]` and `- [x]`). */
const STEP = /^([☐☑])\s*/;

/** A line as a point of a list: a step's mark becomes whether it is done; any other line is a point as it is. */
function asItem(line: string, page?: PanelPage): Item {
  const step = STEP.exec(line);
  const words = step ? line.slice(step[0].length) : line;
  return { text: wordsOf(words), content: linked(words, page), ...(step ? { done: step[1] === "☑" } : {}) };
}

/** A log's entry starts with its day, then a dash: "2026-11-07 — Noted by voice." */
const DATED = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{1,2}:\d{2})?\s*[—–-]\s*/;

/** A log's entry as a list's point: its day apart, before its words (`Items`' `when`), and the dash after it gone. */
function logItem(line: string, page: PanelPage): Item {
  const dated = DATED.exec(line);
  if (!dated) return asItem(line, page);
  const words = line.slice(dated[0].length);
  return { ...asItem(words, page), text: wordsOf(line), when: dated[0].replace(/\s*[—–-]\s*$/, "") };
}

/** A section that asks the owner for more: next steps, open questions, what is left to clarify. */
const ASKS_MORE = /next step|open question|question|clarif|follow.?up|to do|todo|уточн|следующ|вопрос|шаг/i;

/**
 * Add more, over an open page's summary: a recording that goes on with this page (on its own, or with the screen), or files attached to
 * it. Whichever it is, the agent updates the page with it at once, and the panel comes back here when it has. Files can be dropped on
 * the page too (`PageRow`'s `onDropFiles`).
 */
function AddMore({ page, recording }: { page: PanelPage; recording: boolean }) {
  return (
    <Row gap={8} wrap>
      <Text variant="footnote" tone="secondary">Add more</Text>
      <Button size="small" variant="primary" icon="mic" disabled={recording} onClick={() => act(`continue:${page.path}`)}>Record</Button>
      {/* The rest behind More: the row stays one line until they are wanted. */}
      <More>
        <Button size="small" icon="display" disabled={recording} onClick={() => act(`continue-screen:${page.path}`)}>Record with screen</Button>
        <Button size="small" icon="screen" onClick={() => act(`continue-shot:${page.path}`)}>Screenshot</Button>
        <Button size="small" icon="pen" onClick={() => act(`continue-marks:${page.path}`)}>Screenshot with marks</Button>
        <Button size="small" icon="attach" onClick={() => act(`attach:${page.path}`)}>Attach a file…</Button>
      </More>
    </Row>
  );
}

/**
 * A state the panel keeps across its window's reloads and Avanzel's restarts, in this page's own storage (`key`), for coming back to it
 * as it was. A value storage can't give back, or one `valid` refuses, starts from `initial`. Storage that can't be reached only forgets.
 */
function useRemembered<T>(key: string, initial: T, valid: (value: unknown) => value is T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const kept = localStorage.getItem(key);
      if (kept === null) return initial;
      const parsed: unknown = JSON.parse(kept);
      return valid(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // nowhere to keep it: the panel only forgets it on its next start
      }
    },
    [key],
  );
  return [value, set];
}


/** A file's kind, by its extension, for its chip's sign. */
function fileKind(rel: string): "video" | "image" | "file" {
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  if (["mov", "mp4", "m4v", "webm", "avi", "mkv"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "gif", "heic", "webp", "tiff", "bmp"].includes(ext)) return "image";
  return "file";
}

/** A line of a page with each file of raw/attachments it names as a link that opens the file; the rest of its words as they are. */
/** Escapes `text` for a RegExp. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The name a file of the page goes by (the one it was added with, when the page says it), else its own file name. */
function fileName(page: PanelPage | undefined, rel: string): string {
  return page?.attachmentNames.find((each) => each.path === rel)?.name ?? rel.slice(rel.lastIndexOf("/") + 1);
}

/** A file of `page` as a link in `words`: a click opens it; under the pointer it is a chip with a bin that takes it off the page. */
/** How long Copy as a prompt says it copied: its check, in place of its sign. */
const COPIED_MS = 2000;

/**
 * Copy as a prompt, among a page's actions: the page, as a prompt for an agent (its words, and its files as full paths), goes on the
 * clipboard, and the button wears a check for a moment to say so.
 */
function CopyPrompt({ rel }: { rel: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="small"
      variant="secondary"
      icon={copied ? "check" : "copy"}
      label={copied ? "Copied as a prompt" : "Copy as a prompt"}
      onClick={() => void api.copyPrompt(rel).then(setCopied)}
    />
  );
}

/** Previews main has made, by the file: a page opened again shows them at once. */
const previews = new Map<string, string | null>();

/** A file's preview under its link in a page's Files (`FilePreview`): a click opens it, as the link does. */
function Preview({ page, rel }: { page: PanelPage; rel: string }) {
  const [picture, setPicture] = useState<string | null | undefined>(() => previews.get(rel));
  useEffect(() => {
    if (previews.has(rel)) return setPicture(previews.get(rel));
    let live = true;
    void api.thumbnail(rel).then((url) => {
      previews.set(rel, url);
      if (live) setPicture(url);
    });
    return () => {
      live = false;
    };
  }, [rel]);
  return <FilePreview name={fileName(page, rel)} kind={fileKind(rel)} picture={picture} onOpen={() => act(`open-file:${rel}`)} />;
}

function fileLink(page: PanelPage | undefined, rel: string, words: ReactNode, key: string): ReactNode {
  return (
    <FileLink
      key={key}
      name={fileName(page, rel)}
      kind={fileKind(rel)}
      onOpen={() => act(`open-file:${rel}`)}
      {...(page ? { onRemove: () => act(`remove-file:${page.path}\n${rel}`) } : {})}
    >
      {words}
    </FileLink>
  );
}

/**
 * A line of a page with each file it names as a link that opens it: a Markdown link to it ([the recording](raw/attachments/…)), its
 * path on its own, or the name it was added with ("Screen Recording 2026-11-07 at 10.54.48", with its extension or not), as the page
 * writes that name beside its path somewhere. The rest of its words as they are.
 */
function linked(line: string, page?: PanelPage): ReactNode {
  const names = (page?.attachmentNames ?? [])
    .flatMap(({ name, path }) => [{ words: name, path }, { words: name.replace(/\.[A-Za-z0-9]{1,5}$/, ""), path }])
    .filter((each) => each.words.length >= 3)
    .sort((a, b) => b.words.length - a.words.length);
  const byName = new Map(names.map((each) => [each.words, each.path]));
  const alternatives = [
    String.raw`\[([^\]]+)\]\((raw\/attachments\/[^)\s]+)\)`,
    String.raw`(raw\/attachments\/[^\s)\]|"'«»,;]+\.[A-Za-z0-9]{1,5})`,
    ...(names.length ? [`(${names.map((each) => escaped(each.words)).join("|")})`] : []),
  ];
  const LINK = new RegExp(alternatives.join("|"), "g");
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of line.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > at) parts.push(line.slice(at, start));
    const rel = (match[2] ?? match[3] ?? (match[4] ? byName.get(match[4]) : undefined) ?? "").trim();
    parts.push(rel ? fileLink(page, rel, match[1] ?? match[4] ?? fileName(page, rel), `${rel}-${start}`) : match[0]);
    at = start + match[0].length;
  }
  if (parts.length === 0) return line;
  if (at < line.length) parts.push(line.slice(at));
  return parts;
}

/** A line as words alone, its links' words in place of the links: for what names it (VoiceOver, an ×). */
function wordsOf(line: string): string {
  return line.replace(/\[([^\]]+)\]\((raw\/attachments\/[^)\s]+)\)/g, "$1");
}

/** A section that is the page's log, which folds away. */
const LOG = /^(log|журнал|история)$/i;

/**
 * An open page's files (the videos, screenshots and files added to it) as chips, each opening its file, with its × under the pointer;
 * then its sections. The one that asks for more (next steps, open questions) is a block of its own, each step with its ×. A file a line
 * names is a link that opens it.
 */
function PageDetails({ page }: { page: PanelPage }) {
  const asks = page.sections.findIndex((section) => ASKS_MORE.test(section.heading) && section.lines.length > 0);
  return (
    <Stack gap={12}>
      {/* Its files, folded away at first, as its log is: each a link that opens it, with a bin under the pointer. */}
      {page.attachments.length > 0 && (
        <Disclosure label="Files" count={page.attachments.length}>
          <Items
            items={page.attachments.map((rel) => ({
              text: fileName(page, rel),
              content: (
                <>
                  {fileLink(page, rel, fileName(page, rel), rel)}
                  <Preview page={page} rel={rel} />
                </>
              ),
            }))}
          />
        </Disclosure>
      )}
      {page.sections.map((section, i) =>
        i === asks ? (
          <Notice key={`${section.heading}-${i}`} tone="info" title={section.heading}>
            {/* Each step has its ×: it goes from the page itself. */}
            <Items
              items={section.lines.slice(0, 8).map((line) => asItem(line, page))}
              onRemove={(j) => act(`remove-item:${page.path}\n${section.heading}\n${section.lines[j] ?? ""}`)}
            />
          </Notice>
        ) : (
          LOG.test(section.heading) ? (
            // The log, folded away at first: its entries as a list, as the page keeps them.
            <Disclosure key={`${section.heading}-${i}`} label={section.heading} count={section.lines.length}>
              <Items items={section.lines.map((line) => logItem(line, page))} />
            </Disclosure>
          ) : (
            <Stack key={`${section.heading}-${i}`} gap={4}>
              <Text variant="footnote" tone="secondary">{section.heading}</Text>
              {/* A section of steps (☐/☑) is a list with its marks; any other is its lines as they are. */}
              {section.lines.some((line) => STEP.test(line)) ? (
                <Items items={section.lines.slice(0, 8).map((line) => asItem(line, page))} />
              ) : (
                section.lines.slice(0, 8).map((line, j) => <Text key={j} variant="callout">{linked(line, page)}</Text>)
              )}
            </Stack>
          )
        ),
      )}
      {page.updated && page.updated !== page.created && (
        <Text variant="caption" tone="secondary">{`Made ${pageDay(page.created)}, changed ${pageDay(page.updated)}`}</Text>
      )}
    </Stack>
  );
}

/** The words a page is found by: its title, summary, tags, status and the lines of its sections, in lower case. */
function pageWords(page: PanelPage): string {
  return [page.title, page.summary ?? "", page.status ?? "", ...(page.tags ?? []), ...page.sections.flatMap((s) => [s.heading, ...s.lines])]
    .join("\n")
    .toLowerCase();
}

/** Whether every word of `query` is somewhere in the page. */
function pageMatches(page: PanelPage, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = pageWords(page);
  return words.every((word) => text.includes(word));
}

/** A question asked in Library, while it is answered (`outcome` null), and once it is: the answer, or "stopped". */
interface PanelAsk {
  question: string;
  outcome: AskResult | "stopped" | null;
  progress: string | null;
  since: number;
}

/** The time now, read again each `ms` while `ticking`. */
function useClock(ms: number, ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms, ticking]);
  return now;
}

/**
 * The question asked in Library and its answer, over the pages: while the agent looks, a spinner, the waiting line and Stop; then the
 * answer's lines, the pages it used (each opens), and who answered; or what went wrong, with Ask again.
 */
function AskReply({ ask, onStop, onAgain, onClose }: { ask: PanelAsk; onStop(): void; onAgain(): void; onClose(): void }) {
  const running = ask.outcome === null;
  const now = useClock(250, running);
  const { line } = waitingLine(ask.progress, (now - ask.since) / 1000, ASKING_LINES);
  const outcome = ask.outcome;
  return (
    <Stack gap={12}>
      <Row gap={8} justify="between">
        <Text variant="headline">{ask.question}</Text>
        {!running && <Button size="small" variant="quiet" onClick={onClose}>Close</Button>}
      </Row>
      {running && (
        <Row gap={8}>
          <Spinner size="small" />
          <div role="status" className="panel-grow"><Text variant="footnote" tone="secondary" numeric>{line}</Text></div>
          <Button size="small" variant="quiet" onClick={onStop}>Stop</Button>
        </Row>
      )}
      {outcome === "stopped" && <Text variant="footnote" tone="secondary">Stopped.</Text>}
      {outcome !== null && outcome !== "stopped" && !outcome.ok && (() => {
        const problem = failedAnswer(outcome, new Date());
        return (
          <Notice tone="error" title={problem.title} actions={<Button size="small" variant="primary" onClick={onAgain}>Ask again</Button>}>
            {problemBody(problem)}
          </Notice>
        );
      })()}
      {outcome !== null && outcome !== "stopped" && outcome.ok && (
        <Stack gap={12}>
          <Stack gap={6}>
            {outcome.paragraphs.map((paragraph, i) => <Text key={i}>{paragraph}</Text>)}
          </Stack>
          {outcome.sources.length > 0 && (
            <Stack gap={4}>
              <Text variant="footnote" tone="secondary">Notes used:</Text>
              {outcome.sources.map((page) => (
                <Row key={page.path} gap={6} wrap>
                  {isShelf(page.shelf) && <ShelfTag shelf={page.shelf} />}
                  <Button variant="page" wrap onClick={() => act(`open-md:${page.path}`)}>{sourceTitle(page.title)}</Button>
                </Row>
              ))}
            </Stack>
          )}
          <Text variant="footnote" tone="secondary" numeric>{answeredLine(outcome.agent, outcome.seconds)}</Text>
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Library: the reviews, then the pages, found by the field beside the filters as the words are typed. Return in it asks the library
 * the words as a question, and the answer shows over the pages. Ask your library… in Capture brings the field forward (`focusAsk`).
 */
function Library({ snap, pages, focusAsk }: { snap: PanelSnapshot; pages: PanelPage[]; focusAsk: number }) {
  // The open page is remembered, so the panel comes back to it as it was: after a file it opened, a restart, or a reload.
  const [open, setOpen] = useRemembered<string | null>("panel.open", null, (value): value is string | null => value === null || typeof value === "string");
  // Deleting a page: its bin asks first (Move to the Trash? Cancel, Delete), then the row turns to dust, and only then is it sent to the
  // Trash; until the list is read again the row stays out of it (`gone`).
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setGone(pending ? new Set([pending]) : new Set()), [pages]); // the page that waits stays out of the list
  const undoDelete = () => {
    const rel = pending;
    setPending(null);
    if (!rel) return;
    setGone((now) => {
      const next = new Set(now);
      next.delete(rel);
      return next;
    });
  };
  const letDeleteStand = () => {
    if (pending) act(`delete-page:${pending}`);
    setPending(null);
  };
  const startDelete = (rel: string) => {
    setConfirming(null);
    if (open === rel) setOpen(null);
    setRemoving((now) => new Set(now).add(rel));
  };
  // Turned to dust, a page waits UNDO_SECONDS before it goes to the Trash, with Undo under the list (`UndoBar`); a second one deleted
  // meanwhile sends the first at once.
  const [pending, setPending] = useState<string | null>(null);
  const finishDelete = (rel: string) => {
    if (pending && pending !== rel) act(`delete-page:${pending}`);
    setPending(rel);
    setGone((now) => new Set(now).add(rel));
    setRemoving((now) => {
      const next = new Set(now);
      next.delete(rel);
      return next;
    });
  };
  const [sort, setSort] = useState<PageSort>("changed");
  const [filter, setFilter] = useState<PageFilter>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [ask, setAsk] = useState<PanelAsk | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusAsk > 0) field.current?.focus({ preventScroll: true });
  }, [focusAsk]);
  // Back from Continue by voice: the page it went on with is open again, and in sight, whatever was filtered or searched.
  useEffect(
    () =>
      api.onOpenPage((rel) => {
        setFilter({ kind: "all" });
        setQuery("");
        setOpen(rel);
        requestAnimationFrame(() => document.getElementById(`page-${rel}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
      }),
    [],
  );
  useEffect(() => api.onAskProgress((message) => setAsk((now) => (now && now.outcome === null ? { ...now, progress: message, since: Date.now() } : now))), []);
  const asking = ask !== null && ask.outcome === null;
  const askNow = (question: string) => {
    const words = question.trim();
    if (!words || asking) return;
    setAsk({ question: words, outcome: null, progress: null, since: Date.now() });
    api.ask(words).then(
      (result) => setAsk((now) => (now && now.question === words ? { ...now, outcome: result } : now)),
      (error: unknown) => setAsk((now) => (now && now.question === words
        ? { ...now, outcome: { ok: false, answer: error instanceof Error ? error.message : String(error), agent: "", seconds: 0, paragraphs: [], sources: [], changedFiles: 0, failure: null, library: null } }
        : now)),
    );
  };
  const stopAsk = () => {
    api.cancelAsk();
    setAsk((now) => (now && now.outcome === null ? { ...now, outcome: "stopped" } : now));
  };
  const shelves = useMemo(() => SHELVES.filter((shelf) => pages.some((p) => p.shelf === shelf)), [pages]);
  const statuses = useMemo(() => [...new Set(pages.map((p) => p.status).filter((s): s is string => !!s))].sort(), [pages]);
  // A filter that matches nothing any more (its shelf emptied, its status gone) leaves the list on All: nothing is filtered out of sight.
  const live: PageFilter =
    (filter.kind === "shelf" && shelves.includes(filter.shelf)) || (filter.kind === "status" && statuses.includes(filter.status)) ? filter : { kind: "all" };
  const shown = sortPages(
    pages.filter((p) => (live.kind === "shelf" ? p.shelf === live.shelf : live.kind === "status" ? p.status === live.status : true) && pageMatches(p, query)),
    sort,
  );
  // The filter's choices, under their headings: every page, a shelf, a status.
  const filterOptions = [
    { value: "all", label: "All notes" },
    ...shelves.map((shelf, i) => ({ value: `shelf:${shelf}`, label: SHELF_NAMES[shelf], shelf, ...(i === 0 ? { section: "Shelves" } : {}) })),
    ...statuses.map((status, i) => ({ value: `status:${status}`, label: status, ...(i === 0 ? { section: "Status" } : {}) })),
  ];
  const filterValue = live.kind === "all" ? "all" : live.kind === "shelf" ? `shelf:${live.shelf}` : `status:${live.status}`;
  const chooseFilter = (picked: string) => {
    if (picked === "all") setFilter({ kind: "all" });
    else if (picked.startsWith("shelf:") && isShelf(picked.slice(6))) setFilter({ kind: "shelf", shelf: picked.slice(6) as Shelf });
    else if (picked.startsWith("status:")) setFilter({ kind: "status", status: picked.slice(7) });
  };
  const dictate = keyOf(snap, "dictate");
  return (
    <div className="panel-pad panel-library">
      <Stack gap={16}>
        {snap.reviews.length > 0 && (
          <Stack gap={12}>
            {snap.reviews.map((review) => <ReviewLine key={review.id} review={review} />)}
            {snap.undoableReview && (
              <Row gap={8}><Button size="small" variant="quiet" icon="undo" onClick={() => act("undo-review")}>Undo the last evening review</Button></Row>
            )}
          </Stack>
        )}
        {ask && <AskReply ask={ask} onStop={stopAsk} onAgain={() => askNow(ask.question)} onClose={() => setAsk(null)} />}
        <Stack gap={8}>
          <Row gap={6}>
            <div className="panel-grow">
              <TextField
                ref={field}
                type="search"
                icon="search"
                label="Search or ask your library"
                labelHidden
                placeholder="Search"
                value={query}
                onChange={setQuery}
                onEnter={() => askNow(query)}
                onEscape={query ? () => setQuery("") : undefined}
              />
            </div>
            {/* Half the row, whatever they say: a filter or a sort picked never moves the field or the other button. */}
            <div className="panel-tools">
              <div className="panel-tool">
                <Select
                  label="Filter"
                  icon="settings"
                  options={filterOptions}
                  value={filterValue}
                  buttonLabel={live.kind === "all" ? "Filter" : live.kind === "shelf" ? SHELF_NAMES[live.shelf] : live.status}
                  onChange={chooseFilter}
                  clearable={live.kind !== "all"}
                  clearLabel="Clear the filter"
                  onClear={() => setFilter({ kind: "all" })}
                />
              </div>
              <div className="panel-tool">
                <Select
                  label="Sort by"
                  options={SORTS.map((value) => ({ value, label: sortLabel(value) }))}
                  value={sort}
                  onChange={(next) => setSort(next)}
                />
              </div>
            </div>
          </Row>
          {shown.filter((page) => !gone.has(page.path)).map((page, i) => (
            <div key={page.path} id={`page-${page.path}`}>
            <PageRow
              order={i}
              title={page.title}
              shelf={isShelf(page.shelf) ? page.shelf : undefined}
              status={page.status ?? undefined}
              tags={page.tags}
              date={pageDay(sort === "made" ? page.created : (page.updated ?? page.created))}
              summary={page.summary ? linked(page.summary, page) : undefined}
              expanded={open === page.path}
              onToggle={() => setOpen(open === page.path ? null : page.path)}
              lead={<AddMore page={page} recording={!!snap.listening} />}
              onDropFiles={(files) => api.attachToPage(page.path, files)}
              removing={removing.has(page.path)}
              onRemoved={() => finishDelete(page.path)}
              actions={
                <>
                  {snap.opensInObsidian && <Button size="small" variant="secondary" icon="open" onClick={() => act(`open-obsidian:${page.path}`)}>Obsidian</Button>}
                  <CopyPrompt rel={page.path} />
                  <Button size="small" variant="secondary" icon="folder" label="Show in Finder" onClick={() => act(`reveal:${page.path}`)} />
                  {/* The bin, in red, asks first, on a card of its own over the list: Cancel (or Esc, or a click elsewhere), or Delete. */}
                  <Confirm
                    open={confirming === page.path}
                    question="Move this note to the Trash?"
                    confirmLabel="Delete"
                    onConfirm={() => startDelete(page.path)}
                    onCancel={() => setConfirming(null)}
                  >
                    <Button
                      size="small"
                      variant="danger"
                      icon="trash"
                      label="Delete this note"
                      expanded={confirming === page.path}
                      onClick={() => setConfirming(confirming === page.path ? null : page.path)}
                    />
                  </Confirm>
                </>
              }
            >
              <PageDetails page={page} />
            </PageRow>
            </div>
          ))}
        </Stack>
      </Stack>
      {/* No notes to list: the line says why, in the middle of the room left under the field. */}
      {shown.length === 0 && (
        <div className="panel-empty">
          <Text variant="callout" tone="secondary" align="center">
            {pages.length === 0
              ? `Nothing filed yet. ${dictate ? `Press ${dictate}` : "Record a thought"} and say hello.`
              : query.trim() ? "No notes have these words. Press Return to ask your library instead." : "No notes match this filter."}
          </Text>
        </div>
      )}
      {/* A page just deleted waits, at the foot of the panel, for Undo, its × or the end of its time. */}
      {pending && (
        <div className="panel-undo">
          <UndoBar key={pending} message="Note deleted" seconds={UNDO_SECONDS} onUndo={undoDelete} onDone={letDeleteStand} />
        </div>
      )}
    </div>
  );
}

/**
 * The foot's line while Avanzel's update is ready, over Quit Avanzel: what is ready, and Restart to update. Pressed while something is in
 * progress, the line says the restart comes once that ends, and Not now calls it off. Nothing while no update is ready: Settings → General
 * tells the rest, and on the Settings tab the foot leaves the update to it (`App`), so the offer is never made twice.
 */
function UpdateReady({ update }: { update: PanelSnapshot["update"] }) {
  const status = update.status;
  if (status.kind !== "ready") return null;
  return (
    <Row gap={8} justify="between">
      <div role="status" className="panel-grow panel-update">
        <Text variant="footnote" tone="secondary">{updateReadyState(status)}</Text>
      </div>
      {status.waitingFor !== null ? (
        <Button size="small" variant="quiet" onClick={() => act("cancel-restart-to-update")}>{UPDATE_NOT_NOW}</Button>
      ) : (
        <Button size="small" variant="secondary" busy={status.restarting} onClick={() => act("restart-to-update")}>
          Restart to update
        </Button>
      )}
    </Row>
  );
}

/** How long a deleted page can still be brought back, before it goes to the Trash. */
const UNDO_SECONDS = 5;

function App() {
  const [snap, setSnap] = useState<PanelSnapshot | null>(null);
  const [pages, setPages] = useState<PanelPage[]>([]);
  const [chosen, setTab] = useRemembered<PanelTab>("panel.tab", "capture", (value): value is PanelTab => (PANEL_TABS as readonly unknown[]).includes(value));
  // Processing is there only while something is: a thought being filed or waiting its turn, or what came of the last one, until it is
  // put away. Chosen while it isn't there, the panel shows Capture.
  // What came of the last filing, kept as its card goes, so it can fade and close up rather than vanish (`Result`).
  const [leaving, setLeaving] = useState<PanelSnapshot["result"]>(null);
  const lastResult = useRef<PanelSnapshot["result"]>(null);
  const result = snap?.result ?? null;
  useEffect(() => {
    if (!result && lastResult.current) setLeaving(lastResult.current);
    if (result) setLeaving(null);
    lastResult.current = result;
  }, [result]);
  const processing = !!snap && (snap.filings.length > 0 || snap.result !== null || snap.transcribing !== null || leaving !== null);
  const tab: PanelTab = chosen === "processing" && !processing ? "capture" : chosen;
  // Ask your library… in Capture: Library comes forward with its field ready; each press counts up, so the field takes the focus again.
  const [focusAsk, setFocusAsk] = useState(0);
  const toAsk = useCallback(() => {
    setTab("library");
    setFocusAsk((n) => n + 1);
  }, []);
  // The pane Settings opens on when something asked for one before its tab showed.
  const [pane, setPane] = useState<SettingsPane | undefined>(undefined);
  const readPages = useCallback(() => void api.pages().then(setPages), []);
  useEffect(() => {
    api.get().then(setSnap);
    readPages();
    const offChanged = api.onChanged(setSnap);
    const offShown = api.onShown((next) => {
      if (next) setTab(next);
      readPages();
    });
    const offPane = window.avanzel.settings.onShowPane((next) => setPane(isSettingsPane(next) ? next : "general"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) api.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      offChanged();
      offShown();
      offPane();
      window.removeEventListener("keydown", onKey);
    };
  }, [readPages]);
  const version = snap?.pagesVersion;
  useEffect(() => {
    if (version !== undefined) readPages();
  }, [version, readPages]);
  if (!snap) return null;
  // The aura is behind the whole panel, every tab and its foot, and stirs while a recording listens.
  return (
    <Aura fill mood={snap.listening && snap.listening.pausedAt === null ? "listening" : "calm"}>
    <div className="panel">
      <header className="panel-head">
        <Tabs
          label="Sections"
          controls="panel-tab"
          options={[
            { value: "capture", label: "Capture" },
            ...(processing
              ? [{ value: "processing" as const, label: "Processing", ...(snap.filings.length > 0 ? { count: snap.filings.length, countLabel: thoughtsLabel(snap.filings.length) } : {}) }]
              : []),
            { value: "library", label: "Library", count: pages.length, countLabel: notesLabel(pages.length) },
            { value: "settings", label: "Settings" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </header>
      <div className="panel-body">
        <TabPanel
          id="panel-tab"
          value={tab}
          height="fill"
          pages={[
            { value: "capture", content: <Capture snap={snap} onAsk={toAsk} /> },
            ...(processing ? [{ value: "processing" as const, content: <Processing snap={snap} leaving={leaving} onLeft={() => setLeaving(null)} /> }] : []),
            { value: "library", content: <Library snap={snap} pages={pages} focusAsk={focusAsk} /> },
            { value: "settings", content: <SettingsApp embedded startPane={pane} /> },
          ]}
        />
      </div>
      <footer className="panel-foot">
        <Stack gap={6}>
          {tab !== "settings" && <UpdateReady update={snap.update} />}
          <Row gap={8} justify="between">
            <Button size="small" variant="quiet" icon="folder" onClick={() => act("open-library")}>Open library</Button>
            <Button size="small" variant="quiet" onClick={() => act("quit")}>Quit Avanzel</Button>
          </Row>
        </Stack>
      </footer>
    </div>
    </Aura>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
