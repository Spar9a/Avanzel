import { Button } from "../components/Button.tsx";
import { TextField } from "../components/TextField.tsx";
import { Wave } from "../components/Wave.tsx";
import "../foundations.css";
import "./spokenfield.css";

export interface SpokenFieldProps {
  /** Names the field for VoiceOver: "Trigger word". It isn't shown: the row it sits in says it. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The microphone hears it now: the field gives way to the voice, and the button stops it. */
  listening: boolean;
  /** The voice's levels while it listens, 0 to 1, newest last. */
  levels: readonly number[];
  /** The button beside the field: it starts listening, or, while it listens, stops. */
  onListen: () => void;
  /** What the button does, said by VoiceOver and its tooltip: "Say the trigger word". */
  listenLabel: string;
}

/**
 * How many levels the voice's track always shows: quiet ones before the first heard, so it is full from the start and never grows.
 * No more than its 200 px box has bars for (one per 5 px, past the dot and padding), so the newest, at the right, are never cut off.
 */
const TRACK = 28;

/** The newest TRACK levels, quiet ones in front while fewer have been heard. */
function track(levels: readonly number[]): number[] {
  const newest = levels.slice(-TRACK);
  return [...Array.from({ length: TRACK - newest.length }, () => 0), ...newest];
}

/**
 * A short field that can be said rather than typed, such as a trigger word: the field, and beside it a microphone. Pressed, the field
 * gives way to the voice, a red dot and the wave of what is heard, and the microphone becomes a Stop that pulses; when the word is
 * heard (or Stop is pressed) the field comes back with it. Each comes in as the other goes.
 */
export function SpokenField({ label, value, onChange, placeholder, listening, levels, onListen, listenLabel }: SpokenFieldProps) {
  return (
    <div className="av-spoken-field" data-listening={listening ? "" : undefined}>
      <div className="av-spoken-field-slot">
        {listening ? (
          <div key="voice" className="av-spoken-field-voice" role="status" aria-label="Listening">
            <span className="av-spoken-field-dot" aria-hidden="true" />
            <Wave levels={track(levels)} fill />
          </div>
        ) : (
          <div key="field" className="av-spoken-field-input">
            <TextField label={label} labelHidden value={value} onChange={onChange} {...(placeholder ? { placeholder } : {})} />
          </div>
        )}
      </div>
      <span className="av-spoken-field-button">
        <Button
          variant="primary"
          icon={listening ? "stop" : "mic"}
          label={listening ? "Stop listening" : listenLabel}
          expanded={listening}
          onClick={onListen}
        />
      </span>
    </div>
  );
}
