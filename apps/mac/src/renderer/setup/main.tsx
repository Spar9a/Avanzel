// The setup window: the first run, one step at a time. It holds the step it shows and the snapshot from main; each
// step draws itself in the Frame.
import "@avanzel/ui/base.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AvanzelBridge, SetupSnapshot, SetupStep } from "../../shared/ipc.ts";
import { Found } from "./steps/Found.tsx";
import { Hello } from "./steps/Hello.tsx";
import "./styles.css";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

const api = window.avanzel.setup;

function Setup() {
  const [snap, setSnap] = useState<SetupSnapshot | null>(null);
  const [step, setStep] = useState<SetupStep>("hello");
  useEffect(() => {
    void api.get().then(setSnap);
    return api.onChanged(setSnap);
  }, []);
  if (!snap) return null;
  const go = (next: SetupStep) => {
    setStep(next);
    void api.enter(next).then(setSnap);
  };
  switch (step) {
    case "hello":
      return <Hello snap={snap} go={go} />;
    case "found":
      return <Found snap={snap} go={go} />;
    default:
      return null; // a step whose change hasn't come yet
  }
}

createRoot(document.getElementById("root")!).render(<Setup />);
