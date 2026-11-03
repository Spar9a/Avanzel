# Avanzel's design system

Avanzel looks like **paper cards on glass**:

- Native macOS windows.
- The user's own words on index cards.
- Zel, a rubber-stamp librarian, who stamps each thought when it is filed.
- Violet ink.

`@avanzel/ui` is the only place this look is made. It holds the tokens, the components and the gallery, which shows every component in light and dark. To see the gallery, run `npm run ui:gallery` and open `packages/ui/gallery/dist/index.html`.

The design rationale is in `reports/Avanzel UX and first-run design.md`. This file is the contract for building to it.

## The one rule: windows arrange, @avanzel/ui paints

**Window code** lives in `apps/*/src/renderer/**`. It builds a screen from components and places them. Its CSS may only arrange:

- `display`, flex and grid;
- `gap`, `padding` and `margin`, with spacing tokens;
- sizes, `position`, `overflow`, `z-index`, with layer tokens.

**Everything you can see** lives in `packages/ui` and comes from tokens: colour, type, borders, radii, shadows, motion, icons and Zel.

If nothing fits, add a component or a variant in `packages/ui` (see "When something is missing"). Never paint in the window.

## Building a screen

1. Find the component in the table below. A pattern, such as `CapsuleBar`, `Receipt` or `Letter`, beats assembling primitives.
2. Import it from `"@avanzel/ui"` and nowhere deeper.
3. Lay it out with `Stack` and `Row`, or with a few lines of layout CSS using `var(--av-space-N)`.
4. Write the copy by the rules in "Copy".
5. Run `npm run design:check`. Agents' hooks also run it on every edit and before they finish.
6. Compare the result with the gallery, in light and in dark.

## Components

| Component | Use it for | Not for |
|---|---|---|
| `Text` | Every piece of text, by role: `title`, `heading`, `headline`, `body`, `callout`, `footnote`, `caption`, `voice` (Zel's lines), `words` and `words-small` (the user's words), `code`. `align="center"` centres and balances lines; `focusable` lets code move focus to a heading when a step changes | Picking a size: choose a role |
| `Stack`, `Row`, `Spacer` | Columns and lines with gaps from the scale | Anything visual |
| `Button` | Actions. Variants: `primary` (one per moment), `secondary`, `quiet` (dismiss), `link` (inside text), `danger` (deletes), `page` (opens a page of the library, as the sources under an answer do). Sizes: `small`, `regular`, `large`. `wrap` lets a long label take more lines. An icon-only button needs `label` | Navigation to a web page: use `Link` |
| `Badge` | A word or two about the row it sits in: `accent` ("Best results") or `neutral`. It takes no action | A button, or a status that needs a colour alone |
| `Actions` | A row of buttons, with the primary last | More than one primary |
| `Switch` | An on/off setting that applies at once | Choices with more than two states |
| `Segmented` | Two to five short exclusive choices | Long lists |
| `TextField`, `TextArea` | Typing. `label` is required, and `labelHidden` hides it on screen only. `size="large" variant="bare"` is a field that fills the window, as in Quick | Read-only values: use `Text` |
| `Kbd` | Shortcuts, written as macOS writes them (`⌥Space`). `size="key"` draws a keycap for teaching | Ordinary words |
| `Link` | A web address or a file | Actions in the app: use `Button variant="link"` |
| `Icon` | The icon set on the 16 px grid | A shelf: use the shelf parts |
| `Spinner`, `Progress` | Work in progress. Past 10 seconds, give it a size and a way out | Decoration |
| `Notice` | A message inside a window: `info`, `error` or `success` | The capsule: use `CapsuleNotice` |
| `Group`, `GroupRow` | Settings, grouped as in System Settings. On/off rows are `Switch` | Lists of content |
| `Stage` | The tinted area where Zel and cards perform, one per window | Panels and cards |
| `Card` | The index card: the user's words on ruled paper, with `label`, `meta`, `stamp` and `footer` | Settings or chrome: cards hold words |
| `Stamp` | The receipt that ends a piece of work: `filed`, `noted`, `saved`, `letter`, `remembered`, `hello` | Decoration or emphasis |
| `ShelfTag` | A shelf as a chip or a tab, always with its colour, glyph and name. A tab's `count` is read as "1 page" or "3 pages"; `total` makes it the shelf's total, shown at 0 too | Colour alone |
| `ShelfGlyph`, `ShelfMark` | A shelf's glyph or mini tab next to its visible name | Without the name |
| `Zel` | The librarian: six moods (`idle`, `listening`, `thinking`, `filed`, `needs-you`, `asleep`) at four sizes | Anywhere outside Avanzel's own windows |
| `Bubble` | Zel speaking, when asked or when something needs the person, such as a permission request | Tooltips and help text |
| `Hud` | The capsule's dark glass, the only glass there is | Windows or content |
| `Wave` | Voice levels | Progress |
| `CapsuleBar` | The capsule's bar: `listening`, `thinking`, `filed`, `needs-you` | Messages longer than a line |
| `CapsuleNotice` | A problem in the capsule: worried Zel, what happened, what's safe, one fix | Success: use `CapsuleBar mood="filed"` |
| `Receipt` | What a filing changed: each page and its shelf | Other lists |
| `Letter` | The evening letter, signed and stamped | Other documents |
| `PermissionPrimer` | The screen before a macOS permission prompt: one button, Continue | Anything else; its wording is fixed |

