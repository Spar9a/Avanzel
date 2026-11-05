import type { ReactNode } from "react";
import "../foundations.css";
import "./hud.css";

export interface HudProps {
  /** capsule: the capsule's panel, a pill while it is one row. card: a capsule card, such as a receipt or a problem. */
  shape?: "capsule" | "card";
  /** status for news, alert for a problem that needs the user. Leave it out inside another live region. */
  role?: "status" | "alert";
  children: ReactNode;
}

/** The capsule's dark glass. It is the only glass in Avanzel: content sits on paper or the window,
    never on glass (Apple's HIG, "Materials"). Text, buttons and fields inside it take its inks. */
export function Hud({ shape = "card", role, children }: HudProps) {
  return <div className="av-hud" data-shape={shape} role={role}>{children}</div>;
}
