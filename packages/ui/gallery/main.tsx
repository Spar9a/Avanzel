// Mounts the gallery in a browser (gallery/dist/index.html).
import { createRoot } from "react-dom/client";
import { Gallery } from "./Gallery.tsx";

/** The thread's theme decides the gallery's own appearance when T3 shows it inline. */
export function followHostTheme() {
  const root = document.documentElement;
  const background = getComputedStyle(root).getPropertyValue("--background").trim();
  if (!background) return;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return;
  probe.fillStyle = background;
  probe.fillRect(0, 0, 1, 1);
  const [r = 255, g = 255, b = 255] = probe.getImageData(0, 0, 1, 1).data;
  root.dataset.appearance = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
}

followHostTheme();
createRoot(document.getElementById("root")!).render(<Gallery />);
