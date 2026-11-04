// The clipboard a dictation at the cursor borrows: the words go on it for the paste, and what the person had there comes back after.
// Electron's clipboard has only promises (Electron 44 dropped readHTML, readImage and the rest), so it is read and written by MIME
// type. Kept apart from the controller so the controller's glue for dictating stays a few lines.
import { clipboard, ClipboardItem } from "electron";
import type { ClipboardSnapshot, CursorHost } from "./cursor-dictation.ts";

/** The formats a snapshot keeps, by the MIME type Electron reads and writes them as. */
const TEXT = "text/plain";
const HTML = "text/html";
const RTF = "text/rtf";
const PNG = "image/png";

/** The text of `type` on `item`, or null when it holds none (an empty string counts as none, so it isn't written back as text). */
async function textOf(item: Electron.ClipboardItem, type: string): Promise<string | null> {
  if (!item.types.includes(type)) return null;
  const blob = await item.getType(type);
  const text = blob instanceof Blob ? await blob.text() : null;
  return text ? text : null;
}

export const electronClipboard: CursorHost["clipboard"] = {
  async read(): Promise<ClipboardSnapshot> {
    const [item] = await clipboard.read();
    if (!item) return { text: null, html: null, rtf: null, image: null };
    let image: Buffer | null = null;
    if (item.types.includes(PNG)) {
      const blob = await item.getType(PNG);
      if (blob instanceof Blob && blob.size > 0) image = Buffer.from(await blob.arrayBuffer());
    }
    return { text: await textOf(item, TEXT), html: await textOf(item, HTML), rtf: await textOf(item, RTF), image };
  },
  async writeText(text: string): Promise<void> {
    await clipboard.writeText(text);
  },
  /** Puts back what `read` found, all formats in one write; a clipboard that held nothing is left empty. */
  async restore(snapshot: ClipboardSnapshot): Promise<void> {
    const formats: Record<string, string | Blob> = {};
    if (snapshot.text !== null) formats[TEXT] = snapshot.text;
    if (snapshot.html !== null) formats[HTML] = snapshot.html;
    if (snapshot.rtf !== null) formats[RTF] = snapshot.rtf;
    if (snapshot.image !== null) formats[PNG] = new Blob([new Uint8Array(snapshot.image)], { type: PNG });
    await clipboard.clear();
    if (Object.keys(formats).length > 0) await clipboard.write([new ClipboardItem(formats)]);
  },
};
