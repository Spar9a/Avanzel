import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { disintegrate } from "./dust.ts";
import "../foundations.css";
import "./dust.css";

/** How far the grains may drift past what turns to dust, each side, in CSS pixels. */
const DUST_PAD = 32;

export interface DustProps {
  children: ReactNode;
  /**
   * It is being taken away: what it holds turns to dust from the left, as a page of the Library does (`PageRow`'s `removing`), then
   * its room closes up, and `onRemoved` is called, for the list to let it go. With Reduce Motion it only fades.
   */
  removing: boolean;
  onRemoved?: () => void;
  /** It goes as done rather than deleted: it fades, then its room closes up, with no dust. */
  gently?: boolean;
}

/** Something in a list that can be taken away with the Library's dust, such as a card: a box around it that adds nothing else. */
export function Dust({ children, removing, onRemoved, gently = false }: DustProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"here" | "dust" | "gone">("here");
  const removed = useRef(onRemoved);
  removed.current = onRemoved;
  useLayoutEffect(() => {
    if (!removing) return;
    const el = box.current;
    const dust = canvas.current;
    if (el) el.style.setProperty("--_height", `${el.getBoundingClientRect().height}px`);
    if (!el || !dust || gently || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("gone");
      return;
    }
    const look = getComputedStyle(el);
    const ink = look.color;
    const colors = [ink, ink, look.getPropertyValue("--av-surface-raised").trim() || ink, look.getPropertyValue("--av-accent-fill").trim() || ink, look.getPropertyValue("--av-ink-secondary").trim() || ink];
    setPhase("dust");
    return disintegrate(el, dust, colors, DUST_PAD, () => setPhase("gone"));
  }, [removing]);
  return (
    <div
      ref={box}
      className="av-dust"
      data-dust={phase === "dust" ? "" : undefined}
      data-gone={phase === "gone" ? "" : undefined}
      data-gently={gently ? "" : undefined}
      inert={removing}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && (event.animationName === "av-dust-close" || event.animationName === "av-dust-fade")) removed.current?.();
      }}
    >
      <div className="av-dust-body">{children}</div>
      {removing && !gently && <canvas ref={canvas} className="av-dust-grains" aria-hidden="true" />}
    </div>
  );
}
