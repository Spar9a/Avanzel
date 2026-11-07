// A recording's controls, shared by the capsule's bar and the menu bar panel's recording.
import { Button, Segmented } from "@avanzel/ui";
import type { ReactNode } from "react";
import type { FileMode } from "../../shared/ipc.ts";
import { fileModeChoices, stopLabel } from "../../shared/transcribing.ts";
import { addLabel } from "./attached.ts";
import "./listening-controls.css";

/**
 * A recording's controls, as recorders have them: when the agent files it (✦ now, or ☾ at the evening review), then ✕ to give it
 * up, ❚❚ to pause (▶ to go on), and ■ to stop, which wears the chosen sign, so it shows what stopping will do. Choosing when starts
 * nothing: the recording goes on, and only what happens after it stops changes.
 */
export function ListeningControls(props: {
  fileMode: FileMode | null;
  review: string | null;
  paused: boolean;
  onFileMode: (mode: FileMode) => void;
  onCancel: () => void;
  onPause: () => void;
  onStop: () => void;
  /** The when over the buttons, as the panel's recording shows them; the capsule's bar has them all in one line. */
  stacked?: boolean;
  /** Given, a + first: Add, a file or a screenshot to go with the recording (the capsule's menu over its bar). */
  onAdd?: () => void;
  /** In the + 's place, a control of the window's own: the panel's menu of what can be added. */
  add?: ReactNode;
  /** How many files go with the recording: a number on the Add button while there are any. */
  attached?: number;
}) {
  const { fileMode, review, paused } = props;
  const choices = fileModeChoices(review);
  return (
    <span className="listening-controls" data-stacked={props.stacked ? "" : undefined}>
      {fileMode && (
        <Segmented
          size="large"
          label="When your agent files this recording"
          options={[
            { value: "now", label: choices.now, icon: "spark" },
            { value: "evening", label: choices.evening, icon: "moon" },
          ]}
          value={fileMode}
          onChange={props.onFileMode}
        />
      )}
      <span className="listening-buttons">
        {props.add ??
          (props.onAdd && (
            <Button size="xlarge" variant="secondary" icon="attach" label={addLabel(props.attached ?? 0)} count={props.attached ?? 0} onClick={props.onAdd} />
          ))}
        <Button size="xlarge" variant="secondary" icon="close" label="Cancel the recording" onClick={props.onCancel} />
        <Button size="xlarge" variant="secondary" icon={paused ? "play" : "pause"} label={paused ? "Resume" : "Pause"} onClick={props.onPause} />
        <Button
          size="xlarge"
          variant="primary"
          icon="stop"
          label={stopLabel(fileMode, review)}
          {...(fileMode ? { badge: fileMode === "now" ? ("spark" as const) : ("moon" as const) } : {})}
          onClick={props.onStop}
        />
      </span>
    </span>
  );
}
