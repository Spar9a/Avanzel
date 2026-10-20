// Avanzel's design rules as code. Each rule says what it protects and how to fix a violation, because
// the reader of a failure is usually an agent that will do exactly what the message says.
// DESIGN.md explains the same rules for people; test/rules.test.ts keeps a passing and a failing
// example for every one.

export const DOC = "packages/ui/DESIGN.md";

export const RULES = {
  "windows-arrange": {
    scope: "windows",
    summary: "Window stylesheets only arrange. Colour, type, borders, shadows, radii and motion belong to @avanzel/ui.",
    fix: "Use a component or one of its props instead: <Text tone=\"secondary\">, <Button variant=\"primary\">, <Card>, <Hud>. If no component fits, add a variant in packages/ui (see packages/ui/AGENTS.md) rather than painting here.",
  },
  "space-scale": {
    scope: "windows",
    summary: "Margins, paddings and gaps come from the spacing scale.",
    fix: "Use var(--av-space-N) with N one of 2 4 6 8 10 12 16 20 24 32 40 48, or 0 or auto. Round to the nearest step; there is no 14.",
  },
  "layer-scale": {
    scope: "both",
    summary: "z-index comes from the layer tokens.",
    fix: "Use var(--av-layer-base|raised|sticky|overlay|popover).",
  },
  "known-token": {
    scope: "both",
    summary: "Every var(--av-…) names a real token.",
    fix: "Use a token from packages/ui/src/generated/tokens.css. To add one, change packages/ui/tokens/ (the owner approves token changes).",
  },
  "ui-internals": {
    scope: "windows",
    summary: "Windows don't restyle @avanzel/ui from outside.",
    fix: "Don't select .av-* classes, their data-* attributes or --_ variables from a window. Ask for a variant: add it in packages/ui with a gallery entry.",
  },
  "no-important": {
    scope: "both",
    summary: "No !important, except the Reduce Motion rule in foundations.css.",
    fix: "Remove !important. If a style doesn't apply, it is in the wrong place: windows arrange, components paint.",
  },
  "use-components": {
    scope: "windows",
    summary: "Windows build from @avanzel/ui, not from raw controls.",
    fix: "Import the component from \"@avanzel/ui\" instead (the message names it).",
  },
  "no-style-prop": {
    scope: "windows",
    summary: "Windows set no inline styles.",
    fix: "Remove style={…}. Layout goes in the window's stylesheet with spacing tokens, and anything visual is a component prop.",
  },
  "no-overrides": {
    scope: "windows",
    summary: "@avanzel/ui components take no className or style.",
    fix: "Remove the prop. Wrap the component in an element with your own class if you need to place it; choose a variant if you need it to look different.",
  },
  "ui-entry": {
    scope: "windows",
    summary: "Windows import @avanzel/ui from its entry points only.",
    fix: "Import from \"@avanzel/ui\" (components), \"@avanzel/ui/base.css\" or \"@avanzel/ui/menu-bar\".",
  },
  "tokens-only": {
    scope: "system",
    summary: "Inside @avanzel/ui, every colour, font, radius, tracking and layer is a token.",
    fix: "Replace the raw value with the token for its role, such as var(--av-ink-secondary), font: var(--av-text-footnote) or var(--av-radius-control). For a new role, add a token in packages/ui/tokens/.",
  },
  "raw-colour": {
    scope: "both",
    summary: "No raw colours in markup.",
    fix: "Use currentColor and let the component's CSS set the colour from a token.",
  },
  "motion-tokens": {
    scope: "system",
    summary: "Transitions and one-off animations use the duration and easing tokens.",
    fix: "Use var(--av-duration-quick|base|card|stamp|drawer) and var(--av-ease-out|land|stamp|leave). Only loops (infinite) keep their own timing.",
  },
  "glass-in-hud": {
    scope: "system",
    summary: "Glass (backdrop-filter) is only for the capsule: no Liquid Glass in the content layer.",
    fix: "Use a solid surface token. Only components/hud.css draws glass.",
  },
  "capitals-in-stamp": {
    scope: "system",
    summary: "Only the stamp prints in capitals.",
    fix: "Remove text-transform: uppercase; write the words in sentence case.",
  },
  "style-vars-only": {
    scope: "system",
    summary: "Inside @avanzel/ui, style={…} passes only custom properties.",
    fix: "Pass the value as a --_private custom property and use it in the component's CSS.",
  },
  "sentence-case": {
    scope: "both",
    summary: "Labels and titles are in sentence case.",
    fix: "Capitalise only the first word and names: \"Open the library\", not \"Open The Library\".",
  },
  "no-exclamation": {
    scope: "both",
    summary: "No exclamation marks: Avanzel is calm.",
    fix: "End with a full stop, or with nothing on a button.",
  },
  "no-filler": {
    scope: "both",
    summary: "No apologies, jokes or filler words in the interface.",
    fix: "Say what happened and what to do: \"Claude Code has hit its usage limit.\" Replace \"Submit\" with the action itself.",
  },
  "real-ellipsis": {
    scope: "both",
    summary: "An ellipsis is one character.",
    fix: "Write … (U+2026), not three dots.",
  },
  "no-shouting": {
    scope: "both",
    summary: "No words in capitals; the stamp is the only capitals.",
    fix: "Write the word in sentence case. Abbreviations such as AI, CLI and URL are fine.",
  },
  "they-them": {
    scope: "both",
    summary: "Interface copy refers to people as they/them.",
    fix: "Use they, them, their or the person's name.",
  },
  "zel-says-i": {
    scope: "both",
    summary: "Zel says \"I\" only in setup, in its bubbles, in <Text variant=\"voice\"> and in letters. Elsewhere copy is plain.",
    fix: "Rephrase without I/me/my (\"Filed in Ideas.\"), or move the line into a <Bubble> if it is Zel speaking.",
  },
  "no-emoji": {
    scope: "both",
    summary: "No emoji: Zel is the character.",
    fix: "Remove the emoji; use an <Icon> if a picture helps.",
  },
};

