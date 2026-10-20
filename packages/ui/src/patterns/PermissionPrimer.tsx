import { useId } from "react";
import { Button } from "../components/Button.tsx";
import { Zel } from "../components/Zel.tsx";
import "../foundations.css";
import "./primer.css";

/** The words are fixed: one button, "Continue", never "Allow" (Apple's HIG, "Privacy"), and each
    promise is true of what Avanzel does with that permission. */
const COPY = {
  microphone: {
    title: "Next, macOS asks about the microphone.",
    body: "I listen only while you can see me listening, and your voice becomes text on this Mac.",
  },
  screen: {
    title: "Next, macOS asks about screen recording.",
    body: "I look at the screen only when you capture with Screen on, and the picture goes to your agent with your words.",
  },
} as const;

export type PermissionKind = keyof typeof COPY;

export interface PermissionPrimerProps {
  kind: PermissionKind;
  /** Ask macOS right after this, while the reason is still on screen. */
  onContinue: () => void;
}

/** The screen before macOS's own permission prompt, shown at the moment the permission is needed. */
export function PermissionPrimer({ kind, onContinue }: PermissionPrimerProps) {
  const id = useId();
  const copy = COPY[kind];
  return (
    <div className="av-primer" role="dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}>
      <Zel mood="idle" size="small" animate={false} />
      <p id={`${id}-title`} className="av-primer-title">{copy.title}</p>
      <p id={`${id}-body`} className="av-primer-body">{copy.body}</p>
      <Button variant="primary" autoFocus onClick={onContinue}>Continue</Button>
    </div>
  );
}
