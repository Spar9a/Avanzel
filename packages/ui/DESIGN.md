# Avanzel's design system

Avanzel looks like **paper cards on glass**:

- Native macOS windows.
- The user's own words on index cards.
- Zel, a rubber-stamp librarian, who stamps each thought when it is filed.
- Violet ink.

Glass while the words are in the air, paper once they are kept: a recording stays on the capsule's one panel of glass, and a thought becomes a card when it is filed.

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
| `Button` | Actions. Variants: `primary` (one per moment), `secondary`, `quiet` (dismiss), `link` (inside text), `danger` (deletes), `page` (opens a page of the library, as the sources under an answer do). Sizes: `small`, `regular`, `large`, and `xlarge` (44 px, 16 px words) for a recording's controls. `wrap` lets a long label take more lines; `truncate` keeps it on one line and ends it in "…" where its room ends, as a filed page's title before its badge. `shortcut` shows its key after the label (`⌥⇧R`) when the action has one. A `danger` icon-only button (a page's bin) is a red sign on nothing, and shakes as it is pressed or while it is `expanded` (its question shows). An icon-only button needs `label`, which shows as its name in a small pill over it as the pointer rests on it (or the keyboard comes to it), and may wear a `badge`, a small second icon at its corner for what it does as well (the recording's Stop: ✦ `spark` files now, ☾ `moon` waits for the review), which its label says too, or a `count`, a violet number on its top corner for how many it holds (the recording's Add: the files that go with it), which its label says too | Navigation to a web page: use `Link` |
| `Badge` | A word or two about the row it sits in: `accent` ("Best results") or `neutral`. It takes no action | A button, or a status that needs a colour alone |
| `Actions` | A row of buttons, with the primary last | More than one primary |
| `Tabs` | Moving between a window's places, as the menu bar panel's Capture, Library and Settings. `level="primary"`: a violet line under the chosen tab slides to the next, with an optional `count`. `level="secondary"`: a quieter row under it, for the parts of one place (shelves, settings panes), its chosen tab bold on a pill that slides to the next. Neither row shifts as the choice changes. An option's `shelf` (an `AnyShelf`: one of the six, or a shelf the owner made) puts its glyph in its colour before the label | Choices that change a setting: use `Segmented` |
| `TabPanel` | What the chosen tab shows, under `Tabs`: the `pages` side by side, sliding along to the chosen one, the old going out one side as the new comes in. A page is made when it first shows and kept after. `height="fill"` scrolls each page inside the room it is given | Anything not under tabs |
| `PageRow` | A page of the library in a list: title, then shelf, status (a word after a dot, not a pill, so it never looks pressable), tags and date, with small `actions` in the top corner (the ways to open it). A click folds it open in place to show its `summary` and `children`, with `lead` over the summary (the ways to add to it). `onDropFiles` takes files dropped on it, turning violet while one is over it. `removing` turns it to dust from the left and closes it up, then calls `onRemoved` (a fade with Reduce Motion) | The user's own words: use `Card` |
| `ActionTile` | A large button that starts something new, with an icon, a line on what happens and its shortcut, as on the panel's Capture tab. `tone="primary"` for the one the place is about. With `choices` it asks how first: they fold open under it while `open` | Settings or ordinary actions: use `Button` |
| `Aura` | The quiet moving background behind a place where a person speaks to Avanzel: drifting violet light and a line of voice bars. `mood="listening"` while a recording is on. Decoration only | Status, progress or anything that has to be read: use `Wave` or `Progress` |
| `Select` | A pop-up button: it says what is chosen and opens Avanzel's own menu of the choices, kept inside the window (above the button when there is no room below). `section` heads a run of choices; `buttonLabel` and `icon` make it a toolbar button such as Filter. An option's `shelf` sets it in the shelf's colour with its glyph, and the button wears it while chosen. `onClear` with `clearable` puts an × inside the pill, in place of the chevron, that undoes the choice. `trigger` makes it a round icon button that opens a menu of actions (the recording's Add, in the panel), each choice with its `icon`, and its `count` a number on its corner as `Button`'s | Two to five choices always in sight: use `Segmented` |
| `ListField` | A list of short items, such as apps or sites to skip: a field and Add for one at a time, and each item with its own Remove. `collapsed` makes it a pop-up button that says the one item, how many ("10 apps") or "Empty", and opens on the field and the items | Free text: use `TextArea` |
| `FileChip` | A file a page or a recording holds: its sign (video, picture, file) and name, which open it, and, under the pointer, its own × (`onRemove`) | Links in text: use `Button variant="link"` |
| `FileLink` | A file named in a page's text (or listed), as a link in those words with its sign before them, that opens it; under the pointer it becomes a ringed chip and a red bin floats right after it (`onRemove`), moving nothing | A file on its own: use `FileChip` |
| `Confirm` | A question before something that can't be taken back here, in one line on a pill laid over the button that asked it, growing out of it to the left: the question, Cancel and the red verb, whose sign lands right over the button's. Esc or a click elsewhere is Cancel | Problems: use `Notice` |
| `FilePreview` | A file's preview under its name, as a page's Files list them: the picture, a video's frame with ▶, or Quick Look's picture of another file, in a thin frame at most 160 px tall, which opens the file. A quiet box holds its place while it is made; with none, nothing shows | The file's name alone: use `FileLink` |
| `Dust` | Something in a list that can be taken away as a page of the Library is (a thought in the queue): while `removing` it turns to dust from the left, its room closes up, and `onRemoved` lets the list drop it; `gently`, for something done rather than deleted, it fades and closes up with no dust |
| `Expiring` | A panel card that goes by itself in a moment (a thought that came to no note): a violet line runs round its edge, emptying over its `seconds` | Something to take back: use `UndoBar` | A page of the Library: `PageRow` has it already |
| `More` | The rarer choices of a row behind a More button (a page's Add more): a press shows them in its place, each coming in a moment after the one before, and the focus goes to the first | A menu of choices: use `Select` or `CapsuleMenu` |
| `UndoBar` | Something just done that can still be taken back, for a few seconds: what was done, Undo, and an × in a ring that empties as the time runs out (the time or the × lets it stand) | A problem: use `Notice` |
| `Disclosure` | A part of a page that folds away, as its Log: a quiet heading with a chevron and a count that opens it in place. Folded by default | Places of a window: use `Tabs` |
| `Items` | A short list of points to read, such as a page's next steps: a violet dash before each, a check and quieter ink for one that is `done`, a spinner for one that is `busy` (on its way, such as a screenshot being taken), and its `when` (a log entry's day) first, in violet. `onRemove` gives each point its own ×, but one that is busy | Lists to edit: use `ListField` |
| `RecordingStage` | A place that becomes the recording while one listens, as the panel's Capture: what it shows fades away, and Zel, a wide wave, a large time and the recording's `controls` take its place until it ends. `onDropFiles` takes files dropped on the recording, turning violet while one is over it | The capsule's own bar: use `CapsuleBar` |
| `Switch` | An on/off setting that applies at once | Choices with more than two states |
| `Segmented` | Two to five short exclusive choices. A choice may carry an `icon` before its label (✦ Now, ☾ 21:00) | Long lists |
| `PopUp` | One choice from a flat list: the current value with chevrons, beside a label that says what is chosen. The list is a native menu | A list of actions, or a label that is the value |
| `Toolbar` | A settings window's panes: an icon and a label for each | Anything but moving between panes |
| `ShortcutField` | A shortcut as a key cap that a press changes, telling a screen reader what happens. While it records it asks for the keys and says Esc stops, in the same width, so nothing moves | Showing a key: use `Kbd` |
| `TextField`, `TextArea` | Typing. `label` is required, and `labelHidden` hides it on screen only. `size="large" variant="bare"` is a field that fills the window, as in Quick | Read-only values: use `Text` |
| `Kbd` | Shortcuts, written as macOS writes them (`⌥Space`). `size="key"` draws a keycap for teaching | Ordinary words |
| `Link` | A web address or a file | Actions in the app: use `Button variant="link"` |
| `Icon` | The icon set on the 16 px grid | A shelf: use the shelf parts |
| `Spinner`, `Progress` | Work in progress. Past 10 seconds, give it a size and a way out | Decoration |
| `Notice` | A message inside a window: `info`, `error` or `success` | The capsule: use `CapsuleNotice` |
| `Group`, `GroupRow` | Settings, grouped as in System Settings. On/off rows are `Switch` | Lists of content |
| `GroupReveal` | Rows of a `Group` there only while the `Switch` above them is on: they open out and fade in, and fold away when it is off | Showing content on a press: `Disclosure`, `More` |
| `Stage` | The tinted area where Zel and cards perform, one per window | Panels and cards |
| `Card` | The index card: the user's words on ruled paper, with `label`, `meta`, `stamp` and `footer`. In the capsule a card holds its whole moment: `status` (a live chip in the head: "Filing with Claude Code"), `progress` (a violet line under the head), `actions` at the foot's right, and `onClose` (Hide, in the corner); `headAction`, a button right after the status (a queued thought's bin). `look="panel"` gives the capsule's cards the menu bar panel's look: the window's surface with a hairline edge, the words in the interface face with room around them, no ruling | Settings or chrome: cards hold words |
| `Stamp` | The receipt that ends a piece of work: `filed`, `noted`, `saved`, `letter`, `remembered`, `hello` | Decoration or emphasis |
| `ShelfDrawer` | The six shelf tabs in one line, with the pages each holds (`total`) or has just taken in (the filing), then the owner's own shelves (`own`: each `{ own, name, count }`, its folder, name and pages), in the own-shelf look | A single shelf: use `ShelfTag` |
| `ChoiceRow` | A row of a `Group` where exactly one row is chosen, as with agents: a check on the chosen row and a Use button on the others, with a badge and the row's other buttons | Settings with more than one choice at once: use `Switch` |
| `ShelfTag` | A shelf as a chip or a tab, always with its colour, glyph and name. A tab's `count` is read as "1 note" or "3 notes"; `total` makes it the shelf's total, shown at 0 too. `shelf` is an `AnyShelf`: one of the six, or a shelf the owner made, `{ own: "projects", name: "Projects" }`, which wears the one own-shelf colour and folder glyph and is told apart by its name (never empty). `PageRow`'s, `Select`'s, `Tabs`' and `Receipt`'s `shelf` take one too, and `shelfName(shelf)` gives any shelf's name as words | Colour alone |
| `ShelfGlyph`, `ShelfMark` | A shelf's glyph or mini tab next to its visible name. Every shelf the owner makes shares one glyph, a plain folder | Without the name |
| `Zel` | The librarian: six moods (`idle`, `listening`, `thinking`, `filed`, `needs-you`, `asleep`) at four sizes | Anywhere outside Avanzel's own windows |
| `Bubble` | Zel speaking, when asked or when something needs the person, such as a permission request | Tooltips and help text |
| `Hud` | The capsule's dark glass, the only glass there is. Words go on it only while they are heard (`CapsuleBar`'s `words`): once they are kept, they go on paper | Windows or other content |
| `Wave` | Voice levels. `tone`: violet, or the glass's own ink. `fill` takes the row's free room with as many bars as fit | Progress |
| `CapsuleBar` | The capsule's panel: a row for `listening`, `thinking`, `filed`, `needs-you`, with the words as they are heard above it, and the app they go to in Zel's place. `paused`: its voice and time stand still, dimmed, and it keeps its size. `steady`: while listening the line is a label (a call), at the left, and the voice fills the rest. `onDropFiles` takes files dropped on the bar, turning violet while one is over it | Messages longer than a line in the row. Words that are kept: use `Card`. Words as they are heard in the row's line: it is a live region |
| `CapsuleAppear` | The capsule coming and going as a whole: drawn, it rises from the bottom and fades in; `leaving`, it sinks and fades out before its window hides | What changes inside the capsule while it is up |
| `CapsuleMenu` | A menu over the capsule's bar, on its glass (the recording's +): a heading with its ×, its choices one under another, and what they did so far under them. A choice that is `busy` (what it started is getting ready) spins in its icon's place and can't be chosen again. It rises in as it opens and sinks away as it closes | A choice in a window: use `Select` |
| `ScreenArea` | Picking a part of the screen to record, then recording it: the screen dims, the part dragged out shows its size inside a dashed violet edge, and while it records a solid edge with the time and Stop under it. It fills its window; the window draws the drag | A screenshot: macOS's own crosshair |
| `SpokenField` | A short field that can be said rather than typed (the voice trigger's word): the field and a microphone beside it; listening, the field gives way to a red dot and the wave of the voice, and the microphone to a Stop with a pulsing ring | A whole thought said: Record a thought |
| `MarkUp` | Marking a screenshot over the part of the screen it was taken of: the picture in place, the rest dimmed, and under it a bar with the pen, the shapes (rectangle, oval, arrow), four inks, Undo, × and Add, which hands over the picture with the marks drawn in. Esc gives up, ⌘Z undoes, Return adds | Editing a picture in a window: open it in Preview |
| `CapsuleNotice` | A problem in the capsule: worried Zel, what happened, what's safe, one fix | Success: use `CapsuleBar mood="filed"` |
| `Receipt` | What a filing changed: each page and its shelf, built-in or the owner's own (an `AnyShelf`, shown with its mark and name) | Other lists |
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
| `shelf-own` | `--av-shelf-own`, the system brown | The one colour every shelf the owner makes shares. Never shown without the glyph and name |
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