/** CSS properties a window may set: layout, never paint. */
export const ARRANGE = new Set([
  "display", "position", "inset", "inset-block", "inset-inline", "top", "right", "bottom", "left",
  "flex", "flex-grow", "flex-shrink", "flex-basis", "flex-direction", "flex-wrap", "flex-flow", "order",
  "grid", "grid-template", "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-area", "grid-column", "grid-row",
  "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end", "grid-auto-flow", "grid-auto-columns", "grid-auto-rows",
  "gap", "row-gap", "column-gap", "align-items", "align-content", "align-self", "justify-items", "justify-content", "justify-self",
  "place-items", "place-content", "place-self",
  "width", "height", "min-width", "min-height", "max-width", "max-height", "inline-size", "block-size", "aspect-ratio", "box-sizing",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "margin-block", "margin-inline", "margin-block-start", "margin-block-end", "margin-inline-start", "margin-inline-end",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "padding-block", "padding-inline", "padding-block-start", "padding-block-end", "padding-inline-start", "padding-inline-end",
  "overflow", "overflow-x", "overflow-y", "overscroll-behavior", "scroll-behavior", "scrollbar-gutter",
  "z-index", "isolation", "contain", "container", "container-type", "container-name", "visibility",
  "pointer-events", "user-select", "-webkit-user-select", "-webkit-app-region", "cursor",
  "white-space", "text-overflow", "overflow-wrap", "word-break", "text-align", "object-fit", "object-position",
]);

export const SPACING_PROPS = /^(margin|padding)(-.+)?$|^(gap|row-gap|column-gap)$/;

/** Raw controls a window must not build, and the component that replaces each. */
export const COMPONENT_FOR = {
  button: "<Button>",
  input: "<TextField> or <Switch>",
  textarea: "<TextArea>",
  select: "<Segmented>",
  svg: "<Icon>, <ShelfGlyph> or <Zel>",
  dialog: "a pattern from @avanzel/ui (ask for one in packages/ui)",
  progress: "<Progress>",
  meter: "<Progress>",
  kbd: "<Kbd>",
  a: "<Link> or <Button variant=\"link\">",
  h1: "<Text variant=\"title\">",
  h2: "<Text variant=\"heading\">",
  h3: "<Text variant=\"headline\">",
  h4: "<Text variant=\"headline\">",
  h5: "<Text variant=\"headline\">",
  h6: "<Text variant=\"headline\">",
};

/** Props whose string values people read. */
export const COPY_PROPS = new Set(["label", "title", "placeholder", "aria-label", "alt", "description", "note", "meta", "children"]);

/** Props on @avanzel/ui components that are short labels, held to sentence case. */
export const LABEL_PROPS = new Set(["label", "title", "placeholder", "aria-label"]);

export const FILLER = [/\boops\b/i, /\bwhoops\b/i, /\buh[- ]oh\b/i, /\bsorry\b/i, /\bsuccessfully\b/i, /\bsubmit\b/i, /\bclick here\b/i, /something went wrong/i, /an error (has )?occurred/i, /\binvalid\b/i, /\bawesome\b/i, /\byay\b/i];
export const PRONOUNS = /\b(he|she|him|his|hers|himself|herself)\b|\bher\b/i;
/** Zel's "I". "my" and "me" stay allowed: in a label such as "Keep Zel on my desktop" the person is speaking. */
export const FIRST_PERSON = /(^|[^\p{L}'’])I(['’](m|ll|ve|d))?(?=$|[^\p{L}'’])/u;
export const EMOJI = /\p{Emoji_Presentation}/u;
