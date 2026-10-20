# Avanzel for agents

Avanzel is a voice-first second brain for macOS. It is an Electron app in `apps/mac`, with the filing engine in `packages/engine` and the design system in `packages/ui`.

## Interface work: windows arrange, @avanzel/ui paints

These rules apply to anything a person sees: windows, the capsule, menus, copy and icons.

- Build windows (`apps/*/src/renderer/**`) only from `@avanzel/ui` components. Never use a raw `<button>`, `<input>`, `<svg>`, `<a>` or `<h1>`.
- Window CSS may only arrange: layout, sizes, and spacing with `var(--av-space-N)`. Colour, type, borders, radii, shadows and motion belong to `packages/ui`, made from tokens.
- Components take no `className` or `style`. Choose a variant. If none fits, add one in `packages/ui` with a gallery entry (see `packages/ui/AGENTS.md`).
- Copy is in sentence case, calm and plain: no "!", no "Oops", no emoji. A problem says what happened, what is safe, and offers one fix. People are they/them. Zel says "I" only in its own moments.
- Read `packages/ui/DESIGN.md` before interface work. It lists every component and when to use it.
- Check with `npm run design:check`. Your hooks also check every edit and won't let you finish with problems left.
- Only the owner changes tokens (`packages/ui/tokens/`), screenshot baselines (`npm run ui:approve`), the design rules (`packages/ui/checks/`) and the hook settings. Propose such changes; don't make them.

## Commands

- `npm test`: every workspace's tests, the design checks among them.
- `npm run design:check`: the design rules on every window and component (`-- --changed` for your changes only).
- `npm run ui:gallery`: build the gallery at `packages/ui/gallery/dist/index.html`, which shows every component in light and dark.
- `npm run ui:e2e`: the gallery's screenshot and contrast tests.
