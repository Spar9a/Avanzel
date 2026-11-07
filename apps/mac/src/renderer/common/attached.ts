// A file added to a recording, as the recording's Add list shows it, in the panel and over the capsule's bar.
import type { CapsuleMenuItem, Item } from "@avanzel/ui";
import type { AddingKind, AttachedItem } from "../../shared/ipc.ts";

/** "report.pdf · 10:42": its name, and when it was added, by this Mac's clock. */
export function attachedItem(item: AttachedItem): Item {
  const at = new Date(item.at);
  return { text: `${item.name} · ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` };
}

/** The Add list: what goes with the recording so far, then a screenshot on its way (a spinner) while one is taken. */
export function attachedItems(attached: readonly AttachedItem[], adding: AddingKind | null | undefined): Item[] {
  const items = attached.map(attachedItem);
  return adding === "screenshot" ? [...items, { text: "Screenshot", busy: true }] : items;
}

/** The ways of the recording's Add, one under another; Record a video spins while its picker gets ready. */
export function addChoices(adding: AddingKind | null | undefined, pick: {
  file(): void;
  screenshot(): void;
  area(): void;
  marks(): void;
  video(): void;
}): CapsuleMenuItem[] {
  return [
    { label: "Attach a file…", icon: "attach", onSelect: pick.file },
    { label: "Screenshot of the screen", icon: "display", onSelect: pick.screenshot, busy: adding === "screenshot" },
    { label: "Screenshot of an area", icon: "screen", onSelect: pick.area, busy: adding === "screenshot" },
    { label: "Screenshot with marks", icon: "pen", onSelect: pick.marks, busy: adding === "marks" },
    { label: "Record a video of an area", icon: "play", onSelect: pick.video, busy: adding === "video" },
  ];
}

/** The Add button's name, with how many go with the recording: "Add a file, a screenshot or a video, 2 added". */
export function addLabel(count: number): string {
  return count > 0 ? `Add a file, a screenshot or a video, ${count} added` : "Add a file, a screenshot or a video";
}
