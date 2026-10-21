// Zel's bubble under the menu bar icon, once setup has flown there: where Avanzel waits, and how to talk to it from
// anywhere. Try it now records a thought; Not now, Esc or a click elsewhere puts the bubble away, for good.
import "@avanzel/ui/base.css";
import { Actions, Bubble, Button, Kbd, Text } from "@avanzel/ui";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import type { AvanzelBridge } from "../../shared/ipc.ts";
import "./styles.css";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

const { settings, upHere } = window.avanzel;

function UpHere() {
  // Record a thought's shortcut, as the person has it now.
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    void settings.get().then((snapshot) => setShortcut(snapshot.app.shortcuts.dictate));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") upHere.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!shortcut) return null;
  return (
    <Bubble
      title="I'm up here."
      tail="top-end"
      actions={
        <Actions>
          <Button size="small" variant="quiet" onClick={() => upHere.close()}>Not now</Button>
          <Button size="small" variant="primary" onClick={() => upHere.tryIt()}>Try it now</Button>
        </Actions>
      }
    >
      <Text>
        Press <Kbd>{prettyAccelerator(shortcut)}</Kbd> anywhere, say what's on your mind, and press it again.
      </Text>
    </Bubble>
  );
}

createRoot(document.getElementById("root")!).render(<UpHere />);
