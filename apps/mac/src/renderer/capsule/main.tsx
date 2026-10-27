import "@avanzel/ui/base.css";
import { Actions, Button, CapsuleNotice, Hud, Kbd, Progress, Row, Stack, Text, Zel } from "@avanzel/ui";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ACTION_NAMES, prettyAccelerator, takenMessage } from "../../main/shortcuts.ts";
import type { CapsuleState } from "../../shared/ipc.ts";
import { downloadFailedProblem } from "../../shared/problems.ts";
import { playSound, prepareSounds, releaseSounds } from "../common/sounds.ts";
import { api, type StateOf } from "./api.ts";
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

/** Whole megabytes, as macOS counts them. */
const mb = (bytes: number) => Math.round(bytes / 1e6);

function useLevels(listening: boolean, fake: boolean) {
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.08));
  const push = (level: number) => setLevels((prev) => [...prev.slice(1), Math.max(0.08, level)]);
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
            Pick another shortcut. “{ACTION_NAMES[state.key]}” is still in the menu bar.
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

/**
 * When the filed card's stamp lands, in milliseconds after the card is drawn: 60% of `--av-duration-card` (380 ms), where `av-stamp-in`
 * has the stamp touch the paper (stamp.css). The Stamp is the thud of that moment.
 */
const STAMP_LANDS_MS = 228;

/**
 * Plays the Stamp main sent with a filed card, as its stamp lands. Where the stamp is drawn already landed, that is at once: under Reduce
 * Motion, and on a Noted card, whose stamp does not animate. A card put away before the stamp lands makes no sound (`current` is read
 * again then): the stamp never landed, and a sound without its picture is not the twin it is meant to be.
 */
function playStamp(current: () => CapsuleState): void {
  const state = current();
  const drawnLanded = matchMedia("(prefers-reduced-motion: reduce)").matches || (state.kind === "filed" && state.noted);
  if (drawnLanded) return playSound("stamp");
  setTimeout(() => {
    if (current().kind === "filed") playSound("stamp");
  }, STAMP_LANDS_MS);
}

function App() {
  const [state, setState] = useState<CapsuleState>({ kind: "hidden" });
  const stateRef = useRef(state);
  /** A Tock main has sent, held until the stop or cancel that follows it has let go of the microphone. */
  const tockWaits = useRef(false);
  const listening = state.kind === "listening";
  const { levels, push } = useLevels(listening, listening && state.fakeMic);
  const recorder = useRef(new Recorder((level) => push(level)));

  useEffect(() => {
    const off = api.onState((next) => {
      stateRef.current = next;
      setState(next);
    });
    api.ready();
    return off;
  }, []);

  // The page plays what main sends, when main sends it, with two exceptions that are its own to time: the Tock waits for the microphone
  // (below), and the Stamp for the stamp to land (`playStamp`).
  useEffect(() => api.onSound((name) => {
    if (name === "tock") tockWaits.current = true;
    else if (name === "stamp") playStamp(() => stateRef.current);
    else playSound(name);
  }), []);

  // Sounds on, or on at load: the page makes its AudioContext now, so that the first Tick doesn't wait for the audio device to open, which
  // takes a tenth of a second and would delay the listening card. Off: it closes the context, which lets go of the device.
  useEffect(() => api.onSoundsSetting((on) => (on ? prepareSounds() : releaseSounds())), []);

  useEffect(() => api.onCommand(async (command) => {
    const current = stateRef.current;
    const fake = current.kind === "listening" && current.fakeMic;
    // The Tock main sent ahead of a stop or a cancel is played once that has let go of the microphone: it can't be heard in the recording
    // then, and the audio that is sent next (up to 38 MB) can't make it late. With no recorder running (the fake microphone) there is
    // nothing to let go of, and it plays at once.
    const playTock = () => {
      if (!tockWaits.current) return;
      tockWaits.current = false;
      playSound("tock");
    };
    if (command === "start" && current.kind === "listening" && !fake) {
      try {
        await recorder.current.start(current.microphoneId);
      } catch (error) {
        api.reportMicError(error instanceof Error ? error.message : String(error));
      }
    } else if (command === "stop") {
      const samples = fake ? new Float32Array(0) : await recorder.current.stop();
      playTock();
      await api.sendAudio(samples);
    } else if (command === "cancel") {
      await recorder.current.cancel();
      playTock();
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
