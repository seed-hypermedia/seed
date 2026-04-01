# Editor Migration: Incremental Steps

## Goal

Replace `BlocksContent` with the BlockNote editor for all document rendering (read-only and editable), then enable in-place editing via the document lifecycle machine.

## Current State (done)

- **Document lifecycle machine** (`@shm/shared/models/document-machine.ts`) — XState v5, states: loading → loaded → editing → publishing
- **React bindings** (`@shm/shared/models/use-document-machine.ts`) — provider, selectors, hooks
- **Wired into resource pages** — `DocumentMachineProvider` wraps both desktop and web document views
- **Machine tracks** `publishedVersion`, `canEdit`, `editUid`/`editPath`, `existingDraftId`
- **Old draft page** — fully functional, untouched

## Architecture Overview

```
@shm/shared
├── document-machine.ts      ← state machine (done)
└── use-document-machine.ts  ← React hooks/provider (done)

@shm/editor
├── blocknote/core/BlockNoteEditor.ts  ← has isEditable flag
├── blocknote/react/BlockNoteView.tsx  ← renders editor + toolbars
├── schema.ts                          ← hmBlockSchema (paragraph, heading, code-block, file, image, video, button, math, web-embed, embed, unknown)
└── editor-view.tsx                    ← HyperMediaEditorView (custom toolbars)

@shm/ui
├── resource-page-common.tsx  ← DocumentMachineProvider wraps here (done)
└── blocks-content.tsx        ← current read-only renderer (to be replaced)

desktop app
└── pages/desktop-resource.tsx  ← passes canEdit to ResourcePage (done)
    pages/draft.tsx             ← old draft page (stays for now)
```

---

## Step 1: Fix editor blocks for read-only mode

**Branch**: can split from main or from current branch

**Problem**: Several editor blocks don't check `isEditable` and will attempt mutations/show interactive controls in read-only mode.

**Files to fix**:

| File | Issue | Fix |
|------|-------|-----|
| `editor/src/math.tsx` (lines 194-300) | Textarea renders when selected, `editor.updateBlock()` fires on input change | Guard textarea and update behind `editor.isEditable` |
| `editor/src/media-container.tsx` (lines 51-100) | Drag-drop file replacement always active | Guard drag handlers and replace button behind `editor.isEditable` |
| `editor/src/mentions-plugin.tsx` (lines 41-54) | `@` autocomplete popup triggers in read-only | Guard autocomplete trigger behind `editor.isEditable` |

**Verification**:
- Create a simple test page rendering the editor with `editable: false` and documents containing math, images, and mentions
- Verify no interactive controls appear, no mutations fire
- `pnpm typecheck && pnpm test`

**Can be done in parallel with Step 2.**

---

## Step 2: Render editor in read-only mode for document view

**Branch**: depends on Step 1

**Goal**: Replace `<BlocksContent>` with `<BlockNoteView editor={editor}>` (editable=false) in `ContentViewWithOutline` within `resource-page-common.tsx`. Accept temporarily losing BlocksContent-only features (hover actions, image gallery, range selection, collapsed blocks, citations).

**What to do**:
1. Add `@shm/editor` as a dependency of `@shm/ui` (add to `frontend/packages/ui/package.json`)
2. Create a `ReadOnlyEditor` component in `@shm/ui` that:
   - Calls `useBlockNote({ editable: false, blockSchema: hmBlockSchema })`
   - Converts document blocks via `hmBlocksToEditorContent()` from `@seed-hypermedia/client/hmblock-to-editorblock`
   - Populates editor via `editor.replaceBlocks()` on mount and when blocks change
   - Renders `<BlockNoteView editor={editor}>` with NO toolbar children (no side menu, no slash menu, no formatting toolbar)
3. In `resource-page-common.tsx` → `ContentViewWithOutline`: render `<ReadOnlyEditor blocks={document.content} />` instead of `<BlocksContentProvider><BlocksContent>`.
4. Keep `BlocksContent` available for other consumers (comments, previews) — just remove from the document view.

**Key files**:
- `frontend/packages/ui/package.json` — add `@shm/editor` dep
- `frontend/packages/ui/src/read-only-editor.tsx` — NEW
- `frontend/packages/ui/src/resource-page-common.tsx` — swap renderer in `ContentViewWithOutline`

