# Plan: Migrate Document Features from blocks-content.tsx to Editor Extensions

## Context

Documents are rendered by two separate systems: **blocks-content.tsx** (read-only, with document features like block hover actions, image gallery, range selection, citations) and the **Editor** (BlockNote/TipTap, for editing). We want to use the editor for both editing and viewing, replacing blocks-content.tsx entirely.

The scope is **document content rendering only** — feed and standalone comment rendering are separate concerns, not part of this migration.

## Architecture: Editor States

Introduce `EditorMode` to control which extensions load:

```typescript
type EditorMode = 'full' | 'document' | 'comment'
```

- **full**: All editing extensions + all document feature extensions
- **document**: No editing extensions + all document feature extensions (readOnly viewing)
- **comment**: Minimal editing extensions, no document features

Implemented in `BlockNoteEditor` constructor by conditionally including extensions in the `blockNoteUIExtension` bundle (lines 239-251 of `BlockNoteEditor.ts`).

## Pre-requisite: readOnly Fixes

Fix existing blocks that misbehave when `isEditable=false`:
- `math.tsx` — guard textarea behind `editor.isEditable`
- `mentions-plugin.tsx` — guard `@` autocomplete behind `editor.isEditable`
- `media-container.tsx` — guard drag handlers behind `editor.isEditable`

## Extensions to Build (one at a time)

Each follows the existing pattern: `*View` class (implements `PluginView`) + `*ProsemirrorPlugin` class (extends `EventEmitter`), rendered via a React positioner.

### Extension 1: Block Hover Actions
Hover block → floating card: copy block link, citation count, comment count, start comment.
- **Source**: `BlockNodeContent` hover card in blocks-content.tsx (~lines 550-700)
- **Pattern**: Like `SideMenuPlugin` — mouse tracking, `editor.view.posAtCoords()`, emit to React
- **New files**: `extensions/BlockHoverActions/BlockHoverActionsPlugin.ts`, `react/BlockHoverActions/BlockHoverActionsPositioner.tsx`
- **Modify**: `BlockNoteEditor.ts` (register for `document`/`full`), `editor-view.tsx` (render positioner)
- **Context**: `resourceId`, `blockCitations`, `onBlockCitationClick`, `onBlockCommentClick` — via editor options or context provider

### Extension 2: Image Gallery
Click image in readOnly → full-screen overlay with keyboard/swipe nav.
- **Source**: `ImageGalleryProvider` in blocks-content.tsx (lines 160-310)
- **New files**: `extensions/ImageGallery/ImageGalleryPlugin.ts`, `react/ImageGallery/ImageGalleryOverlay.tsx`
- **Modify**: `image.tsx` (click handler when `!isEditable`), `editor-view.tsx` (render overlay)
- **Reuse**: `collectImageBlocks`, `resolveGalleryNavigation`, `resolveSwipeDirection` (already exported from blocks-content.tsx)

### Extension 3: Range Selection / Citation Bubble
Select text in readOnly → bubble with "cite" and "comment" actions.
- **Source**: Range selection in blocks-content.tsx (uses `useRangeSelection` from `@shm/shared`)
- **Pattern**: Like `FormattingToolbarPlugin` — watches selection, active only when `!isEditable`
- **New files**: `extensions/RangeSelection/RangeSelectionPlugin.ts`, `react/RangeSelection/RangeSelectionPositioner.tsx`
- **Reuse**: `useRangeSelection` from `@shm/shared`

### Extension 4: Collapsed Blocks
Collapse/expand block children (headings, nested content).
- **Source**: `collapsedBlocks` state + collapse buttons in blocks-content.tsx
- **New files**: `extensions/CollapsedBlocks/CollapsedBlocksPlugin.ts`
- **Pattern**: ProseMirror plugin managing collapsed state set, decorations to hide children, React toggle buttons

### Extension 5: Block Highlighting / Focus
Highlight specific block (from URL `#blockId`), yellow range highlights for citations.
- **Source**: `focusBlockId` + highlight logic in blocks-content.tsx
- **New files**: `extensions/BlockHighlight/BlockHighlightPlugin.ts`
- **Pattern**: ProseMirror decoration plugin adding CSS classes to targeted blocks

## Consumer Migration

After extensions are ready, migrate **resource-page-common.tsx** (the main document content view) to use the editor in `document` mode instead of `BlocksContentProvider + BlocksContent`. Other consumers (preview.tsx, embed rendering) follow.

## Key Files

| File | Role |
|------|------|
| `editor/src/blocknote/core/BlockNoteEditor.ts` | Editor class, extension registration (lines 239-251) |
| `editor/src/blocknote/core/BlockNoteExtensions.ts` | Extension array builder |
| `editor/src/blocknote/core/extensions/SideMenu/SideMenuPlugin.ts` | Reference pattern for plugins |
| `editor/src/blocknote/core/extensions/FormattingToolbar/FormattingToolbarPlugin.ts` | Reference pattern |
| `editor/src/editor-view.tsx` | View component to extend |
| `editor/src/blocknote/react/hooks/useBlockNote.ts` | Hook for editor creation |
| `ui/src/blocks-content.tsx` | Source of features to migrate |
| `client/src/hmblock-to-editorblock.ts` | Data conversion `HMBlockNode → EditorBlock` |

## Verification

For each extension:
1. Build extension, register in editor
2. Render a published document with editor in `document` mode
3. Verify the feature works (hover actions appear, gallery opens, selection bubble shows, etc.)
4. `pnpm typecheck` in frontend workspace
5. Run existing tests in editor and ui packages
6. After migrating a consumer, visually verify no regression