Components take no `className` and no `style`. To place one, wrap it in an element of your own. To make it look different, choose a variant. If no variant does it, add one in `packages/ui`.

## Tokens

The tokens live in `packages/ui/tokens/`, in the W3C design-token JSON draft format. `npm run ui:tokens` turns them into CSS custom properties (`--av-*`) and TypeScript types. A token is named for its role, never for its colour.

| Group | Roles | Notes |
|---|---|---|
| `ink` | `--av-ink`, `-secondary`, `-accent`, `-on-accent`, `-danger`, `-ok` | Inside a `Card` or `Hud` these become that surface's inks automatically |
| `surface` | `window`, `stage`, `paper`, `control`, `fill`, `raised`, `knob`, `group` | |
| `paper` | `ink`, `ink-secondary`, `rule-red`, `rule-blue` | Rule red is the card's header line, never an error colour |
| `accent`, `danger` | `fill`, `wash`, `focus`; `danger-fill` | Stamp violet `#5B3FD1` is the brand |
| `shelf` | `goals`, `ideas`, `problems`, `memories`, `people`, `topics` | Never shown without the glyph and name |
| `zel`, `hud` | Zel's colours; the capsule's glass and inks | Used only by `Zel` and `Hud` |
| `space` | 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48 | There is no 14: round to a step |
| `radius`, `size`, `layer` | Named for their job: `card`, `control`, `pill`…; `overlay`, `popover`… | |
| `font`, `text` | `ui` (SF Pro), `voice` (Nunito), `words` (Newsreader, with Literata for Cyrillic), `code`; one `text` role per job | Set as `font: var(--av-text-…)` |
| `duration`, `ease` | `quick` 120 ms, `base` 200, `card` 380, `stamp` 600, `drawer` 700; `out`, `land`, `stamp`, `leave` | |

The tokens handle light and dark, Increase Contrast and Reduce Transparency, so windows never handle them. The tests hold every text role to WCAG AA in all four modes.

## Copy

- **Sentence case, with a verb first on buttons.** An action keeps its name through the flow: "File it", then "Filed".
- **A problem gets three things:** one sentence on what happened, one on what is safe, and one button that fixes it. For example: "Claude Code has hit its usage limit." / "Your note is safe in the inbox." / **File it with Codex now**.
- **Calm and plain.** No apologies, no "Oops", no exclamation marks, no capitals for emphasis, no emoji.
- **Zel says "I" only in its own moments:** setup, its bubbles, `Text variant="voice"` and letters. Everywhere else the copy is plain. ("Keep Zel on my desktop" is the person speaking, which is fine.)
- **People are they/them,** unless you know their name.
- **One-character ellipsis** (…), and units the way macOS writes them: "6 s", "412 of 670 MB".
- **Never promise more than the app does.** Voice becomes text on the Mac; a screenshot goes to the user's agent.
- **Empty states invite.** "Nothing filed yet. Press ⌥Space and say hello."

## Zel

