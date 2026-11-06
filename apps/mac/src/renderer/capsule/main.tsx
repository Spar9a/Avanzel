import "@avanzel/ui/base.css";
import { Actions, Button, CapsuleNotice, Hud, Kbd, Progress, Row, Stack, Text, Zel } from "@avanzel/ui";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ACTION_NAMES, prettyAccelerator, takenMessage } from "../../main/shortcuts.ts";
import type { CapsuleState } from "../../shared/ipc.ts";
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
import { savedScene } from "./saved.tsx";
import { Bar, type Scene } from "./scene.tsx";
import { recordedScene, stoppedScene } from "./stopped.tsx";
import { transcribingScene } from "./transcribing.tsx";
import "./styles.css";

const BARS = 16;
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
 * What each stacked state draws, from the top of its stack: its card, the hint, and its bar. Every kind of state is here: a kind added
 * without a scene is a type error, not a blank panel, as `cancelled` and `recorded` were for two tasks.
 */
function sceneOf(state: Stacked, levels: readonly number[]): Scene {
  switch (state.kind) {
    case "listening":
      return listeningScene(state, levels);
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

function Capsule({ state, levels }: { state: CapsuleState; levels: readonly number[] }) {
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
      // The best one is the primary, so it goes last; with none free, Settings → Voice has the way out.
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
                {uses.length ? uses : <Button size="small" variant="primary" onClick={() => api.openSettingsFor("open-settings:voice")}>Open Settings</Button>}
              </Actions>
            }
          >
            {stillInMenuLine(state.key)}
          </CapsuleNotice>
        </div>
      );
    }
    default: {
      // The stack: a card if the state has one, the hint, and ONE bar, drawn in the same place for every state that has a bar, so that its
      // live region stays mounted from listening through filing to filed. `key` keeps the stack from being taken for the notice above.
      const { card, hint, bar } = sceneOf(state, levels);
      return (
        <div className="stack" key="stack">
          {card}
          {hint}
          {bar && <Bar kind={state.kind} {...bar} />}
        </div>
      );
    }
  }
}

function App() {
  const [state, setState] = useState<CapsuleState>({ kind: "hidden" });
  const stateRef = useRef(state);
  const listening = state.kind === "listening";
  const { levels, push } = useLevels(listening, listening && state.fakeMic && state.pausedAt === undefined);
  const recorder = useRef(new Recorder((level) => push(level)));
  /** While a call runs: the timer that sends its microphone to main in blocks. */
  const callBlocks = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (command === "start" && current.kind === "listening" && !fake) {
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
    }
  }), []);

  // The panel is click-through where nothing is drawn: the pointer entering a piece that is drawn makes the window take it (and hold
  // a card up), and leaving it gives it back. The wrapper takes no pointer itself (see `.app` in styles.css), only the pieces in it do.
  return (
    <div className="app" onMouseEnter={() => { api.setInteractive(true); api.keepOpen(true); }} onMouseLeave={() => { api.setInteractive(false); api.keepOpen(false); }}>
      <Capsule state={state} levels={levels} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