**CSS required**: Import `@shm/editor/blocknote/core/style.css` and `@shm/editor/editor.css` in the new component.

**Data conversion reference**: `hmBlocksToEditorContent()` is in `@seed-hypermedia/client/hmblock-to-editorblock`. Also need `setGroupTypes()` from `frontend/apps/desktop/src/models/editor-utils.ts` — this may need to be moved to a shared location or duplicated.

**Verification**:
- Open any published document → renders via editor (no toolbars, not editable)
- Text, headings, images, code blocks, videos, math, embeds all render correctly
- `pnpm typecheck && pnpm test`
- Visual comparison: screenshot before/after for regression check

**What you lose temporarily** (restored in Steps 3-7):
- Block hover actions (copy link, citation count, comment count)
- Image gallery overlay
- Text range selection with cite/comment bubble
- Collapsed blocks
- Block highlighting from URL fragments

---

## Step 3: Block Highlighting extension

**Branch**: depends on Step 2

**Goal**: Highlight specific block from URL `#blockId` and yellow highlights for citation ranges.

**Pattern**: ProseMirror decoration plugin that adds CSS classes to targeted block nodes.

**Reference source**: `blocks-content.tsx` — `focusBlockId` + highlight logic, `useHighlighter` context

**New files**:
- `editor/src/extensions/BlockHighlight/BlockHighlightPlugin.ts`

**Integration**: Register in `BlockNoteEditor.ts` when mode is `document` or `full`. The `ReadOnlyEditor` component passes the `focusBlockId` from the route.

---

## Step 4: Image Gallery extension

**Branch**: depends on Step 2

**Goal**: Click image in read-only → full-screen overlay with keyboard/swipe navigation.

**Reference source**: `blocks-content.tsx` `ImageGalleryProvider` (lines 165-320). Utility functions `collectImageBlocks`, `resolveGalleryNavigation`, `resolveSwipeDirection` are already exported.

**New files**:
- `editor/src/extensions/ImageGallery/ImageGalleryPlugin.ts`
- `editor/src/react/ImageGallery/ImageGalleryOverlay.tsx`

**Integration**: Modify `image.tsx` to add click handler when `!isEditable`. Render overlay via editor view.

---

## Step 5: Block Hover Actions extension

**Branch**: depends on Step 2

**Goal**: Hover block → floating card with copy block link, citation count, comment count, start comment.

**Pattern**: Like `SideMenuPlugin` — mouse tracking, `editor.view.posAtCoords()`, emit to React positioner.

**Reference source**: `blocks-content.tsx` `BlockNodeContent` hover card (lines 550-700)

**New files**:
- `editor/src/extensions/BlockHoverActions/BlockHoverActionsPlugin.ts`
- `editor/src/react/BlockHoverActions/BlockHoverActionsPositioner.tsx`

**Context needed**: `resourceId`, `blockCitations`, `onBlockCitationClick`, `onBlockCommentClick` — pass via editor options or React context.

---

## Step 6: Range Selection / Citation Bubble extension

**Branch**: depends on Step 2

**Goal**: Select text in read-only → bubble with "cite" and "comment" actions.

**Pattern**: Like `FormattingToolbarPlugin` — watches ProseMirror selection, active only when `!isEditable`.

**Reference source**: `blocks-content.tsx` range selection, `useRangeSelection` from `@shm/shared`

**New files**:
- `editor/src/extensions/RangeSelection/RangeSelectionPlugin.ts`
- `editor/src/react/RangeSelection/RangeSelectionPositioner.tsx`

---

## Step 7: Collapsed Blocks extension

**Branch**: depends on Step 2

**Goal**: Collapse/expand block children (headings, nested content).

**Reference source**: `blocks-content.tsx` `collapsedBlocks` state + collapse buttons (lines 344-355, 967-978)

**New files**:
- `editor/src/extensions/CollapsedBlocks/CollapsedBlocksPlugin.ts`

**Pattern**: ProseMirror plugin managing collapsed state set, decorations to hide children, React toggle buttons.

---

## Step 8: In-place editing (use document machine)

**Branch**: depends on Step 2 (extensions are nice-to-have but not blocking)

**Goal**: When user clicks "Edit" on desktop, toggle editor to `editable: true` instead of navigating to `/draft`. Uses the document lifecycle machine's `editing` states.

