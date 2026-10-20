// Zel's face for the menu bar, as SVG source for the main process to turn into a template image.
// Template images are one colour, so the "needs you" dot is a filled circle, not red.

export type MenuBarState = "idle" | "listening" | "filing" | "filed" | "needs-you" | "asleep";

const OPEN_EYES: Record<"idle" | "listening" | "filing" | "needs-you", string> = {
  idle: '<circle cx="7.05" cy="6.6" r="1.05"/><circle cx="10.95" cy="6.6" r="1.05"/>',
  listening: '<circle cx="7.05" cy="6.1" r="1.05"/><circle cx="10.95" cy="6.1" r="1.05"/>',
  filing: '<circle cx="6.3" cy="6.7" r="1.05"/><circle cx="10.2" cy="6.7" r="1.05"/>',
  "needs-you": '<circle cx="7.05" cy="6.6" r="1.05"/><circle cx="10.95" cy="6.6" r="1.05"/>',
};

const line = (d: string) => `<g fill="none" stroke="black" stroke-width="1.1" stroke-linecap="round">${d}</g>`;

/** An 18 × 18 SVG of Zel's menu bar face in `state`, drawn in black on transparent. */
export function menuBarFaceSvg(state: MenuBarState): string {
  const eyes =
    state === "filed" ? line('<path d="M6 7 q1.05 -1.4 2.1 0"/><path d="M9.9 7 q1.05 -1.4 2.1 0"/>')
    : state === "asleep" ? line('<path d="M6 6.6 q1.05 1.1 2.1 0"/><path d="M9.9 6.6 q1.05 1.1 2.1 0"/>')
    : `<g fill="black">${OPEN_EYES[state]}</g>`;
  const mouth =
    state === "filed" ? '<path d="M7.2 8.8 q1.8 1.9 3.6 0" fill="none" stroke="black" stroke-width="1.2" stroke-linecap="round"/>'
    : state === "asleep" ? '<circle cx="9" cy="9.6" r=".7" fill="black"/>'
    : '<path d="M7.5 9.1 q1.5 1.25 3 0" fill="none" stroke="black" stroke-width="1.1" stroke-linecap="round"/>';
  const extra =
    state === "listening" ? line('<path d="M1.2 4.6 q-1.3 2.3 0 4.6"/><path d="M16.8 4.6 q1.3 2.3 0 4.6"/>')
    : state === "needs-you" ? '<circle cx="15.6" cy="2.6" r="2.3" fill="black"/>'
    : state === "asleep" ? '<path d="M13.6 1.4h2.6l-2.6 3h2.6" fill="none" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
    : state === "filing" ? '<g fill="black"><circle cx="14.4" cy="16" r=".8"/><circle cx="16.4" cy="16" r=".8" opacity=".5"/></g>'
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="7" r="5.6" fill="none" stroke="black" stroke-width="1.5"/>${eyes}${mouth}<rect x="7.9" y="12.4" width="2.2" height="2.4" rx=".6" fill="black"/><rect x="3.8" y="14.4" width="10.4" height="2.6" rx="1.2" fill="black"/>${extra}</svg>`;
}
