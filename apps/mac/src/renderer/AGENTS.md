# Windows

Every window here is built from `@avanzel/ui`. This folder arranges components; it never paints. The full contract, including which component is for what, is in `packages/ui/DESIGN.md`.

- Import components from `"@avanzel/ui"`, and `"@avanzel/ui/base.css"` once in a window that has moved over.
- Use no raw `<button>`, `<input>`, `<svg>`, `<a>` or `<h1>`, and no `style={…}` or `className` on components.
- Stylesheets here may set layout only, with `var(--av-space-N)` for spacing.
- Write copy in sentence case, with no "!", no emoji and no apologies.
- Files written before these rules are listed in `packages/ui/checks/baseline.json`. They may not get worse. When you move one onto the components, run `npm run design:check -- --update-baseline`.
