// The setup window: the first run, one step at a time. It holds the step it shows and the snapshot from main; each
// step draws itself in the Frame. At the end, Zel alone flies with the window into the menu bar.
import "@avanzel/ui/base.css";
import { Zel } from "@avanzel/ui";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AvanzelBridge, SetupSnapshot, SetupStep } from "../../shared/ipc.ts";
import { Ask } from "./steps/Ask.tsx";
import { Done } from "./steps/Done.tsx";
import { Filing } from "./steps/Filing.tsx";
import { Found } from "./steps/Found.tsx";
import { Hello } from "./steps/Hello.tsx";
import { Microphone } from "./steps/Microphone.tsx";
import { Screen } from "./steps/Screen.tsx";
import { Think } from "./steps/Think.tsx";
import "./styles.css";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

const api = window.avanzel.setup;

/**
 * Start using Avanzel, once the window shows Zel alone (Leaving): main is told, and flies the window into the menu bar
 * with Zel aboard. Main's flight holds its thread while macOS animates the frame, so main hears once Zel is drawn, after
 * the next frame; should no frame come, as for a window out of sight, a moment later all the same.
 */
function tellMain(): void {
  let told = false;
  const tell = () => {
    if (told) return;
    told = true;
    api.finish();
  };
  requestAnimationFrame(() => requestAnimationFrame(tell));
  setTimeout(tell, 250);
}

/** The window as it flies into the menu bar: Zel alone in its middle, looking up, where it goes. */
function Leaving() {
  return (
    <div className="leaving">
      <Zel mood="idle" size="medium" look="up" />
    </div>
  );
}

function Setup() {
  const [snap, setSnap] = useState<SetupSnapshot | null>(null);
  const [step, setStep] = useState<SetupStep>("hello");
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    void api.get().then(setSnap);
    return api.onChanged(setSnap);
  }, []);
  // A thought handed over on the first-thought step is being filed: the window follows it there. The controller has
  // entered that step already as it took the thought, so this only shows it (React redraws at once, before painting).
  if (step === "think" && snap?.filing) setStep("filing");
  if (leaving) return <Leaving />;
  if (!snap) return null;
  const go = (next: SetupStep) => {
    const entered = api.enter(next).then(setSnap);
    // The last step shows once the controller has entered it, which turns opening at login on: drawn before that, its
    // switch would show off for a frame, then slide on by itself.
    if (next === "done") void entered.finally(() => setStep(next));
    else setStep(next);
  };
  const finish = () => {
    if (leaving) return;
    setLeaving(true);
    tellMain();
  };
  switch (step) {
    case "hello":
      return <Hello snap={snap} go={go} />;
    case "found":
      return <Found snap={snap} go={go} />;
    case "microphone":
      return <Microphone snap={snap} go={go} />;
    case "think":
      return <Think snap={snap} go={go} />;
    case "filing":
      return <Filing snap={snap} go={go} />;
    case "ask":
      return <Ask snap={snap} go={go} />;
    case "screen":
      return <Screen snap={snap} go={go} />;
    case "done":
      return <Done snap={snap} go={go} finish={finish} />;
  }
}

createRoot(document.getElementById("root")!).render(<Setup />);
