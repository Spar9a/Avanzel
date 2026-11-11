import "@avanzel/ui/base.css";
import { Actions, Button, CapsuleAppear, CapsuleMenu, CapsuleNotice, Hud, Items, Kbd, Progress, Row, Stack, Text, Zel } from "@avanzel/ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { ACTION_NAMES, prettyAccelerator, takenMessage } from "../../main/shortcuts.ts";
import type { AddingKind, AttachedItem, CapsuleState } from "../../shared/ipc.ts";
import { addChoices, attachedItems } from "../common/attached.ts";
import { downloadFailedProblem } from "../../shared/problems.ts";
import { CALL_RUNNING_LINE, DICTATION_REFUSED_LINE } from "../../shared/transcribing.ts";
import { api, type StateOf } from "./api.ts";
import { stillInMenuLine } from "./copy.ts";
import { editorScene } from "./editor.tsx";
import { filedScene } from "./filed.tsx";
import { filingScene } from "./filing.tsx";
import { listeningScene } from "./listening.tsx";
import { ProblemNotice } from "./problem-notice.tsx";
import { Recorder } from "./recorder.ts";
import { TriggerListener } from "./trigger-listener.ts";
import { savedScene } from "./saved.tsx";
import { Bar, type Scene } from "./scene.tsx";
import { recordedScene, stoppedScene } from "./stopped.tsx";
import { transcribingScene } from "./transcribing.tsx";
import "./styles.css";

const BARS = 24;
/** How often a recording's microphone is sent to main while it listens, and so about how often its words on the panel change. */
const LIVE_BLOCK_MS = 1000;
/** How long the capsule sinks away before it is drawn no more: `CapsuleAppear`'s leaving (`--av-duration-base`). */
const CAPSULE_LEAVE_MS = 200;
/** How often a call's microphone is sent to main, as a block, while the call runs. */
const CALL_BLOCK_MS = 5_000;

/** Whole megabytes, as macOS counts them. */
const mb = (bytes: number) => Math.round(bytes / 1e6);

/** How often a level is passed on to main for the menu bar panel, which shows the recording too: often enough for its wave. */
const LEVEL_SEND_MS = 60;

function useLevels(listening: boolean, fake: boolean) {
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.08));
  const sent = useRef(0);
  const push = (level: number) => {
    setLevels((prev) => [...prev.slice(1), Math.max(0.08, level)]);
    const now = Date.now();
    if (now - sent.current >= LEVEL_SEND_MS) {
      sent.current = now;
      api.level(level);
    }
  };
  useEffect(() => {
    if (!listening || !fake) return;
    const timer = setInterval(() => push(0.15 + Math.random() * 0.75), 60);
    return () => clearInterval(timer);
  }, [listening, fake]);
  return { levels, push };
}

/** The states whose pieces stack up from the bottom of the panel, and so are drawn by a `Scene`: the others are one notice or card of their own. */
type Stacked = Exclude<CapsuleState, { kind: "hidden" | "error" | "preparing" | "model-failed" | "shortcut-taken" }>;

/**
 * A free shortcut picked on the taken-shortcut notice works. A bar and nothing else, a piece of the stack as every bar is: the page's
 * wrapper takes no pointer (see styles.css), so a bar outside the stack could not be hovered, and would be put away under the pointer.
 * It is as wide as the others. The shortcut is set as a key, as the listening hint sets its keys.
 */
function pickedScene(state: StateOf<"shortcut-picked">): Scene {
  return {
    bar: {
      mood: "filed",
      line: (
        <>
          {ACTION_NAMES[state.key]} now uses <Kbd>{prettyAccelerator(state.accelerator)}</Kbd>
        </>
      ),
    },
  };
}

/**
 * The Undo shortcut was pressed with no filing to take back. A bar and nothing else, drawn as the picked shortcut's is (`pickedScene`). It
 * has no button: nothing is asked of the person, and it goes by itself.
 */
function nothingToUndoScene(): Scene {
  return { bar: { mood: "filed", line: "There's no filing to undo." } };
}

/** A thought, a screen comment or a question was asked for while notes on a call are taken: a bar says so, drawn as Undo's is. */
function callRunningScene(): Scene {
  return { bar: { mood: "filed", line: CALL_RUNNING_LINE } };
}

/** A dictation into any app was asked for while something else records: a bar says so, drawn as the call's is. */
function dictationRefusedScene(): Scene {
  return { bar: { mood: "filed", line: DICTATION_REFUSED_LINE } };
}

