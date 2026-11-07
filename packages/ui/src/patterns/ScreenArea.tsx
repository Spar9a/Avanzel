import type { CSSProperties } from "react";
import { Button } from "../components/Button.tsx";
import { Hud } from "../components/Hud.tsx";
import "../foundations.css";
import "./screenarea.css";

export interface ScreenAreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenAreaProps {
  /** The area picked so far, in the window's points; null before the drag begins: the whole screen is dimmed then. */
  rect: ScreenAreaRect | null;
  /** It records: the dim lifts, the area keeps a solid edge, and under it the time and Stop. */
  recording: boolean;
  /** While picking, a line over the screen: "Drag over the part to record. Esc gives up." */
  hint: string;
  /** How long it has recorded, "0:07". */
  time?: string;
  onStop?: () => void;
  /** The pointer came onto the time and Stop, or left them: the window takes the pointer only there while it records. */
  onBarHover?: (over: boolean) => void;
}

/**
 * Picking a part of the screen to record, and recording it: the screen dims, the part dragged out is clear inside a dashed violet
 * edge with its size in points beside it, and, once it records, a solid edge with the time and Stop on the capsule's glass under it.
 * The window that shows it draws the drag; this only paints it.
 */
export function ScreenArea({ rect, recording, hint, time, onStop, onBarHover }: ScreenAreaProps) {
  const box = rect ? ({ "--_x": `${rect.x}px`, "--_y": `${rect.y}px`, "--_w": `${rect.width}px`, "--_h": `${rect.height}px` } as CSSProperties) : undefined;
  return (
    <div className="av-screen-area" data-recording={recording ? "" : undefined} data-picked={rect ? "" : undefined}>
      {!rect && <span className="av-screen-area-dim" aria-hidden="true" />}
      {/* The line says what to do until the drag begins; then the part and its size say the rest. */}
      {!recording && !rect && <span className="av-screen-area-hint" role="status"><Hud>{hint}</Hud></span>}
      {rect && (
        <span className="av-screen-area-box" style={box}>
          {!recording && <span className="av-screen-area-size" aria-hidden="true">{`${Math.round(rect.width)} × ${Math.round(rect.height)}`}</span>}
          {recording && (
            <span className="av-screen-area-bar" onPointerEnter={() => onBarHover?.(true)} onPointerLeave={() => onBarHover?.(false)}>
              <Hud shape="pill">
                <span className="av-screen-area-dot" aria-hidden="true" />
                <span className="av-screen-area-time" role="timer">{time}</span>
                <Button size="small" variant="primary" icon="stop" onClick={onStop}>Stop</Button>
              </Hud>
            </span>
          )}
        </span>
      )}
    </div>
  );
}
