// The kinds of file the library tells apart by their extension (lower case, with the dot). A module of its own, since
// vault.ts imports git.ts, and git.ts needs the audio types to keep audio out of its commits.

export const TEXT_EXTS: ReadonlySet<string> = new Set([".md", ".txt"]);
export const AUDIO_EXTS: ReadonlySet<string> = new Set([
  ".wav", ".m4a", ".mp3", ".ogg", ".oga", ".opus", ".flac", ".aiff", ".aif", ".aac", ".webm", ".mp4", ".caf",
]);
export const IMAGE_EXTS: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".tiff", ".tif", ".bmp", ".avif",
]);
