import { useState, type DragEvent } from "react";

/**
 * Files dropped on a place: `over` while a drag that carries files is over it (counted in and out as it crosses the place's own parts,
 * so it holds until the drag leaves the place), and the handlers to spread on the place. Without `onDrop` the place takes no drop.
 */
export function useFileDrop(onDrop: ((files: File[]) => void) | undefined) {
  const [depth, setDepth] = useState(0);
  const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  if (!onDrop) return { over: false, handlers: {} };
  return {
    over: depth > 0,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDepth((n) => n + 1);
      },
      onDragOver: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (event: DragEvent) => {
        if (carriesFiles(event)) setDepth((n) => Math.max(0, n - 1));
      },
      onDrop: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDepth(0);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onDrop(files);
      },
    },
  };
}
