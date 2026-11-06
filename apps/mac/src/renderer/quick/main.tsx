// Quick: type a thought. macOS draws the panel; this clear page holds the one field and the key that saves. Return saves
// the words and puts the panel away; when they can't be saved (the capsule says why) they stay in the field for another
// try. Esc puts the panel away from wherever the focus is.
import "@avanzel/ui/base.css";
import { Button, TextField } from "@avanzel/ui";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AvanzelBridge } from "../../shared/ipc.ts";
import "./styles.css";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

const api = window.avanzel.quick;

function Quick() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") api.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The panel is put away as a thought is saved, and the field is disabled until the save is over. That takes the focus
  // from the field, so it takes the focus back once it is enabled again: the next time the panel opens, a person can
  // type at once.
  useEffect(() => {
    if (!busy) field.current?.focus();
  }, [busy]);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.submit(text);
      setText("");
    } catch {
      // Not saved (the capsule says why): the words stay here for another try.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quick">
      <div className="quick-field">
        <TextField ref={field} label="Type a thought" labelHidden size="large" variant="bare" icon="waveform" placeholder="Type a thought…" value={text} onChange={setText} autoFocus disabled={busy} onEnter={submit} />
      </div>
      {/* A plain Save, as every save is: Return does the same, and its tooltip says so. */}
      <Button variant="primary" disabled={!text.trim()} busy={busy} onClick={() => void submit()}>Save</Button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Quick />);
