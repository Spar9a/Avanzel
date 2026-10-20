import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AvanzelBridge } from "../../shared/ipc.ts";
import "../common/mac.css";
import "./styles.css";

declare global {
  interface Window { avanzel: AvanzelBridge }
}

function Quick() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await window.avanzel.quick.submit(text);
      setText("");
    } catch {
      // Not saved (the capsule says why): the words stay here for another try.
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="quick">
      <svg className="glyph" width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"><path d="M3 12V7M7 12V3M11 12V6M15 12V9M1 14.5h16" /></svg>
      <input
        type="text"
        autoFocus
        aria-label="Type a thought"
        placeholder="Type a thought…"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") window.avanzel.quick.close();
        }}
      />
      <span className="hint">↩ to save</span>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Quick />);