/**
 * What each stacked state draws, from the top of its stack: its card and its bar. Every kind of state is here: a kind added
 * without a scene is a type error, not a blank panel, as `cancelled` and `recorded` were for two tasks.
 */
function sceneOf(state: Stacked, levels: readonly number[], onAdd?: () => void): Scene {
  switch (state.kind) {
    case "listening":
      return listeningScene(state, levels, onAdd);
    case "transcribing":
      return transcribingScene(state);
    case "filing":
      return filingScene(state);
    case "editing":
      return editorScene(state);
    case "filed":
      return filedScene(state);
    case "saved":
      return savedScene(state);
    case "cancelled":
      return stoppedScene(state);
    case "recorded":
      return recordedScene(state);
    case "shortcut-picked":
      return pickedScene(state);
    case "nothing-to-undo":
      return nothingToUndoScene();
    case "call-running":
      return callRunningScene();
    case "dictation-refused":
      return dictationRefusedScene();
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

function Capsule({ state, levels, adding, onAdd, onAddDone }: { state: CapsuleState; levels: readonly number[]; adding: boolean; onAdd(): void; onAddDone(): void }) {
  switch (state.kind) {
    case "hidden":
      return null;
    case "error":
      return <ProblemNotice state={state} />;
    case "preparing":
      // Zel idles: no agent runs. It looks to the right, towards the words, and never out at the person (DESIGN.md). Only the headline is a
      // live region, so VoiceOver hears the start once, not each step.
      return (
        <div className="slot">
          <Hud>
            <Row gap={12} align="start">
              <Zel mood="idle" size="small" look="right" />
              <div className="fill">
                <Stack gap={8}>
                  <div role="status"><Text variant="headline">The speech model is still downloading.</Text></div>
                  <Progress label="Downloading the speech model" value={state.totalBytes ? state.receivedBytes / state.totalBytes : undefined} />
                  <Text variant="footnote" tone="secondary" numeric>
                    {state.totalBytes > 0 && `${mb(state.receivedBytes)} of ${mb(state.totalBytes)} MB. `}Typing works now.
                  </Text>
                  <Actions align="start">
                    <Button size="small" variant="quiet" onClick={() => api.dismiss()}>Hide</Button>
                    <Button size="small" variant="primary" onClick={() => api.typeInstead()}>Type instead</Button>
                  </Actions>
                </Stack>
              </div>
            </Row>
          </Hud>
        </div>
      );
    case "model-failed": {
      // The same words as Settings → Voice: why, and whether Try again continues where the download stopped.
      const problem = downloadFailedProblem(state.reason, state.resumable);
      return (
        <div className="slot">
          <CapsuleNotice
            title={problem.title}
            actions={
              <Actions align="start">
                <Button size="small" variant="quiet" onClick={() => api.dismiss()}>Hide</Button>
                <Button size="small" variant="secondary" onClick={() => api.typeInstead()}>Type instead</Button>
                <Button size="small" variant="primary" onClick={() => api.retryDownload()}>Try again</Button>
              </Actions>
            }
          >
            {problem.body}
          </CapsuleNotice>
        </div>
      );
    }
    case "shortcut-taken": {
      // The best one is the primary, so it goes last; with none free, Settings → General has the way out.
      const uses = state.alternatives
        .map((alternative, i) => (
          <Button key={alternative} size="small" variant={i === 0 ? "primary" : "secondary"} onClick={() => api.useShortcut(state.key, alternative)}>
            {`Use ${prettyAccelerator(alternative)}`}
          </Button>
        ))
        .reverse();
      return (
        <div className="slot">
          <CapsuleNotice
            title={takenMessage(state.accelerator, state.holder)}
            actions={
              <Actions align="start">
                <Button size="small" variant="quiet" onClick={() => api.dismiss()}>Hide</Button>
                {uses.length ? uses : <Button size="small" variant="primary" onClick={() => api.openSettingsFor("open-settings:shortcuts")}>Open Settings</Button>}
              </Actions>
            }
          >
            {stillInMenuLine(state.key)}
          </CapsuleNotice>
        </div>
      );
    }
    default: {
      // The stack: a card if the state has one, and ONE bar, drawn in the same place for every state that has a bar, so that its live
      // region stays mounted from listening through filing to filed. `key` keeps the stack from being taken for the notice above.
      const { card, bar, through } = sceneOf(state, levels, onAdd);
      return (
        <div className="stack" key="stack">
          {card && <div className="stack-card">{card}</div>}
          {/* The recording's Add menu over its bar (it rises in as its + opens it, and sinks away as it closes or the recording ends), and
              the bar: one place for dropped files while the recording takes them. */}
          <DropArea drops={state.kind === "listening" && state.mode === "dictate" && state.fileMode !== null && !state.dictation}>
            <AddMenu
              open={state.kind === "listening" && adding}
              attached={state.kind === "listening" ? (state.attached ?? []) : []}
              adding={state.kind === "listening" ? state.adding : undefined}
              onClose={onAddDone}
            />
            {bar && (
              <div className={through ? "stack-bar through" : "stack-bar"}>
                <Bar kind={state.kind} {...bar} />
              </div>
            )}
          </DropArea>
        </div>
      );
    }
  }
}

/**
 * The Add menu and the bar, together in the stack. While they take dropped files (`drops`) this tells main where they are, as they move
 * or change size (the menu opening, the bar growing): the capsule lets the pointer through where nothing is drawn, a drag brings it no
 * pointer events, and main makes it take the pointer over this place itself (`setDropZone`), so a file dragged onto either lands on it.
 */
function DropArea({ drops, children }: { drops: boolean; children: ReactNode }) {
  const area = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = area.current;
    if (!drops || !el) return;
    const send = () => {
      const box = el.getBoundingClientRect();
      api.setDropZone({ x: box.x, y: box.y, width: box.width, height: box.height });
    };
    send();
    const watch = new ResizeObserver(send);
    watch.observe(el);
    return () => {
      watch.disconnect();
      api.setDropZone(null);
    };
  }, [drops]);
  return <div ref={area} className="stack-drop">{children}</div>;
}

