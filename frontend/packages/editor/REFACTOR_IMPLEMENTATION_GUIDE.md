# Editor Schema Refactoring — Complete Implementation Guide

> **Purpose**: Self-contained guide for implementing the ProseMirror node
> rename + DOM simplification refactoring. Can be executed by any developer or
> LLM session without additional context.

## What This Refactoring Does

The editor's ProseMirror schema produces deeply nested DOM (~7 levels for a
paragraph). This refactoring:

1. **Renames ProseMirror nodes** — `blockGroup` → `blockChildren`,
   `blockContainer` → `blockNode`
2. **Renames ProseMirror groups** — `blockContent` group → `block`,
   `blockGroupChild` group → `blockNodeChild`
3. **Simplifies DOM output** — removes wrapper divs so block content renders as
   semantic HTML
4. **PM node depth stays the same** — only names and HTML output change
5. **HMBlock server format is NOT modified** — conversion layers are untouched

### DOM Before (7 levels for a paragraph):

```html
<div class="ProseMirror">
  <div class="blockGroup" data-node-type="blockGroup">
    <div class="blockOuter" data-node-type="block-outer" data-id="abc">
      <div class="block" data-node-type="blockContainer" data-id="abc">
        <div class="blockContent" data-content-type="paragraph">
          <p class="inlineContent">Hello world</p>
        </div>
      </div>
    </div>
  </div>
</div>
```

### DOM After (4 levels):

```html
<div class="ProseMirror">
  <div class="blockChildren" data-node-type="blockChildren">
    <div class="blockNode" data-node-type="blockNode" data-id="abc">
      <p class="blockContent" data-content-type="paragraph">Hello world</p>
    </div>
  </div>
</div>
```

## Scope & Non-Goals

**Modified**: ~44 files in `frontend/packages/editor/` and
`frontend/apps/desktop/` **NOT modified**:

- `frontend/packages/shared/src/client/editorblock-to-hmblock.ts` — HMBlock
  format unchanged
- `frontend/packages/shared/src/client/hmblock-to-editorblock.ts` — HMBlock
  format unchanged
- `frontend/packages/shared/src/editor-types.ts` — EditorBlock types unchanged
- `frontend/packages/ui/src/blocks-content.tsx` — renders from HMBlock, not PM
- `frontend/packages/ui/src/blocks-content.css` — styles published content, not
  editor

## Global String Replacement Reference

| Old String                         | New String                       | Context                                             |
| ---------------------------------- | -------------------------------- | --------------------------------------------------- |
| `'blockGroup'`                     | `'blockChildren'`                | Node name in schema lookups, type checks            |
| `'blockContainer'`                 | `'blockNode'`                    | Node name in schema lookups, type checks            |
| `'blockContent'` (as group)        | `'block'`                        | In `group:` definitions and `spec.group ===` checks |
| `'blockGroupChild'` (as group)     | `'blockNodeChild'`               | In `group:` and `content:` definitions              |
| `blockOuter` (CSS class)           | `blockNode`                      | CSS module class name                               |
| `.block` (CSS class for inner div) | _(removed)_                      | Was the inner wrapper, no longer exists             |
| `blockGroup` (CSS class)           | `blockChildren`                  | CSS module class name                               |
| `data-node-type='blockContainer'`  | `data-node-type='blockNode'`     | HTML attributes                                     |
| `data-node-type='blockGroup'`      | `data-node-type='blockChildren'` | HTML attributes                                     |
| `data-node-type='block-outer'`     | _(removed)_                      | Outer wrapper no longer exists                      |
| `node-blockContainer`              | `node-blockNode`                 | TipTap auto-generated CSS class                     |
| `BlockGroup` (export name)         | `BlockChildren`                  | Import/export identifiers                           |
| `BlockContainer` (export name)     | `BlockNode`                      | Import/export identifiers                           |

**DO NOT rename**: `blockContent` as a DOM attributes key (in
`domAttributes?.blockContent`). This is a public API surface — keep it as-is.

---

## Implementation Steps (execute in order)

### Step 1: File Renames

```bash
git mv frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/BlockGroup.ts frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/BlockChildren.ts
git mv frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/BlockContainer.ts frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/BlockNode.ts
```

