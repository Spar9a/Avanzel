import { Actions, Button, CapsuleNotice, Hud, Progress, Row, Stack, Text, Zel } from "@avanzel/ui";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { prettyAccelerator, takenMessage } from "../../main/shortcuts.ts";
import type { AvanzelBridge, CapsuleState, FiledPage, Shortcuts } from "../../shared/ipc.ts";
import { Recorder } from "./recorder.ts";
import "./styles.css";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

const api = window.avanzel.capsule;
const BARS = 16;

/** Whole megabytes, as macOS counts them. */
const mb = (bytes: number) => Math.round(bytes / 1e6);

/** Each action as the menu bar names it. */
const ACTION_NAMES: Record<keyof Shortcuts, string> = {
  dictate: "Record a thought",
  capture: "Capture screen with a comment",
  type: "Type a thought",
  ask: "Ask your library",
};

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

function Wave({ levels }: { levels: number[] }) {
  return (
    <span className="wave" aria-hidden="true">
      {levels.map((level, i) => (
        <b key={i} style={{ height: `${Math.round(5 + level * 19)}px` }} />
      ))}
    </span>
  );
}

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return <span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>;
}

function Close() {
  return <button className="close" aria-label="Dismiss" onClick={() => api.dismiss()}>×</button>;
}

function Pages({ pages }: { pages: FiledPage[] }) {
  return (
    <ul className="pages">
      {pages.map((page) => (
        <li key={page.path}>
          <span className="tag" style={{ ["--c" as string]: `var(--${page.shelf})` }} />
          <span className="title">{page.title}</span>
          <span className="shelf">{page.shelf}</span>
        </li>
      ))}
    </ul>
  );
}

function Editor({ text }: { text: string }) {
  const [value, setValue] = useState(text);
  return (
    <div className="hud card">
      <div className="row">Edit before filing</div>
      <textarea
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          api.editDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") api.cancelEdit();
          if (e.key === "Enter" && (e.metaKey || !e.shiftKey)) {
            e.preventDefault();
            api.submitEdit(value);
          }
        }}
      />
      <div className="actions">
        <button className="btn" onClick={() => api.cancelEdit()}>Cancel</button>
        <button className="btn primary" onClick={() => api.submitEdit(value)}>File</button>
      </div>
    </div>
  );
}

function Capsule({ state, levels }: { state: CapsuleState; levels: number[] }) {
  switch (state.kind) {
    case "hidden":
      return null;
    case "listening":
      return (
        <div className={`hud capsule${state.thumbnail ? " with-thumb" : ""}`} role="status" aria-label="Listening">
          {state.thumbnail && <img className="thumb" src={state.thumbnail} alt="" />}
          <span className="dot" />
          <Wave levels={levels} />
          <Timer since={state.startedAt} />
          <span className="chip">{state.mode === "comment" ? "Screen" : "Auto"}</span>
        </div>
      );
    case "transcribing":
      return (
        <div className="hud capsule" role="status">
          <span className="spin" />
          <span>Transcribing on this Mac…</span>
        </div>
      );
    case "filing":
      return (
        <div className="hud card" role="status">
          <Close />
          <div className="row"><span className="spin" />Filing with {state.agent}…</div>
          {state.waiting && <p className="detail">Waiting for another Avanzel run to finish…</p>}
          <p className="said">“{state.text}”</p>
          {state.detail && <p className="detail">{state.detail}</p>}
          <div className="foot">
            <span>{state.transcribedIn === null ? "Typed note" : `Transcribed on this Mac in ${state.transcribedIn.toFixed(1)} seconds`}</span>
            {state.canEdit && <button className="btn" onClick={() => api.edit()}>Edit</button>}
          </div>
        </div>
      );
    case "editing":
      return <Editor text={state.text} />;
    case "filed":
      return (
        <div className="hud card" role="status">
          <Close />
          <div className="row">
            <span className="okmark">
              <svg width="9" height="9" viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6 9.6 3.6" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            Filed by {state.agent}<span className="ago">in {Math.round(state.seconds)} s</span>
          </div>
          {state.pages.length ? <Pages pages={state.pages} /> : <p className="message">{state.message}</p>}
          <div className="actions">
            {state.canUndo && <button className="btn" onClick={() => api.undo()}>Undo</button>}
            {state.pages.length > 0 && <button className="btn primary" onClick={() => api.open()}>Open</button>}
          </div>
        </div>
      );
    case "saved":
      return (
        <div className="hud card" role="status">
          <Close />
          {(state.thumbnail || state.context) && (
            <div className="ctx">
              {state.thumbnail && <img className="shot" src={state.thumbnail} alt="" />}
              <div className="meta">
                {state.context?.app && <small>{state.context.app}</small>}
                {state.context?.title && <b>{state.context.title}</b>}
                {state.context?.url && <small>{state.context.url.replace(/^https?:\/\//, "")}</small>}
              </div>
            </div>
          )}
          {state.text && <p className="said">“{state.text}”</p>}
          {state.detail && <p className="detail">{state.detail}</p>}
          <div className="foot"><span>{state.note}</span></div>
        </div>
      );
    case "error":
      return (
        <div className="hud card" role="alert">
          <Close />
          <div className="row"><span className="warn">!</span>{state.message}</div>
          {state.detail && <p className="detail">{state.detail}</p>}
          <div className="actions">
            {state.action && <button className="btn" onClick={() => api.openSettingsFor(state.action ?? "")}>Open Settings</button>}
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
    case "model-failed":
      return (
        <div className="slot">
          <CapsuleNotice
            title="The speech model didn't finish downloading."
            actions={
              <Actions align="start">
                <Button size="small" variant="quiet" onClick={() => api.dismiss()}>Hide</Button>
                <Button size="small" variant="secondary" onClick={() => api.typeInstead()}>Type instead</Button>
                <Button size="small" variant="primary" onClick={() => api.retryDownload()}>Try again</Button>
              </Actions>
            }
          >
            Typing works in the meantime. Settings → Voice shows what went wrong.
          </CapsuleNotice>
        </div>
      );
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
            Pick another shortcut. {ACTION_NAMES[state.key]} is still in the menu bar.
          </CapsuleNotice>
        </div>
      );
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
