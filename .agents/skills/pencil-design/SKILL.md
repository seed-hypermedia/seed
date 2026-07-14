---
name: pencil-design
description: Design interfaces in Pencil .pen files or generate production code from Pencil designs. Use whenever a task reads, creates, or modifies .pen files or uses Pencil MCP tools.
---

# Pencil design

Use `frontend-design` for aesthetic direction when creating or substantially redesigning UI. For faithful design-to-code work, preserve the source design and existing product conventions.

## Before editing

1. Inspect the editor state and relevant design tree.
2. List reusable components with `pencil_batch_get` using `reusable: true`.
3. Read existing variables with `pencil_get_variables`.
4. Load the relevant Pencil guidelines.

Reuse matching components as `ref` instances and reuse existing assets before creating replacements. Prefer existing variables for colors, typography, radius, and spacing. Create new primitives or tokens only when the document has no suitable equivalent.

## Build and verify

Work section by section:

1. Build or update the section.
2. Capture a screenshot and inspect it visually.
3. Run `pencil_snapshot_layout` with `problemsOnly: true`.
4. Fix overflow, clipping, overlap, alignment, and spacing issues before continuing.

Take a final full-screen screenshot and layout snapshot when the screen is complete.

## Design to code

Read [references/design-to-code-workflow.md](references/design-to-code-workflow.md) for the full workflow. Load only the references needed for the task:

- [references/design-system-components.md](references/design-system-components.md) for reusable components.
- [references/variables-and-tokens.md](references/variables-and-tokens.md) for token mapping.
- [references/layout-and-text-overflow.md](references/layout-and-text-overflow.md) for layout repair.
- [references/responsive-breakpoints.md](references/responsive-breakpoints.md) for multiple responsive artboards.
- [references/tailwind-shadcn-mapping.md](references/tailwind-shadcn-mapping.md) for Tailwind or shadcn output.
- [references/asset-reuse.md](references/asset-reuse.md) for images, icons, and logos.
- [references/visual-verification.md](references/visual-verification.md) for final QA.

Generate semantic, maintainable code that matches the inspected design. Reuse the repository's components and tokens; do not mechanically introduce a different design system.
