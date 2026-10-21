// Zel's bubble under the menu bar icon, once setup has flown there: where Avanzel waits, and how to talk to it from
// anywhere. Try it now records a thought. Until Avanzel can hear, the bubble promises no talking: it says how to type a
// thought instead, and Type a thought opens Quick. Not now, Esc or a click elsewhere puts the bubble away, for good.
import "@avanzel/ui/base.css";
import { Actions, Bubble, Button, Kbd, Text } from "@avanzel/ui";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { prettyAccelerator } from "../../main/shortcuts.ts";
import type { AvanzelBridge, UpHereSnapshot } from "../../shared/ipc.ts";
import "./styles.css";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

const { upHere } = window.avanzel;

function UpHere() {
  // The shortcuts as the person has them now, and whether Avanzel can hear yet.
  const [snap, setSnap] = useState<UpHereSnapshot | null>(null);
  useEffect(() => {
    void upHere.get().then(setSnap);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") upHere.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!snap) return null;
  const notNow = <Button size="small" variant="quiet" onClick={() => upHere.close()}>Not now</Button>;
  if (!snap.hears) {
    return (
      <Bubble
        title="I'm up here."
        tail="top-end"
        actions={
          <Actions>
            {notNow}
            <Button size="small" variant="primary" onClick={() => upHere.typeIt()}>Type a thought</Button>
          </Actions>
        }
      >
        <Text>
          My ears are still arriving. Press <Kbd>{prettyAccelerator(snap.typeShortcut)}</Kbd> anywhere to type a thought.
        </Text>
      </Bubble>
    );
  }
  return (
    <Bubble
      title="I'm up here."
      tail="top-end"
      actions={
        <Actions>
          {notNow}
          <Button size="small" variant="primary" onClick={() => upHere.tryIt()}>Try it now</Button>
        </Actions>
      }
    >
      <Text>
        Press <Kbd>{prettyAccelerator(snap.shortcut)}</Kbd> anywhere, say what's on your mind, and press it again.
      </Text>
    </Bubble>
  );
}

createRoot(document.getElementById("root")!).render(<UpHere />);
