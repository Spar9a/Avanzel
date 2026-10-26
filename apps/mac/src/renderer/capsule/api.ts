// The capsule page's end of the preload bridge, which every file of the page reaches main through, and the type of each state main
// sends it (`StateOf<"filing">`).
import type { AvanzelBridge, CapsuleState } from "../../shared/ipc.ts";

declare global {
  interface Window {
    avanzel: AvanzelBridge;
  }
}

export const api = window.avanzel.capsule;

/** The state of one `kind`, as the component that draws it is given it. */
export type StateOf<Kind extends CapsuleState["kind"]> = Extract<CapsuleState, { kind: Kind }>;
