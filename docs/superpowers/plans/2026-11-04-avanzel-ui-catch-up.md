# The `packages/ui` catch-up (2c)

The owner answered every decision in the flight pack's doc 3 on 3 Nov and approved the work in `packages/ui` on 4 Nov. This plan builds what those calls asked for. Each group is one branch-sized unit: parts in `packages/ui` with gallery entries and DESIGN.md rows, then the windows that use them, then tests. Per `packages/ui/AGENTS.md`, the agent never runs `npm run ui:approve` or changes tokens: the owner approves each group's screenshots.

The calls are in `reports/Avanzel flight pack/3 Decisions waiting for you.md` (ids below), and the earlier texts are in `archive/3-decisions-*.md`.

## Done before this plan (4 Nov)

- Sounds removed from the app (H1, H2, H15, H16, H19 are void).
- B8's fixes: TextField and TextArea ignore Enter while composing (IME), `.av-field` is `position: relative`, the placeholder ink is the ink softened (dark mode on a Group measured 4.26:1), the stale `base.css` comment. The baseline is already `{}`. The gallery's "controls" screenshot changed (placeholder only) and waits for approval.

## Group 1: the accessibility parts and small variants

| Id | Build |
|---|---|
| A5 | A focusable heading (setup moves focus to it on a step change). A `Button` that wraps a long label (Ask's suggestions and source titles overflow today). |
| B5 | A small "page" Button variant for Ask's page buttons. |
| A2, C2 | ShelfTag reads "1 page" / "3 pages", and gets a totals variant. Settings → General shows the shelf counts again. |
| A4 | The choice list, the source chip, the "Best results" badge and the filing drawer become real components with gallery entries; the windows drop their stand-ins. |
| I3 | `Card`'s `meta` is "a short line", with a one-line ellipsis rule for the head. |
| J12 | `text-wrap: balance` on centred lines. |

## Group 2: Settings and its controls

| Id | Build |
|---|---|
| B1 | A toolbar component for Settings' panes (icon and label), switching on click, Space or Return only. |
| B2 | `ShortcutField`, which announces "Recording. Type the new shortcut." and "Saved ⌃⇧Space". |
| B3 | The microphone as a dropdown, as in Settings, defaulting to the system's default input. |
| B6 | Ask's and setup's question in the `words` face. |
| B7 | Native vibrancy for Quick, with one DESIGN.md line, after a look in light and dark. |
| C1 | A small Zel face in Quick, with one DESIGN.md line. |
| F5 | PermissionPrimer's wording per voice backend; `scroll-padding-bottom` in the design rules' ARRANGE list (owner file: proposed, not made). |
| G13 | A words-face variant of `TextArea`; Card's note gets its exception. |

## Group 3: the capsule

| Id | Build |
|---|---|
| A1 | The narration list: one working line (accent ink, Spinner), finished rows in past tense, consecutive identical rows merged with a count. |
| G1 | A hint slot in `CapsuleBar`. |
| G2 | A `Segmented` "Now \| {review}" in the bar and in Settings, worded from the review, never "Tonight". |
| G3 | A `Receipt` row that opens a page and truncates. |
| G5 | The ticking time hidden from VoiceOver in the live region. |
| G11 | A Card fade for long words. |
| G14 | An `idle` bar mood, a `look` prop and a close slot. |
| G16 | A framed thumbnail for screenshots, at both sizes. |
| I2 | `still` on `CapsuleBar` and a calm mood for answers. |
| G9, G10, G12, G15, G19, G20 | Keyboard access, pairs of fixes, record-now-transcribe-later, "File it again" on Stopped, the no-fix cards, the copy fixes. |

## Group 4: Ask

J1, J2, J5, J7, J8, J9, J10, J11 (after the by-hand VoiceOver check), and J6's retirement of a saved turn's Undo.

## Not in this plan

The §13 parts of Phase 2 (Zel as one component and Quiet mode, the icon, the evening letter, Recall, Zel on the desk), K1, the dictionary for recognition, the release blockers, and the owner-file changes (design rules, guard, git hooks), which are proposed to the owner.

## Order and checks

Group 1, then 2, 3, 4. After each group: `npm run typecheck`, `npm test`, `npm run design:check`, `npm run ui:e2e`, and the Mac e2e specs the group touches (`npm run e2e -- <specs>`). The owner approves the screenshots (`npm run ui:approve`) before the next group starts, so each baseline step is small.