**Why this is now simple**: The editor is ALREADY the renderer. No component swap needed — just toggle `editor.isEditable = true`, show toolbars, and wire `onEditorContentChange → send({type: 'change'})`.

**What to do**:
1. Create `useDocumentEditor` hook in desktop app:
   - Wraps `useBlockNote` with machine event wiring
   - `onEditorContentChange` → `actorRef.send({type: 'change'})`
   - Populates content from `document.content` (already loaded)
2. Create `writeDraft` actor factory (extract from `documents.ts:611-652`)
3. Provide machine with actors via `documentMachine.provide({actors: {writeDraft}})`
4. Pass provided machine to `ResourcePage` via `machine` prop (already supported)
5. Change edit button to send `edit.start` instead of navigating to `/draft`
6. Toggle `editor.isEditable` based on machine state
7. Show/hide toolbars based on machine state
8. Wire navigation guard for unsaved changes

**Verification**:
- Click edit → editor becomes editable, toolbars appear
- Type → autosave creates draft with correct editUid/editPath
- Cancel → editor becomes read-only, toolbars hide
- Navigate away with changes → dialog prompts
- Old `/draft` page still works

---

## Step 9: Publishing through machine

**Branch**: depends on Step 8

**Goal**: Move publish flow into the machine. `publish.start` → `publishing.inProgress` → `cleaningUp` → `loaded`.

**What to do**:
- Extract publish pipeline from `publish-draft-button.tsx` into a `publishDocument` actor
- Provide via `.provide()` in desktop-resource
- Update publish button to read machine state and send `publish.start`

---

## Step 10: Migrate existing drafts & remove old code

**Branch**: depends on Steps 8-9

**Goal**: Route existing `/draft` URLs through the unified machine. Remove old draft page and draft machine.

**What to do**:
- Redirect `/draft/:id` routes to document routes with editing state
- Remove `draft-machine.ts`, `draft.tsx`, `useDraftEditor`
- Remove `BlocksContent` from document view (keep for comments/previews if still needed)

---

## Parallelism Guide

```
Step 1 (readOnly fixes) ─────────┐
                                  ├─→ Step 2 (editor in readOnly mode)
                                  │     │
                                  │     ├─→ Step 3 (block highlight)    ──┐
                                  │     ├─→ Step 4 (image gallery)      ──┤
                                  │     ├─→ Step 5 (hover actions)      ──┤ can be parallel
                                  │     ├─→ Step 6 (range selection)    ──┤
                                  │     ├─→ Step 7 (collapsed blocks)   ──┘
                                  │     │
                                  │     └─→ Step 8 (in-place editing) ──→ Step 9 (publishing) ──→ Step 10 (cleanup)
```

Steps 3-7 can ALL be done in parallel with each other and with Step 8. Each is an independent editor extension.

---

## Key Reference Files

| File | Purpose |
|------|---------|
| `frontend/packages/shared/src/models/document-machine.ts` | State machine definition |
| `frontend/packages/shared/src/models/use-document-machine.ts` | React provider, selectors, hooks |
| `frontend/packages/ui/src/resource-page-common.tsx` | Main document page, provider wiring |
| `frontend/packages/ui/src/blocks-content.tsx` | Current read-only renderer (source for extension features) |
| `frontend/packages/editor/src/blocknote/core/BlockNoteEditor.ts` | Editor class, `isEditable` (line 603) |
| `frontend/packages/editor/src/blocknote/react/BlockNoteView.tsx` | Editor React wrapper |
| `frontend/packages/editor/src/schema.ts` | `hmBlockSchema` block types |
| `frontend/packages/editor/src/blocknote/react/hooks/useBlockNote.ts` | Editor creation hook |
| `frontend/packages/editor/src/blocknote/core/extensions/SideMenu/SideMenuPlugin.ts` | Reference pattern for new extensions |
| `frontend/apps/desktop/src/models/documents.ts` | `useDraftEditor` (line 479), `writeDraft` (line 611) |
| `frontend/apps/desktop/src/models/draft-machine.ts` | Old draft machine (to be replaced) |
| `frontend/apps/desktop/src/pages/draft.tsx` | Old draft page (to be replaced) |
| `@seed-hypermedia/client/hmblock-to-editorblock` | `hmBlocksToEditorContent()` converter |
