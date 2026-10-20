# Working inside @avanzel/ui

This package is the only place in Avanzel that paints, so its own rules are stricter than a window's.

- **Tokens only.** Every colour, font, radius, tracking, layer, duration and easing is a `var(--av-…)` token. Geometry such as widths, heights, paddings and line heights may be raw pixels. Private values passed in from TSX are `--_name` custom properties.
- **One component per file** in `src/components/` (primitives) or `src/patterns/` (whole moments, such as the capsule bar). Each has its own CSS file, imported by its TSX, beginning with `import "../foundations.css"`.
- **Closed APIs.** Props are unions of named options, never free strings, colours or sizes. There is no `className` or `style` prop. Labels are `string`. An icon-only button requires `label`.
- **Accessible by construction.** Every control gets a name, keyboard support and a visible focus ring. Anything that animates must end on its resting frame under Reduce Motion.
- **Surfaces remap inks.** `Card`, `Letter` and `Hud` redefine `--av-ink*` for their insides, so children never need to know where they are.

## Adding a component or a variant

1. Look for an existing component to extend first. A variant is better than a new component.
2. Write the TSX and CSS. Export the component from `src/index.ts`.
3. Add a section or a specimen to `gallery/main.tsx`, showing every variant and state with real Avanzel copy.
4. Add its row to the components table in `DESIGN.md`.
5. Run `npm test` (rules, tokens, catalog, guard), `npm run design:check` and `npm run ui:e2e`.
6. The screenshot test fails for every new or changed look. That is expected: don't update the screenshots. Tell the owner which gallery sections changed and why, and they approve with `npm run ui:approve`.

## Changing tokens

The tokens are in `tokens/*.tokens.json`: `base` holds the shared values, `light` and `dark` the roles, and the `contrast-*` files the Increase Contrast overrides. Only the owner changes them, so propose the change. After a change, `npm run ui:tokens` regenerates `src/generated/`, which is never edited by hand. `test/tokens.test.ts` holds every text role to WCAG AA in all four modes.
