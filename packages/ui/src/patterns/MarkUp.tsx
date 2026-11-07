import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "../components/Button.tsx";
import { Hud } from "../components/Hud.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import type { ScreenAreaRect } from "./ScreenArea.tsx";
import "../foundations.css";
import "./markup.css";

export type MarkTool = "pen" | "box" | "ring" | "arrow";
export type MarkColor = "red" | "yellow" | "green" | "violet";

interface Mark {
  tool: MarkTool;
  color: MarkColor;
  /** In the picture's own pixels. */
  points: { x: number; y: number }[];
}

export interface MarkUpProps {
  /** Where the picture sits on the screen, in the window's points: over the very part it was taken of. */
  rect: ScreenAreaRect;
  /** The picture, as a URL the page can load (an object URL of a PNG), at the screen's own pixels. */
  picture: string;
  /** Add: the picture with the marks drawn on it, as a PNG. */
  onDone: (png: Blob) => void;
  /** × or Esc: nothing is kept. */
  onCancel: () => void;
}

const TOOLS: { tool: MarkTool; icon: IconName; label: string }[] = [
  { tool: "pen", icon: "pen", label: "Pen" },
  { tool: "box", icon: "box", label: "Rectangle" },
  { tool: "ring", icon: "ring", label: "Oval" },
  { tool: "arrow", icon: "arrow", label: "Arrow" },
];
const COLORS: { color: MarkColor; label: string }[] = [
  { color: "red", label: "Red" },
  { color: "yellow", label: "Yellow" },
  { color: "green", label: "Green" },
  { color: "violet", label: "Violet" },
];