Update all import paths that reference these files.

### Step 2: Type Definitions

**File: `blockTypes.ts`**

- `BlockNoteDOMElement`: `'blockContainer'` → `'blockNode'`, `'blockGroup'` →
  `'blockChildren'`
- `TipTapNode` type: `group: 'blockContent'` → `group: 'block'`
- Update JSDoc comments

### Step 3: Core Schema — BlockChildren.ts (was BlockGroup.ts)

**Node definition:** `name: 'blockChildren'`, `content: 'blockNodeChild+'`

**renderHTML**: `data-node-type: 'blockChildren'`

**parseHTML**: Match both `'blockChildren'` and `'blockGroup'` for backward
compat paste.

**All helper functions** — replace throughout:

- `'blockContainer'` → `'blockNode'`
- `'blockGroup'` → `'blockChildren'`
- `spec.group === 'blockContent'` → `'block'`

### Step 4: Core Schema — BlockNode.ts (was BlockContainer.ts)

**Node definition:** `name: 'blockNode'`, `group: 'blockNodeChild block'`,
`content: 'block blockChildren?'`

**renderHTML — flatten 2 divs to 1:**

```ts
// BEFORE: ['div', {blockOuter attrs}, ['div', {block attrs}, 0]]
// AFTER:  ['div', {blockNode attrs}, 0]
```

**parseHTML**: Match both `'blockNode'` and `'blockContainer'` for backward
compat.

### Step 5: Core Schema — block.ts

- `createTipTapBlock`: `group: 'block'` (was `'blockContent'`)
- `createBlockSpec`'s `addNodeView()`: Remove `blockContent` wrapper div. Apply
  attributes directly to `rendered.dom`.

### Step 6: Blocks/index.ts

- Export `BlockNode`, `BlockChildren` (was `BlockContainer`, `BlockGroup`)
- Doc content: `'blockChildren'` (was `'blockGroup'`)

### Step 7: Block Content Rendering

- **ParagraphBlockContent.ts**: Flatten `['div', ..., ['p', ..., 0]]` to
  `['p', ..., 0]`
- **heading-component-plugin.tsx**: Flatten `['div', ..., ['h2', ..., 0]]` to
  `['h2', ..., 0]`
- **code-block.ts**: Remove blockContent wrapper
- **code-block-lowlight.tsx**: Update `styles.blockContent` refs
- **image-placeholder.ts**: Update `styles.blockContent` refs

### Step 8: ReactBlockSpec.tsx

- Keep `blockContent` class on the element
- Remove wrapper div pattern

### Step 9: Helpers

- **getBlockInfoFromPos.ts**: `spec.group === 'block'`,
  `name === 'blockChildren'`
- **getGroupInfoFromPos.ts**: `'blockChildren'`, `'blockNode'`
- **findBlock.ts**: `'blockNode'`

### Step 10: Commands (all files)

Apply: `'blockContainer'` → `'blockNode'`, `'blockGroup'` → `'blockChildren'`,
`schema.nodes['blockContainer']` → `schema.nodes['blockNode']`,
`.sinkListItem('blockNode')`, `.liftListItem('blockNode')`

Files: nestBlock.ts, splitBlock.ts, mergeBlocks.ts, updateBlock.ts,
updateGroup.ts, replaceBlocks.ts, insertBlocks.ts, blockManipulation.ts,
nodeConversions.ts, getBlock.ts, nodeUtil.ts

### Step 11: Extensions

- **BlockNoteExtensions.ts**: Import `BlockNode`/`BlockChildren`,
  `UniqueID types: ['blockNode']`
- **BlockNoteEditor.ts**: String refs
- **TrailingNodeExtension.ts**: String refs
- **KeyboardShortcutsExtension.ts**: String refs
- **DraggableBlocksPlugin.ts**: `spec.group === 'block'`,
  `data-node-type === 'blockNode'`
- **SideMenuPlugin.ts**: Same as DraggableBlocks
- **BlockManipulationExtension.ts**: String refs
- **MarkdownExtension.ts**: String refs
- **MarkdownToBlocks.ts**: String refs
- **TextColorExtension.ts**: `types: ['blockNode']`
- **BackgroundColorExtension.ts**: `types: ['blockNode']`
- **TextAlignmentExtension.ts**: `spec.group === 'block'`
- **defaultLinkMenuItems.tsx**: `schema.nodes['blockNode']`

