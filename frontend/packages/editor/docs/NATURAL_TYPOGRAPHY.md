# Natural typography for Seed documents

**A shareable write-up for colleagues and the community.**

## TL;DR

We replaced Seed's imperative, per-block-type spacing rules with a single `.hm-prose` class that scales typography the
way the browser was designed to — relative units on real semantic structure instead of hard-coded pixel values scattered
across wrappers. Inline styling rides the semantic tag (`<strong>`, `<em>`, `<code>`, `<a>`); section rhythm lives on
the block wrapper and is keyed off stable `data-node-type` / `data-content-type` attributes. The result: documents that
breathe naturally, fewer stylesheets to keep in sync, and the same rhythm in the desktop app, on the web (including
SSR), inside embeds, and in comments.

## The problem

Until now, Seed's block spacing was hand-coded: every heading level, every media type, and every "what comes before
what" combination had its own CSS rule. These rules were written to a pixel grid and spread across three stylesheets
(`editor.css`, `Block.module.css`, `blocks-content.css`) plus a manual mirror for the web SSR view in
`apps/web/app/styles.css`.

It worked, but it felt forced:

- An H1 always added 48px above itself, regardless of the size of the text around it.
- Headings used one rule, images used another, code blocks a third, and the rules fought each other via sibling
  combinator specificity (`:has(> [data-content-type='heading'])` beats the default, which beats the first-child
  reset…).
- Changing one spacing decision meant finding and updating it in four places.
- The SSR stylesheet was a manual reimplementation of the editor stylesheet — every refactor risked drift.

![Before — imperative spacing](./images/before.png) _Before: section markers, media, and code each declared their own
wrapper-level margin. Nothing scaled with text._

## The principle

Great typography on the web has a settled answer for this, popularized by [Tailwind Typography] and long used by
publications like Medium, Substack, and the NYT:

1. **Semantic HTML is the source of truth.** `<strong>`, `<em>`, `<h1>`, `<blockquote>`, `<pre>` — not
   `<span class="font-bold">` or `<div class="mt-12">`. Inline marks, colors, fonts, and heading scale all live on the
   semantic tag.
2. **Section rhythm lives on the block wrapper, keyed by a stable data attribute.** `data-node-type="blockNode"` and
   `data-content-type="heading"` survive CSS-modules hashing and edit-vs-SSR DOM differences — they're the one safe hook
   we have for saying "give an H1 a section-marker gap above it."
3. **Units are relative.** `em` on tag-level rules (heading scale, inline code padding), `rem` on wrapper-level section
   gaps (so the gap above an H1 doesn't depend on the H1's own font-size). No manual mobile override needed.
4. **Scope the typography to a single class on the container.** Layer your overrides descendant-style so they pass
   through any number of structural wrappers untouched. `.hm-prose` for documents, `.hm-prose.is-comment` for comments —
   one class flip swaps the whole voice.

[Tailwind Typography]: https://tailwindcss-typography.vercel.app/

![After — natural rhythm](./images/after.png) _After: one `.hm-prose` class. Headings, paragraphs, lists, code, quotes —
each owns its own rhythm in em units._

## What we changed

- **One class, four renderers.** `.hm-prose` (defined in `packages/ui/src/hm-prose.css`) is applied to the draft editor,
  the read-only viewer, the embed wrapper, the comment body, and the web SSR placeholder. Same rhythm everywhere.
- **`@tailwindcss/typography` as the foundation.** The plugin gives us tested, em-based defaults wrapped in `:where(…)`
  selectors at zero specificity. `.hm-prose` layers our font stack, link treatment, code pill, blockquote border,
  heading scale, and comment variant on top — whenever we diverge, we win cleanly.
- **Selectors target `data-node-type` / `data-content-type` attributes, not CSS-module class names.** The editor
  package's `Block.module.css` hashes classes like `.blockNode` to `_blockNode_abc123` at build time, so any global rule
  that tries to target `.blockNode` silently misses. The data attributes — emitted verbatim by `BlockNode.renderHTML`
  and mirrored by the SSR renderer — are the one safe hook.
- **Deleted the imperative `:has()` + `--space-*` spacing rules.** The block of rules in `editor.css` /
  `Block.module.css` / `blocks-content.css` that hard-coded 48px above every H1, 32px above every media block, and so
  on, is gone. The 8px-grid `--space-xs..--space-xl` tokens are removed across all three stylesheets. Prose em/rem
  defaults replaced every use.
- **Moved section-marker rhythm to the wrapper.** Heading top-margins live on the `.blockNode` wrapper via
  `:has(> [data-content-type='heading'][data-level='1'])`, not on the `<h1>` element. This makes the first-child reset
  (`:first-child { margin-top: 0 }`) a single-selector win regardless of whether the heading is wrapped in editor DOM or
  emitted directly in SSR. Nested first-children get a small 0.25em separator so they're clearly distinct from their
  parent's content.
- **Inline code is a real pill.** `.hm-prose code` now has a visible tinted background, monospace stack, 0.875em size,
  and an accent color — slate-red in light mode, soft pink in dark mode. Both meet WCAG AA on the corresponding muted
  background.
