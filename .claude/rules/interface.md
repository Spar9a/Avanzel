---
paths:
  - "apps/*/src/renderer/**"
  - "packages/ui/**"
---
Interface files: follow `packages/ui/DESIGN.md`, and use the `avanzel-ui` skill for the workflow. Windows only arrange `@avanzel/ui` components. All paint comes from tokens inside `packages/ui`. Every edit here goes through the design guard, so read its message and fix what it names.
