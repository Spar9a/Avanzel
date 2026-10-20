---
name: avanzel-ui
description: Build or change anything a person sees in Avanzel (windows, the capsule, settings, setup, letters, copy, icons, Zel) the way its design system requires. Use it before editing apps/*/src/renderer or packages/ui.
paths:
  - "apps/*/src/renderer/**"
  - "packages/ui/**"
---

# Building Avanzel's interface

Avanzel's look is "paper cards on glass", and `@avanzel/ui` is the only place it is made. Windows arrange components; they never paint. The hooks check every edit you make, so read their messages: each one names the fix.

## 1. Know what exists

- Read `packages/ui/DESIGN.md`: the components table, the copy rules and the Zel rules.
- Look at the gallery. Run `npm run ui:gallery` and open `packages/ui/gallery/dist/index.html`. To see it, screenshot it with Playwright (Chrome channel, Reduce Motion on) and read the image.
- A pattern (`CapsuleBar`, `CapsuleNotice`, `Receipt`, `Letter`, `PermissionPrimer`) beats assembling primitives. A variant beats a new component.

## 2. Build the window

- `import { … } from "@avanzel/ui"`. Import `@avanzel/ui/base.css` once per window that has moved over.
- Lay out with `Stack`, `Row` and `Spacer`, or with layout-only CSS using `var(--av-space-N)` (2 4 6 8 10 12 16 20 24 32 40 48).
- Give components no `className` and no `style`. To place one, wrap it in your own element.
- Copy:
  - Sentence case, with verbs on buttons.
  - A problem gets one sentence on what happened, one on what is safe, and one fix.
  - No "!", no emoji, no apologies.
  - People are they/them.
  - Zel says "I" only in bubbles, setup, letters and `Text variant="voice"`.

## 3. When something is missing

Add it inside `packages/ui`, following `packages/ui/AGENTS.md`:

- tokens only;
- a gallery entry;
- a DESIGN.md row;
- `npm test`.

Its screenshot test will fail until the owner approves the new look. Don't update screenshots or tokens yourself; tell the owner what changed and why.

## 4. Check before you finish

```sh
npm run design:check -- --changed   # the design rules on your changes
npm test                            # rules, tokens, catalog, guard
npm run ui:e2e                      # screenshots and contrast, if packages/ui changed
```

When you report back:

- name the components you used;
- say which gallery sections changed, if any;
- list anything you would ask the owner to approve.
