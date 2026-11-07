import type { CSSProperties, ReactNode } from "react";
import { useFileDrop } from "../components/file-drop.ts";
import { Zel } from "../components/Zel.tsx";
import "../foundations.css";
import "./recording.css";

export interface RecordingStageProps {
  /** A recording listens: the stage shows it in place of `children`, over the whole of the place it is in. */
  active: boolean;
  /** It is paused: Zel rests, the wave lies flat, and the time stands still and blinks. */
  paused?: boolean;
  /** What is being recorded, or "Paused": "Recording a thought". */
  line: string;
  /** How long it has listened, "0:12". */
  time: string;
  /** The voice's levels, 0 to 1, newest last: each draws a bar, the newest in the middle and the older spreading out to both sides. */
  levels: readonly number[];
  /** The recording's controls, under it: when it is filed, Cancel, Pause and Stop. */
  controls: ReactNode;
  /** What the place shows when nothing records, such as the ways to start something new. */
  children: ReactNode;
  /**
   * Given, files can be dropped on the recording while it listens: while one is dragged over it the stage turns violet and says
   * `dropLabel` ("Drop to add to this recording"), and the files dropped are handed over.
   */
  onDropFiles?: (files: File[]) => void;
  dropLabel?: string;
}

/**
 * A place that becomes the recording while one listens, as the menu bar panel's Capture does: what it showed sinks away and fades,
 * and in its place Zel listens over a wide wave of the voice and a large time, with the recording's controls under them and nothing
 * else until it ends. When it ends the recording lifts away and what was there comes back.
 */
export function RecordingStage({ active, paused = false, line, time, levels, controls, children, onDropFiles, dropLabel = "Drop to add to this recording" }: RecordingStageProps) {
  const drop = useFileDrop(active ? onDropFiles : undefined);
  // The newest level in the middle, the older ones spreading out to both sides: the wave grows from the centre, as a voice does.
  const half = levels.slice(-14);
  const bars = [...[...half].reverse().slice(1), ...half];
  return (
    <div className="av-rec-stage" data-active={active ? "" : undefined} data-paused={paused ? "" : undefined} data-dropping={drop.over ? "" : undefined} {...drop.handlers}>
      {onDropFiles && (
        <span className="av-rec-drop" aria-hidden="true">
          <span className="av-rec-drop-words">{dropLabel}</span>
        </span>
      )}
      <div className="av-rec-idle" inert={active}>{children}</div>
      <div className="av-rec-live" inert={!active} role={active ? "group" : undefined} aria-label={active ? line : undefined}>
        <span className="av-rec-line">{line}</span>
        <span className="av-rec-zel"><Zel mood={paused ? "idle" : "listening"} size="large" /></span>
        <span className="av-rec-wave" aria-hidden="true">
          {bars.map((level, i) => {
            const edge = Math.sin(((i + 0.5) / bars.length) * Math.PI);
            const h = paused ? 0.08 : Math.max(0.08, level * (0.45 + 0.55 * edge));
            return <i key={i} style={{ "--_h": h.toFixed(3) } as CSSProperties} />;
          })}
        </span>
        <span className="av-rec-time">{time}</span>
        <span className="av-rec-controls">{controls}</span>
      </div>
    </div>
  );
}
