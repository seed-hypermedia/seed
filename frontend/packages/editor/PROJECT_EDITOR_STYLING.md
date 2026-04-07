# Project: Improve Styling in the Editor View

**Parent project:** No more Edit mode: New Publish mental model Pt.1

## 1. Problem

The parent project ("New Publish mental model") is changing how users interact with documents: the editor will always be
rendered — even for users who are just reading. When a user can edit, they see the editor loaded with the published
content and can start typing immediately. When they can't edit, the editor is rendered in read-only mode. There is no
more "enter edit mode" transition.

**This only works if the editor looks identical to the published view.** If users can tell that "something changed" when
they switch accounts or navigate to a document, the illusion breaks. Right now, the published view looks noticeably
better than the editor view, so rendering the editor everywhere would be a visible downgrade.

### Where the differences come from

The editor (`packages/editor`) and the published renderer (`packages/ui/blocks-content.tsx`) are two completely separate
rendering pipelines:

- **Editor:** BlockNote/Tiptap (ProseMirror) with React node views. Styling is spread across `Block.module.css`,
  `editor.css`, `style.css`, and individual block CSS files. Spacing uses fixed pixel values (`12px`, `15px`, `1.5em`).
- **Published:** Pure React component tree with no editor dependencies. Styling uses CSS custom properties
  (`--text-unit`, `--layout-unit`) that flow from a central provider, giving consistent, proportional spacing
  throughout.

### Specific visual discrepancies

- **Spacing system** — Editor uses fixed absolute values (`padding: 12px 0 3px 0`). Published uses CSS-variable-driven
  spacing (`calc(var(--layout-unit) / 3)`). Published spacing is more consistent and proportional.

- **Heading sizes** — Editor has hardcoded per-level sizes (`30px`, `24px`, `20px`, `18px`, `16px`). Published derives
  sizes from `SeedHeading` component with responsive scaling. Published headings adapt better across viewports.

- **Media blocks (image, video, file)** — Editor wraps in `MediaContainer` with no specific padding/margin strategy.
  Published uses negative margins to extend full-width with padding offset, `max-height: 600px`, `object-fit: contain`.
  Published media feels more polished and consistently spaced.

- **Code blocks** — Both use lowlight syntax highlighting and mermaid support. The visual differences are in container
  styling: published uses `font-mono text-sm`, `leading-relaxed`, negative-margin full-width treatment, and a rounded
  border container. Editor uses `bg-transparent px-3 py-3` with no border or negative-margin treatment.

- **Web embeds** — Editor uses a basic wrapper. Published applies full-width negative margins, theme-aware rendering
  (dark mode Twitter), and rounded borders. Published embeds are more visually integrated.

- **File blocks** — Editor has basic rendering. Published adds rounded border, hover-reveal download button, and proper
  icon sizing. Published file blocks have polish the editor lacks.

- **Block content padding** — Editor uses `padding: 12px 0 3px 0` (asymmetric, tight). Published uses
  `padding: calc(var(--layout-unit) / 6) calc(var(--layout-unit) / 3)` (symmetric, breathing room). Published content
  has better vertical rhythm.

- **Blockquotes** — Editor uses `border-left: 3px`, `padding-left: 15px`. Published uses the same border but with
  `all: unset` on the blockquote element for a cleaner reset. Minor but noticeable in edge cases.

- **Lists (nested)** — Editor uses marker progression (disc → circle → square) with `padding-inline-start: 1em`.
  Published uses `list-style-position: outside`, `display: list-item !important`, with different padding resets.
  Alignment and marker positioning differ.

- **Math blocks** — Editor has basic KaTeX rendering. Published adds responsive centering with ResizeObserver,
  horizontal scroll for overflow, and a rounded border container. Published math is better contained.

- **Grid layout** — Editor has grid-specific overrides in `Block.module.css`. Published uses Tailwind responsive grid
  classes (`grid-cols-1`, `sm:grid-cols-2`, `md:grid-cols-3`). Different max-heights and containment for media in grids.

## 2. Solution

Systematically align the editor's visual output with the published view, block type by block type. The rendered DOM
elements may differ (ProseMirror nodes vs plain React), but the **visual result must be identical**. As stated in the
parent project: "The goal is to make them look the exact same. The rendered DOM elements may be different, based on the
needs of the editor."

This project is a prerequisite for the parent project — the always-on editor model cannot ship until the editor matches
the published view visually. The parent project handles the behavioral changes (always rendering the editor, showing
publish button only on changes, draft handling, version navigation). This project handles the visual parity.

### Approach

#### A. Adopt the CSS variable spacing system in the editor

Port the published view's `--text-unit` and `--layout-unit` custom properties into the editor's root container. Refactor
`Block.module.css` to derive spacing from these variables instead of hardcoded pixel values. This is the single
highest-impact change — it brings all block spacing into alignment at once.

- Set `--text-unit: 18px` and `--layout-unit: 24px` on the editor root (`.bnEditor` or `.ProseMirror`).
- Replace fixed padding/margin values in `Block.module.css` with `calc()` expressions using these variables, matching
  the formulas in `blocks-content.css`.
- Example: `padding: 12px 0 3px 0` → `padding: calc(var(--layout-unit) / 6) calc(var(--layout-unit) / 3)`.

#### B. Align block-level styling, per block type

Work through each block type and match the editor's styling to the published view:

1. **Headings** — Match font sizes, weights, and responsive scaling to `SeedHeading` output. Ensure heading
   margin/spacing matches published (`margin-bottom: 20px`, consecutive heading collapse).

2. **Images** — Add `max-height: 600px`, `object-fit: contain`. Match the `flex w-full flex-col items-center gap-2 py-3`
   container layout. Align caption styling (`fontSize: textUnit * 0.85`, `text-muted-foreground`).