- Zel appears only in Avanzel's own windows: setup, the capsule, the menu bar and letters.
- It comes when the person presses ⌥Space or when a thought is filed. It never starts a conversation.
- Its eyes look at the card or the words, never at the person.
- It never covers the user's words, never blocks a click, and never sulks about missed days.
- It moves in a loop only while listening or thinking, because there the motion is the status. Every other mood settles within five seconds.
- Quiet mode (`<html data-zel="quiet">`) leaves a plain stamp with no face.
- Draw Zel only through `<Zel>`. The menu bar face comes from `menuBarFaceSvg()` in `@avanzel/ui/menu-bar`.

## Motion

There is one orchestrated moment per surface: Zel stamping, the filing show, the setup window flying into the menu bar. Everything else is a quick reply to something the person did.

Things that land use `ease-land`; things that leave use `ease-leave`. Reduce Motion ends every move at once, and the final frame is always the resting state.

Avanzel makes no sounds of its own.

## Accessibility

- Every control has a name, even when its label is hidden on screen.
- Focus is a 2 px violet ring, and only components draw it.
- Colour is never alone: shelves carry a glyph and a name, and states carry words.
- The capsule announces only the start and the end of a filing.

## When something is missing

1. Check the gallery and this table again: a variant of an existing component is better than a new one.
2. Add the component or variant in `packages/ui/src/components/` (or `patterns/`), following `packages/ui/AGENTS.md`. Use tokens only.
3. Add it to the gallery, to `src/index.ts` and to the table above. The tests fail until all three are done.
4. Run `npm run ui:e2e`. A new or changed screenshot fails until the owner approves it, so describe what changed and why.

## What design-check enforces

The hooks run these on every edit. `npm run design:check` runs them on demand, the git hook runs them on commit, and `npm test` runs them in CI. Each failure message says how to fix it.

| Rule | Where | What it protects |
|---|---|---|
| `windows-arrange` | windows | Window CSS uses layout properties only |
| `space-scale` | windows | Margins, paddings and gaps use `--av-space-*` |
| `layer-scale` | both | `z-index` uses `--av-layer-*` |
| `known-token` | both | Every `var(--av-…)` exists |
| `ui-internals` | windows | No selecting `.av-*` classes, their data attributes or `--_*` variables |
| `no-important` | both | No `!important` (except the Reduce Motion rule) |
| `use-components` | windows | No raw `<button>`, `<input>`, `<svg>`, `<a>`, `<h1>`… |
| `no-style-prop` | windows | No inline `style` |
| `no-overrides` | windows | No `className` or `style` on @avanzel/ui components |
| `ui-entry` | windows | Imports come from `@avanzel/ui`, `/base.css` or `/menu-bar` only |
| `tokens-only` | system | Colours, fonts, radii and tracking come from tokens |
| `raw-colour` | both | No hex or rgb() in markup attributes |
| `motion-tokens` | system | Durations and easing come from tokens (loops excepted) |
| `glass-in-hud` | system | `backdrop-filter` appears only in `hud.css` |
| `capitals-in-stamp` | system | Uppercase only in `stamp.css` |
| `style-vars-only` | system | `style` passes only `--_*` custom properties |
| `sentence-case` | both | Labels and titles aren't Title Case |
| `no-exclamation` | both | No "!" |
| `no-filler` | both | No "Oops", "Sorry", "successfully", "Submit"… |
| `real-ellipsis` | both | "…" rather than "..." |
| `no-shouting` | both | No words in capitals, except abbreviations |
| `they-them` | both | No gendered pronouns for people |
| `zel-says-i` | both | First person only in Zel's moments |
| `no-emoji` | both | No emoji |

Window files written before these rules are listed in `checks/baseline.json`. They pass while they don't get worse, and edits are held to "add nothing new". After you move a window onto the components, run `npm run design:check -- --update-baseline`; that command can only lower the counts.

## What only the owner changes

Agents can propose these changes but can't make them on their own. The hooks ask the owner first, or refuse with the reason:

- **Tokens** (`packages/ui/tokens/`): the brand.
- **Screenshot baselines** (`npm run ui:approve`): the approved look.
- **The rules, their exceptions and the baseline** (`packages/ui/checks/`).
- **The hook settings** (`.claude/`, `.codex/`, `.gemini/`, `.opencode/`, `.githooks/`).