### Step 12: simplifyBlocksRehypePlugin.ts — HIGH RISK

DOM traversal rewrite. Before: 3 levels of unwrapping (blockOuter →
blockContainer → blockContent). After: 1 level (blockNode → blockContent
directly).

```ts
// BEFORE:
const blockOuter = tree.children[i]
const blockContainer = blockOuter.children[0]
const blockContent = blockContainer.children[0]
const blockGroup =
  blockContainer.children.length === 2 ? blockContainer.children[1] : null
// extraction: blockContent.children[0]

// AFTER:
const blockNode = tree.children[i]
const blockContent = blockNode.children[0]
const blockGroup =
  blockNode.children.length === 2 ? blockNode.children[1] : null
// extraction: blockContent (IS the semantic element now)
```

### Step 13: Other Editor Files

- **block-utils.ts**: `'blockNode'`
- **utils.ts**: String refs
- **pasteHandler.ts**: String refs
- **hm-link-preview.tsx**: String refs

### Step 14: CSS

- **Block.module.css**: `.blockOuter` → `.blockNode`, remove `.block`,
  `.blockGroup` → `.blockChildren`, update placeholder selectors (remove
  `.inlineContent` nesting)
- **editor.css**: `block-outer` → `blockNode`, `node-blockContainer` →
  `node-blockNode`, simplify heading margin `:has()` selectors
- **document.css**: Add `blockNode` selectors alongside `blockContainer` (dual
  context)

### Step 15: Desktop App

- **editor-utils.ts**: `'blockChildren'`
- **documents.ts**: Verify findBlock usage

---

## Verification

```bash
# Grep (all must return 0)
rg "'blockGroup'" frontend/packages/editor/src/
rg "'blockContainer'" frontend/packages/editor/src/
rg "'blockContent'" frontend/packages/editor/src/  # except domAttributes key
rg "'blockGroupChild'" frontend/packages/editor/src/
rg 'blockOuter' frontend/packages/editor/src/
rg "'blockContainer'" frontend/apps/desktop/src/

# Build
pnpm -F @shm/shared build:types && pnpm typecheck && pnpm format:write
```

## Complete File List (44+ files)

1. `BlockChildren.ts` (renamed from BlockGroup.ts)
2. `BlockNode.ts` (renamed from BlockContainer.ts)
3. `block.ts`
4. `Blocks/index.ts`
5. `blockTypes.ts`
6. `ParagraphBlockContent.ts`
7. `heading-component-plugin.tsx`
8. `code-block.ts`
9. `code-block-lowlight.tsx`
10. `image-placeholder.ts`
11. `ReactBlockSpec.tsx`
12. `getBlockInfoFromPos.ts`
13. `getGroupInfoFromPos.ts`
14. `findBlock.ts`
15. `nodeUtil.ts`
16. `nestBlock.ts`
17. `splitBlock.ts`
18. `mergeBlocks.ts`
19. `updateBlock.ts`
20. `updateGroup.ts`
21. `replaceBlocks.ts`
22. `insertBlocks.ts`
23. `blockManipulation.ts`
24. `nodeConversions.ts`
25. `getBlock.ts`
26. `BlockNoteExtensions.ts`
27. `BlockNoteEditor.ts`
28. `TrailingNodeExtension.ts`
29. `KeyboardShortcutsExtension.ts`
30. `DraggableBlocksPlugin.ts`
31. `SideMenuPlugin.ts`
32. `BlockManipulationExtension.ts`
33. `MarkdownExtension.ts`
34. `MarkdownToBlocks.ts`
35. `simplifyBlocksRehypePlugin.ts`
36. `TextColorExtension.ts`
37. `BackgroundColorExtension.ts`
38. `TextAlignmentExtension.ts`
39. `defaultLinkMenuItems.tsx`
40. `block-utils.ts`
41. `utils.ts`
42. `pasteHandler.ts`
43. `hm-link-preview.tsx`
44. `Block.module.css`
45. `editor.css`
46. `document.css`
47. `editor-utils.ts` (desktop)
48. `documents.ts` (desktop)