/** A mark drawn on `paint`, `k` canvas pixels to a picture pixel, in `ink`. */
function drawMark(paint: CanvasRenderingContext2D, mark: Mark, ink: string, width: number): void {
  const pts = mark.points;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (!a || !b) return;
  paint.strokeStyle = ink;
  paint.lineWidth = width;
  paint.lineCap = "round";
  paint.lineJoin = "round";
  paint.beginPath();
  if (mark.tool === "pen") {
    paint.moveTo(a.x, a.y);
    for (const p of pts.slice(1)) paint.lineTo(p.x, p.y);
  } else if (mark.tool === "box") {
    paint.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (mark.tool === "ring") {
    paint.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
  } else {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const head = width * 4;
    paint.moveTo(a.x, a.y);
    paint.lineTo(b.x, b.y);
    paint.moveTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
    paint.lineTo(b.x, b.y);
    paint.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
  }
  paint.stroke();
}

/**
 * Marking a screenshot, over the very part of the screen it was taken of: the picture in its place, the rest of the screen dimmed, and
 * under it a bar on the capsule's glass with the pen and the shapes (a rectangle, an oval, an arrow), four inks, Undo, × and Add.
 * The marks are drawn into the picture Add hands over. Esc gives it up, ⌘Z takes back the last mark, Return adds it.
 */
export function MarkUp({ rect, picture, onDone, onCancel }: MarkUpProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<MarkTool>("pen");
  const [color, setColor] = useState<MarkColor>("red");
  const [marks, setMarks] = useState<Mark[]>([]);
  const drawing = useRef<Mark | null>(null);
  const [, redrawn] = useState(0);

  /** The ink of `color`, from the design's own colours, as the page paints them. */
  const inkOf = useCallback((c: MarkColor) => (root.current ? getComputedStyle(root.current).getPropertyValue(`--_mark-${c}`).trim() : "") || "red", []);

  const paint = useCallback(() => {
    const el = canvas.current;
    const img = image.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    if (img) ctx.drawImage(img, 0, 0, el.width, el.height);
    const width = Math.max(3, Math.round(el.width / Math.max(1, rect.width)) * 3);
    for (const mark of [...marks, ...(drawing.current ? [drawing.current] : [])]) drawMark(ctx, mark, inkOf(mark.color), width);
  }, [marks, rect.width, inkOf]);

  useEffect(() => {
    // Until the picture is in (or if it never comes), the marks go on a canvas of the part's own size, at the screen's pixels.
    const el = canvas.current;
    if (el && !image.current) {
      el.width = Math.round(rect.width * window.devicePixelRatio);
      el.height = Math.round(rect.height * window.devicePixelRatio);
    }
    const img = new Image();
    img.onload = () => {
      image.current = img;
      const el = canvas.current;
      if (el) {
        el.width = img.naturalWidth;
        el.height = img.naturalHeight;
      }
      redrawn((n) => n + 1);
    };
    img.src = picture;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the part's size only sizes the canvas before the picture is in
  }, [picture]);

  useEffect(paint);

  const done = useCallback(() => {
    drawing.current = null;
    paint();
    canvas.current?.toBlob((png) => png && onDone(png), "image/png");
  }, [paint, onDone]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        done();
      } else if (event.key === "z" && event.metaKey) {
        event.preventDefault();
        setMarks((list) => list.slice(0, -1));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onCancel, done]);

  /** The pointer, in the picture's own pixels. */
  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * event.currentTarget.width,
      y: ((event.clientY - box.top) / box.height) * event.currentTarget.height,
    };
  };

  const place = { "--_x": `${rect.x}px`, "--_y": `${rect.y}px`, "--_w": `${rect.width}px`, "--_h": `${rect.height}px` } as CSSProperties;
  return (
    <div ref={root} className="av-markup">
      {/* At the screen's foot the bar goes over the picture instead, where it can be seen. */}
      <div className="av-markup-box" style={place} data-bar-above={rect.y + rect.height + 64 > window.innerHeight ? "" : undefined}>
        <canvas
          ref={canvas}
          className="av-markup-canvas"
          data-tool={tool}
          aria-label="The screenshot, to mark"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drawing.current = { tool, color, points: [at(event)] };
            paint();
          }}
          onPointerMove={(event) => {
            const mark = drawing.current;
            if (!mark) return;
            const p = at(event);
            mark.points = mark.tool === "pen" ? [...mark.points, p] : [mark.points[0]!, p];
            paint();
          }}
          onPointerUp={() => {
            const mark = drawing.current;
            drawing.current = null;
            if (mark && mark.points.length > 1) setMarks((list) => [...list, mark]);
            else paint();
          }}
        />
        <div className="av-markup-bar">
          <Hud shape="pill">
            <span className="av-markup-group" role="radiogroup" aria-label="Tool">
              {TOOLS.map((each) => (
                <button
                  key={each.tool}
                  type="button"
                  role="radio"
                  aria-checked={tool === each.tool}
                  aria-label={each.label}
                  title={each.label}
                  className="av-markup-tool"
                  onClick={() => setTool(each.tool)}
                >
                  <Icon name={each.icon} size={16} />
                </button>
              ))}
            </span>
            <span className="av-markup-rule" aria-hidden="true" />
            <span className="av-markup-group" role="radiogroup" aria-label="Colour">
              {COLORS.map((each) => (
                <button
                  key={each.color}
                  type="button"
                  role="radio"
                  aria-checked={color === each.color}
                  aria-label={each.label}
                  title={each.label}
                  className="av-markup-ink"
                  data-color={each.color}
                  onClick={() => setColor(each.color)}
                >
                  <i />
                </button>
              ))}
            </span>
            <span className="av-markup-rule" aria-hidden="true" />
            <Button size="small" variant="quiet" icon="undo" label="Undo the last mark" disabled={marks.length === 0} onClick={() => setMarks((list) => list.slice(0, -1))} />
            <Button size="small" variant="quiet" icon="close" label="Give up the screenshot" onClick={onCancel} />
            <Button size="small" variant="primary" icon="check" onClick={done}>Add</Button>
          </Hud>
        </div>
      </div>
    </div>
  );
}