/**
 * The recording's Add menu, over its bar (`CapsuleMenu`): a file, a screenshot of the screen as it is, or a video of a part of it, to go
 * with its note, one under another; under them what goes with it so far. Files can be dropped on the bar as well.
 */
function AddMenu({ open, attached, adding, onClose }: { open: boolean; attached: readonly AttachedItem[]; adding: AddingKind | undefined; onClose(): void }) {
  const list = attachedItems(attached, adding);
  return (
    <CapsuleMenu
      open={open}
      title="Add to this recording"
      onClose={onClose}
      onDropFiles={(files) => api.attachToRecording(files)}
      items={addChoices(adding, {
        file: () => api.addFiles(),
        screenshot: () => api.addScreenshot(),
        area: () => api.addScreenshot(true),
        marks: () => api.addMarked(),
        video: () => api.addVideo(),
      })}
    >
      {/* What goes with it so far, each with when it was added, and its × to take it off; a screenshot on its way spins. */}
      {list.length > 0 ? <Items items={list} onRemove={(i) => api.removeAttachment(i)} /> : undefined}
    </CapsuleMenu>
  );
}

/** Whether the capsule shows anything for `state`: all but hidden, a filing and what came of it among them (Processing shows those too). */
const showsSomething = (state: CapsuleState) => state.kind !== "hidden";

/**
 * What the capsule draws, as it comes and goes (`CapsuleAppear`): the state while it shows something; once it shows nothing, the last
 * state that did, `leaving`, for as long as it takes to sink away (main hides the window after the same time). `time` counts each
 * coming up, so the capsule rises in again each time, while what changes in it as it stays up changes in place.
 */
function useAppearing(state: CapsuleState): { drawn: CapsuleState | null; leaving: boolean; time: number } {
  const [appearing, setAppearing] = useState<{ drawn: CapsuleState | null; leaving: boolean; time: number }>({ drawn: null, leaving: false, time: 0 });
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
    if (showsSomething(state)) {
      setAppearing((now) => ({ drawn: state, leaving: false, time: now.drawn && !now.leaving ? now.time : now.time + 1 }));
      return;
    }
    setAppearing((now) => (now.drawn ? { ...now, leaving: true } : now));
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      setAppearing((now) => ({ ...now, drawn: null, leaving: false }));
    }, CAPSULE_LEAVE_MS);
  }, [state]);
  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);
  return appearing;
}

/**
 * Whether the pointer is on a piece the capsule draws, told to main as it changes: the window takes the pointer, and holds a card up
 * (`keepOpen`), only while it is. It is read from the element each `mouseover` lands on, not from leave events: a piece taken away
 * under the pointer (a taken shortcut's notice, which the picked bar replaces after its Use is clicked) sends none as it goes, and the
 * pointer's next move was then no leave to React's onMouseLeave either. The capsule went on taking every click over its empty corners,
 * and held its bar up, until the pointer crossed a piece again. A `mouseout` to nothing is the pointer leaving the window.
 */