- **Blockquotes sit flush with the parent paragraph column.** The left border no longer indents to 1.5em — only the 15px
  padding between the border and the quoted text remains. Reads more like a side-annotation than a nested card.
- **Removed every `font-family: … !important` override in the editor.** `editor.module.css` had `.defaultStyles h1..h6`
  forcing `Inter !important; font-weight: 400; font-size: 18px` (that's why your H1s looked like body text) and
  `.draft-editor .defaultStyles` forcing Georgia serif — plus a leftover `background-color: red` debug. All gone.
  Font-family and heading scale are now owned by `.hm-prose`; the module only holds structural resets.
- **Purged the Mantine font-family leak.** BlockNote's Mantine theme was emitting
  `.mantine-xxxx .ProseMirror { font-family: Inter, … }` via Emotion's CSS-in-JS. Vite HMR caches Emotion stylesheets
  across editor remounts, so right after a markdown import the draft editor rendered in sans-serif until a full reload
  rebuilt the cache. Removing the `fontFamily` declaration from the Mantine `Editor.root` style means Emotion emits no
  font-family rule at all, and `.hm-prose`'s serif stack always wins.
- **One baseline, four size modifiers.** `.hm-prose` sets 1.125rem (18px) as the document body size; `.is-comment` drops
  to 1rem (16px). For surface-specific overrides, apply `.hm-prose-sm` (0.875rem), `.hm-prose-base` (1rem),
  `.hm-prose-lg` (1.125rem), or `.hm-prose-xl` (1.25rem) — em-based rhythm scales automatically.
- **Made the editor wrappers structurally transparent.** `.blockNode`, `.blockContent`, and `.blockChildren` still exist
  (ProseMirror decorations need them), but they no longer carry margins of their own. Nothing between the container and
  the semantic tag fights the prose rhythm.
- **Purged the vestigial renderer.** The `.blocknode-content` / `[data-block-type=...]` selectors in
  `blocks-content.css` targeted a renderer that no live component emits anymore. Deleted. The file shrank from ~400
  lines of content-styling to ~30 lines of embed chrome.
- **Shrunk the web SSR mirror.** The manual reimplementation of the editor's Block CSS in `apps/web/app/styles.css` went
  from ~470 lines to ~150 lines. Prose owns body typography; the SSR CSS owns only wrapper structure, list-item display,
  code-block chrome, colors, alignment, and SSR-only card fallbacks.

![Side-by-side diff of a rich document](./images/side-by-side.png) _Same document, same blocks. Left: before. Right:
after._

## Font stack

We also swapped in a **system-font** stack:

- Document body: `ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`. On macOS/iOS this picks up **New York**;
  on Windows it picks up **Cambria**; elsewhere it falls back to Georgia. Zero network cost, no flash of unstyled text.
- UI and comments: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", …` — the browser's native sans.
- Code: unchanged — `ui-monospace, SFMono-Regular, "SF Mono", Menlo, …`.

This removes every `font-family: … !important` rule from the content stylesheets. The UI picks up the native look on
each OS, and comments stay visually distinct from docs because `.hm-prose.is-comment` swaps the font stack.

![System fonts across macOS, Windows, Linux](./images/fonts-cross-platform.png) _Same page on three operating systems.
Native on each, no webfont loader required._

## What did not change

- **Block schema and document format.** Nothing in the hypermedia data model changed. Existing documents render
  identically in shape — only their typographic rhythm improves.
- **Editing behavior.** Keyboard shortcuts, block commands, drag handles, hover actions, and the slash menu are
  untouched.
- **Syntax highlighting for code blocks.** Still `lowlight` + `highlight.js` with the same token theme. Shiki migration
  is a separate follow-up.

## What's next

- **Shiki-based code blocks.** Move to VS-Code-grade tokenization with JSON themes and native SSR support. (Own PR.)
- **TipTap-free read-only renderer** for the web. Today the web app dynamically loads the full editor even to display a
  document. A dedicated, semantic-HTML-only renderer would ship less JS, render faster, and let us delete the SSR mirror
  entirely. (Own PR.)
- **Self-hosted editorial fonts** (Source Serif 4 / Newsreader pair) if we decide Seed wants a distinctive brand voice
  in the body text.

## How to try it

1. `git checkout simplify-editor-dom`
2. `pnpm install` (pulls in `@tailwindcss/typography`)
3. `pnpm --filter desktop dev` — open a rich doc with headings, lists, code, media, and a quote.
4. `pnpm --filter web dev` — visit the same doc on the web to confirm SSR and hydrated output match.

A companion stress-test document at `packages/editor/docs/stress-test.md` exercises every block type — headings, inline
marks, lists (with nesting), blockquotes, three code blocks, horizontal rule, and placeholder sections for each media
and embed type. Import it via `seed-cli draft create -f …/stress-test.md` or paste into a new draft to review the rhythm
in one scroll.

Toggle `Cmd/Ctrl+Shift+D` in the editor to show the block-boundary debug overlay — useful for seeing that wrappers now
carry no margin of their own.
