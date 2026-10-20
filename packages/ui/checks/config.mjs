// What design-check treats as a window, what as the design system, and the few deliberate
// exceptions. Agents may not edit this file (checks/guard.mjs asks the owner first), because
// widening an exception here is how a rule would quietly stop applying.

/** Window code: it may only arrange components. Globs are relative to the repo root. */
export const WINDOWS = ["apps/*/src/renderer/**/*.{css,tsx,ts,html}"];

/** The design system: it may paint, with tokens only. */
export const SYSTEM = ["packages/ui/src/**/*.{css,tsx,ts}", "packages/ui/gallery/*.{css,tsx}"];

/** Never checked: generated output and the token sources themselves. */
export const IGNORED = ["packages/ui/src/generated/**", "packages/ui/gallery/dist/**", "**/node_modules/**"];

/** Rules switched off for one file, each with the reason it is safe. */
export const EXEMPT = {
  "motion-tokens": {
    "packages/ui/src/components/zel.css": "Zel's loops and glances are drawing, timed by hand.",
  },
  "raw-colour": {
    "packages/ui/src/menu-bar.ts": "Template images for the menu bar must be drawn in black.",
  },
};

/** Where Zel may speak in the first person besides <Bubble>, <Letter> and <Text variant="voice">. */
export const VOICE_FILES = ["apps/*/src/renderer/setup/**", "apps/*/src/renderer/letter/**"];

/** Capitalised words that are names, so they don't make a label Title Case. */
export const PROPER_NOUNS = [
  "Avanzel", "Zel", "Claude", "Code", "Codex", "Cursor", "Gemini", "OpenCode", "Obsidian", "Notion", "Zoom", "Slack", "Teams", "Meet",
  "Mac", "macOS", "Finder", "Terminal", "Settings", "System", "Dock", "Spotlight", "Raycast", "Alfred", "Parakeet", "Markdown", "Git",
  "GitHub", "Ideas", "Goals", "Problems", "Memories", "People", "Topics", "Inbox", "Quick", "Ask", "Recall", "Screen", "Auto", "Type",
  "Space", "Return", "Option", "Command", "Shift", "Control", "Esc", "Escape", "Tab", "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday", "Sunday", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December", "English", "Ukrainian", "Russian", "I",
];

/** Words that are written in capitals anyway. */
export const ALLOWED_CAPS = ["OK", "AI", "CLI", "API", "MCP", "URL", "PDF", "KB", "MB", "GB", "TB", "VAD", "FSRS", "HIG", "CSS", "HTML", "JSON", "TOML", "USB", "ID", "UI", "UX", "PIN", "GPU", "CPU", "RAM", "LLM", "RSS", "SSH", "VPN", "AM", "PM", "UTC", "CC", "BY", "MIT", "OFL", "FAQ", "N/A"];