function usePointerOnPieces(app: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    let on = false;
    const set = (now: boolean) => {
      if (now === on) return;
      on = now;
      api.setInteractive(now);
      api.keepOpen(now);
    };
    const over = (event: MouseEvent) => set(event.target instanceof Node && !!app.current?.contains(event.target));
    const out = (event: MouseEvent) => {
      if (event.relatedTarget === null) set(false);
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
    };
  }, [app]);
}

function App() {
  const [state, setState] = useState<CapsuleState>({ kind: "hidden" });
  const stateRef = useRef(state);
  const listening = state.kind === "listening";
  const { levels, push } = useLevels(listening, listening && state.fakeMic && state.pausedAt === undefined);
  const recorder = useRef(new Recorder((level) => push(level)));
  // The voice trigger's ear, while it is on: spans of speech go to main, which listens for the word.
  const trigger = useRef(new TriggerListener((samples) => void api.sendTriggerAudio(samples)));
  // The recording's Add menu over the bar: its + opens and closes it, and it closes when the recording ends.
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!listening) setAdding(false);
  }, [listening]);
  const appearing = useAppearing(state);
  /** While a call runs: the timer that sends its microphone to main in blocks. */
  const callBlocks = useRef<ReturnType<typeof setInterval> | null>(null);
  /** While a recording listens: the timer that sends main what its microphone has just heard, for its words as they are said. */
  const liveBlocks = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const off = api.onState((next) => {
      stateRef.current = next;
      setState(next);
    });
    api.ready();
    return off;
  }, []);

  useEffect(() => api.onCommand(async (command) => {
    const current = stateRef.current;
    const fake = current.kind === "listening" && current.fakeMic;
    // A recording's end stops the blocks of its words before anything else, so that none goes after its last audio.
    if (command === "stop" || command === "cancel") {
      if (liveBlocks.current) clearInterval(liveBlocks.current);
      liveBlocks.current = null;
    }
    if (command === "start" && current.kind === "listening" && !fake) {
      // Set before the microphone opens, as for a call: a stop that comes while it opens finds it, and clears it. `fresh` is empty till then.
      if (current.live) {
        liveBlocks.current = setInterval(() => {
          const block = recorder.current.fresh();
          if (block.length > 0) api.sendLiveAudio(block);
        }, LIVE_BLOCK_MS);
      }
      try {
        await recorder.current.start(current.microphoneId);
      } catch (error) {
        api.reportMicError(error instanceof Error ? error.message : String(error));
      }
    } else if (command === "stop") {
      const samples = fake ? new Float32Array(0) : await recorder.current.stop();
      await api.sendAudio(samples);
    } else if (command === "cancel") {
      await recorder.current.cancel();
    } else if (command === "pause") {
      recorder.current.pause();
    } else if (command === "resume") {
      recorder.current.resume();
    } else if (typeof command === "string") {
      // a recording's start on a card that doesn't listen, or with the fake microphone: nothing to open
    } else if (command.kind === "call-start" && current.kind === "listening" && !fake) {
      // Set before the microphone opens: a stop that comes while it opens finds it, and clears it. Each block carries the call's id.
      callBlocks.current = setInterval(() => {
        const block = recorder.current.drain();
        if (block.length > 0) void api.sendCallAudio(command.call, block, false);
      }, CALL_BLOCK_MS);
      try {
        await recorder.current.start(current.microphoneId);
      } catch (error) {
        api.reportMicError(error instanceof Error ? error.message : String(error));
      }
    } else if (command.kind === "call-stop") {
      if (callBlocks.current) clearInterval(callBlocks.current);
      callBlocks.current = null;
      await api.sendCallAudio(command.call, await recorder.current.stop(), true);
    } else if (command.kind === "trigger") {
      // The voice trigger: its own ear on the microphone, apart from the recorder's, so either can be open while the other is.
      try {
        if (command.on) await trigger.current.start(command.microphoneId);
        else await trigger.current.stop();
      } catch (error) {
        console.warn("voice trigger", error);
      }
    }
  }), []);

  // The panel is click-through where nothing is drawn: the pointer on a piece that is drawn makes the window take it (and hold a card
  // up), and the pointer off every piece gives it back (`usePointerOnPieces`). The wrapper takes no pointer itself (see `.app` in
  // styles.css), only the pieces in it do.
  const app = useRef<HTMLDivElement>(null);
  usePointerOnPieces(app);
  return (
    <div ref={app} className="app">
      {appearing.drawn && (
        <CapsuleAppear key={appearing.time} leaving={appearing.leaving}>
          <Capsule state={appearing.drawn} levels={levels} adding={adding} onAdd={() => setAdding(!adding)} onAddDone={() => setAdding(false)} />
        </CapsuleAppear>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
