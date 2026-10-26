import "@avanzel/ui/base.css";
import { Actions, Button, CapsuleBar, CapsuleNotice, Hud, Progress, Row, Stack, Text, Zel } from "@avanzel/ui";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ACTION_NAMES, prettyAccelerator, takenMessage } from "../../main/shortcuts.ts";
import type { CapsuleState } from "../../shared/ipc.ts";
import { downloadFailedProblem } from "../../shared/problems.ts";
import { api } from "./api.ts";
import { Editor } from "./editor.tsx";
import { Filed } from "./filed.tsx";
import { Filing } from "./filing.tsx";
import { Listening } from "./listening.tsx";
import { Recorder } from "./recorder.ts";
import { Saved } from "./saved.tsx";
import { Recorded, Stopped } from "./stopped.tsx";
import { Transcribing } from "./transcribing.tsx";
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

function Close() {
  return <button className="close" aria-label="Dismiss" onClick={() => api.dismiss()}>×</button>;
}

function Capsule({ state, levels }: { state: CapsuleState; levels: number[] }) {
  switch (state.kind) {
    case "hidden":
      return null;
    case "listening":
      return <Listening state={state} levels={levels} />;
    case "transcribing":
      return <Transcribing state={state} />;
    case "filing":
      return <Filing state={state} />;
    case "editing":
      return <Editor text={state.text} />;
    case "filed":
      return <Filed state={state} />;
    case "saved":
      return <Saved state={state} />;
    case "cancelled":
      return <Stopped state={state} />;
    case "recorded":
      return <Recorded state={state} />;
    case "error":
      return (
        <div className="hud card" role="alert">
          <Close />
          <div className="row"><span className="warn">!</span>{state.message}</div>
          {state.detail && <p className="detail">{state.detail}</p>}
          <div className="actions">
            {state.action && <button className="btn" onClick={() => api.openSettingsFor(state.action ?? "")}>{state.actionLabel ?? "Open Settings"}</button>}
            <button className="btn primary" onClick={() => api.dismiss()}>OK</button>
          </div>
        </div>
      );
    case "preparing":
      // Zel idles: no agent runs. Only the headline is a live region, so VoiceOver hears the start once, not each step.
      return (
        <div className="slot">
          <Hud>
            <Row gap={12} align="start">
              <Zel mood="idle" size="small" />
              <div className="fill">
                <Stack gap={8}>
                  <div role="status"><Text variant="headline">The speech model is still downloading</Text></div>
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
    case "shortcut-picked":
      return <CapsuleBar mood="filed">{`${ACTION_NAMES[state.key]} now uses ${prettyAccelerator(state.accelerator)}`}</CapsuleBar>;
    default: {
      // Every kind of state has its card above. A kind added without one is a type error here, not a blank panel, as `cancelled` and
      // `recorded` were for two tasks.
      const unhandled: never = state;
      return unhandled;
    }
  }
}

function App() {
  const [state, setState] = useState<CapsuleState>({ kind: "hidden" });
  const stateRef = useRef(state);
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
    }
  }), []);

  return (
    <div onMouseEnter={() => { api.setInteractive(true); api.keepOpen(true); }} onMouseLeave={() => { api.setInteractive(false); api.keepOpen(false); }}>
      <Capsule state={state} levels={levels} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