3. **Videos** — Apply `aspect-video` wrapper with absolute-positioned video/iframe inside. Match container padding to
   image blocks.

4. **Code blocks** — Apply `font-mono text-sm leading-relaxed whitespace-pre-wrap`. Add the negative-margin full-width
   treatment (`marginLeft/Right: (-1 * layoutUnit) / 2`, `padding: layoutUnit / 2`). Match the rounded border container.

5. **File blocks** — Add `border-muted rounded-md border p-4` container. Match icon sizing (`size-18`). Add hover-reveal
   download button styling.

6. **Web embeds** — Apply negative-margin full-width treatment. Add `border-border bg-background rounded-md border`.
   Match padding (`layoutUnit / 2`).

7. **Math blocks** — Add `rounded-md border py-3` container. Apply negative-margin treatment. Match responsive centering
   behavior.

8. **Blockquotes** — Ensure the border and padding match exactly. Apply the same CSS reset approach as published.

9. **Lists** — Match `list-style-position: outside`, marker progression, and nested list padding to published output.

#### C. Shared CSS where possible

Where the editor and published view can share CSS rules without coupling, extract shared styles into a common file
(e.g., in `packages/ui` or a new shared CSS module). This reduces future drift. Candidates:

- Font stacks (serif body, sans headings, monospace code)
- The `--text-unit` / `--layout-unit` variable definitions and derived spacing
- Blockquote, list, and inline code styling

#### D. Visual regression testing

Use side-by-side comparison of the same document rendered in both pipelines to verify alignment. Test with:

- A document containing all block types
- Deeply nested content (3+ levels)
- Grid layouts with mixed media
- Long-form text with headings at all levels
- Edge cases: empty blocks, very wide images, long code blocks, complex math

### What stays different

The DOM structure will remain different — ProseMirror requires specific wrapper elements (`blockNode`, `blockContent`,
`blockChildren`, `reactNodeViewRenderer`). The goal is visual parity, not DOM parity. Editor-specific UI elements (drag
handles, selection rings, toolbars, placeholders) are not part of the published view and will remain editor-only
affordances.

## 3. Scope

**Estimated time: ~2 weeks (1 person)**

This project can run in parallel with other parts of the parent project (always-render-editor wiring, draft detection,
publish button visibility). It has no dependency on the behavioral changes — it's purely CSS/styling work against the
existing editor.

| Phase                                    | Work                                                                        | Time     |
| ---------------------------------------- | --------------------------------------------------------------------------- | -------- |
| CSS variable system + base spacing       | Port `--text-unit`/`--layout-unit`, refactor `Block.module.css` base values | 2 days   |
| Headings, paragraphs, lists, blockquotes | Align text block styling                                                    | 2 days   |
| Media blocks (image, video, file)        | Match container layout, sizing constraints, captions                        | 2 days   |
| Code + Math blocks                       | Negative-margin treatment, font/sizing, containers                          | 1-2 days |
| Web embeds + Embed blocks                | Full-width treatment, borders, theme-awareness                              | 1 day    |
| Shared CSS extraction                    | Factor out common rules to reduce future drift                              | 1 day    |
| Visual QA + edge cases                   | Side-by-side testing across all block types, fix remaining gaps             | 1-2 days |

**Note:** The parent project estimates 1-2 weeks total for all its parts, and flags that the UI styling work will
require significant manual attention — AI tooling alone may not get the fine details right. Budget time for hands-on
visual tuning.

## 4. Rabbit Holes

- **Trying to unify the rendering pipelines into one.** The editor needs ProseMirror's DOM structure; the published view
  is plain React. Attempting to merge them is a far larger project and would break both. This project is about visual
  parity, not architectural unification.

- **Pixel-perfect matching at every viewport.** The published view uses Tailwind responsive breakpoints; the editor uses
  CSS media queries. Getting them to match at every pixel width is diminishing returns. Match at standard breakpoints
  (mobile, tablet, desktop) and accept minor differences in between.

- **Changing the published view to match the editor.** The published view is the target, not the editor. If something
  looks good in the editor but different from published, change the editor. Do not regress the published view.

- **Refactoring BlockNote/Tiptap internals.** Some ProseMirror-generated wrapper elements add extra spacing or sizing.
  Work around them with CSS rather than forking or patching BlockNote core. Modifying ProseMirror's DOM generation is
  fragile and creates upgrade risk.

- **Styling editor-only UI (toolbars, drag handles, slash menu, placeholders).** These are editor affordances and are
  not part of the published view. Restyling them is a different project.

- **Comments editing.** The parent project explicitly calls out that comments should stay as-is — users should not get
  inline editing for comments. Do not extend this styling work to the comment rendering pipeline.

- **Version navigation, rebasing, or draft detection UX.** These are behavioral concerns owned by the parent project,
  not this one. Do not get pulled into how the editor loads content or detects changes.

## 5. No-Gos

- **Do not modify the published view's styling to meet the editor halfway.** The published view is the visual standard.
  All changes flow editor → published direction.

- **Do not touch the permanent/wire-format data schemas** (`hm-types.ts` Zod schemas). This project is purely visual —
  no data model changes.

- **Do not introduce new dependencies** (e.g., adding Tamagui to the editor package). Work with CSS and the existing
  stack.

- **Do not change the editor's interactive behavior** (selection, drag-drop, typing, block manipulation). This project
  is cosmetic only.

- **Do not remove or hide editor affordances** (drag handles, block menus, formatting toolbar) to achieve parity. Those
  are required for editing and are expected to be visible only in editing mode.

- **Do not tackle rebasing or version-aware editing.** The parent project explicitly defers rebasing to a separate
  project. This styling project should have zero interaction with version/draft logic.
