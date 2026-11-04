// The draft of a field of the library's lines in Settings → Voice (the Dictionary, and the skip lists of dictating into any app),
// kept by the Settings window so a save on its way outlasts the pane. Pure: each step gives the next state, and the window's hook
// (useLibraryTextEdit, one for each field) holds it.

export interface TextDraft {
  /** The library the draft is of: another one's lines start afresh. */
  library: string | null;
  /** The field's text. */
  draft: string;
  /** The library's lines as the snapshot last gave them: a draft still equal to them was not edited, and follows the next. */
  base: string;
  /** The text of the save on its way, if any: leaving the field again with it sends no second one. */
  sending: string | null;
}

export function startDraft(library: string | null, text: string): TextDraft {
  return { library, draft: text, base: text, sending: null };
}

/**
 * The snapshot gives the library's lines as `text`. A draft not edited since the last snapshot moves to them, so a field drawn
 * from an older snapshot (a pane shown again while a save waited) never keeps, and never sends back, the older lines.
 */
export function followSnapshot(state: TextDraft, library: string | null, text: string): TextDraft {
  if (library !== state.library) return startDraft(library, text);
  if (text === state.base) return state;
  return { ...state, base: text, draft: state.draft === state.base ? text : state.draft };
}

export function typed(state: TextDraft, text: string): TextDraft {
  return { ...state, draft: text };
}

/** What leaving the field saves: null when the draft is what the library holds, or what a save on its way holds. */
export function toSend(state: TextDraft): string | null {
  return state.draft === state.base || state.draft === state.sending ? null : state.draft;
}

export function sent(state: TextDraft, text: string): TextDraft {
  return { ...state, sending: text };
}

/**
 * The save of `text` landed, and main kept `kept` (blank and repeated lines dropped, spaces tidied). The field shows `kept` only if
 * it still holds what was sent: lines typed since stay, and leaving the field saves them in turn.
 */
export function saved(state: TextDraft, text: string, kept: string): TextDraft {
  return { ...state, sending: state.sending === text ? null : state.sending, draft: state.draft === text ? kept : state.draft };
}

/** Main refused the save of `text`: the draft stays as typed, and leaving the field again tries again. */
export function failed(state: TextDraft, text: string): TextDraft {
  return { ...state, sending: state.sending === text ? null : state.sending };
}
