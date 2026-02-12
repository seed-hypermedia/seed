# Editor Schema Refactoring: Simplify ProseMirror Node Structure

## Context

The editor's ProseMirror schema currently produces deeply nested DOM with
excessive wrapper divs. A simple paragraph generates ~8 levels of DOM nesting.
This refactoring renames nodes, eliminates wrapper divs, and produces semantic
HTML while keeping the HMBlock server format unchanged.

**Current schema:**

```
doc → blockGroup → blockContainer → blockContent(paragraph) → inline*
         ↑ renders: <div><ul>    ↑ renders: <div><div>    ↑ renders: <div><p>
```

**Target schema (same PM depth, simpler DOM):**

```
doc → blockChildren → blockNode → paragraph → inline*
         ↑ renders: <ul>         ↑ renders: <div>    ↑ renders: <p>
```

**Critical insight: ProseMirror node depth does NOT change** — only node names
and HTML output change. This means position offset arithmetic in commands stays
mostly identical, dramatically reducing risk.

## Scope

- **Editor-only change** — HMBlock server format, `blocks-content.tsx`, and
  `blocks-content.css` are NOT modified
- `editorblock-to-hmblock.ts` and `hmblock-to-editorblock.ts` stay unchanged
  (EditorBlock types unchanged)
- The conversion layer already maps between editor types and HM types

## Naming Changes

| Current                   | New                      | Group                  |
| ------------------------- | ------------------------ | ---------------------- |
| `blockGroup`              | `blockChildren`          | `childContainer`       |
| `blockContainer`          | `blockNode`              | `blockNodeChild block` |
| `blockContent` (group)    | `block` (group)          | —                      |
| `blockGroupChild` (group) | `blockNodeChild` (group) | —                      |

---

## Phase 1: Rename Nodes + Simplify DOM (Single Atomic Change)

Since PM node depth stays the same, we can do the rename AND DOM simplification
together. This is a big-bang change within the editor package — the editor won't
work until all references are updated, but it's mostly mechanical.

### 1A. Core node definitions

**`BlockGroup.ts` → rename to `BlockChildren.ts`**

- `name: 'blockChildren'`
- `content: 'blockNodeChild+'`
- `group: 'childContainer'`
- `renderHTML`: render DIRECTLY as `<ul>/<ol>/<div>/<blockquote>` (remove inner
  wrapper div)
- `parseHTML`: update `data-node-type` checks to `'blockChildren'`, keep
  `ul/ol/blockquote/div` parsing
- Update `normalizeFragment`, `wrapBlockContentInContainer`,
  `wrapBlockGroupInContainer`, `splitBlockContainerNode` — replace all
  `'blockContainer'`→`'blockNode'`, `'blockGroup'`→`'blockChildren'`,
  `'blockContent'`→`'block'`

**`BlockContainer.ts` → rename to `BlockNode.ts`**

- `name: 'blockNode'`
- `group: 'blockNodeChild block'`
- `content: 'block blockChildren?'`
- `renderHTML`: emit SINGLE `<div>` instead of
  `<div.blockOuter><div.blockContainer>` (drop one wrapper level)
- `parseHTML`: update `data-node-type` to `'blockNode'`, keep `li` and `div`
  parsing
- Update all internal references: `'blockContainer'`→`'blockNode'`,
  `'blockGroup'`→`'blockChildren'`

**`Blocks/index.ts`**

- `Doc.content: 'blockChildren'`
- Update exports

**`block.ts` (createTipTapBlock)**

- `group: 'block'` (was `'blockContent'`)

### 1B. Block content rendering simplification

Each block content node currently renders
`<div.blockContent><p.inlineContent>0</p></div>`. Simplify to just the semantic
element.

| File                           | Current renderHTML                                                    | New renderHTML                                                         |
| ------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ParagraphBlockContent.ts`     | `['div', {class:'blockContent'}, ['p', {class:'inlineContent'}, 0]]`  | `['p', {class:'block-paragraph', 'data-content-type':'paragraph'}, 0]` |
| `heading-component-plugin.tsx` | `['div', {class:'blockContent'}, ['h2', {class:'inlineContent'}, 0]]` | `['h2', {class:'block-heading', 'data-content-type':'heading'}, 0]`    |
| `code-block.ts`                | Has own rendering                                                     | Remove blockContent wrapper div                                        |
| All `createBlockSpec` blocks   | `blockContent` div created in `block.ts`                              | Remove wrapper, render `dom` directly                                  |

### 1C. Helper functions

**`getBlockInfoFromPos.ts`**

- `node.type.spec.group === 'blockContent'` → `'block'`
- `node.type.name === 'blockGroup'` → `'blockChildren'`
- `isInGroup('block')` already works (blockContainer is already in group
  `'block'`)
- Update comments/JSDoc

**`getGroupInfoFromPos.ts`**

- `'blockGroup'` → `'blockChildren'`
- `'blockContainer'` → `'blockNode'`
- `level: Math.ceil((maxDepth - 1) / 2)` — unchanged (depth is the same)

**`findBlock.ts`**

- `node.type.name === 'blockContainer'` → `'blockNode'`

### 1D. All command files (string replacements)

These files need `'blockContainer'`→`'blockNode'`,
`'blockGroup'`→`'blockChildren'`, `'blockContent'`→`'block'` (group checks
only):

- `nestBlock.ts` — also references `sinkListItem`/`liftListItem` with type names
- `splitBlock.ts` — `split(posInBlock, 2, types)` stays depth 2 (blockNode +
  block)
- `mergeBlocks.ts`
- `updateBlock.ts`
- `updateGroup.ts`
- `replaceBlocks.ts`
- `insertBlocks.ts`
- `blockManipulation.ts`
- `nodeConversions.ts`

### 1E. Extension files

- `BlockNoteExtensions.ts` — update imports,
  `UniqueID.configure({types: ['blockNode']})`
- `BlockNoteEditor.ts` — `'blockContainer'`→`'blockNode'`,
  `'blockGroup'`→`'blockChildren'`
- `TrailingNodeExtension.ts` — `'blockContainer'`→`'blockNode'`,
  `'blockGroup'`→`'blockChildren'`
- `KeyboardShortcutsExtension.ts` — all string references
- `DraggableBlocksPlugin.ts` — group checks `'blockContent'`→`'block'`
- `SideMenuPlugin.ts` — `'blockContainer'`→`'blockNode'`
- `BlockManipulationExtension.ts` — string references
- `MarkdownExtension.ts` — string references
- `MarkdownToBlocks.ts` — string references
- `simplifyBlocksRehypePlugin.ts` — HTML selectors for new DOM structure

### 1F. External editor files

- `block-utils.ts` — `'blockContainer'`→`'blockNode'`
- `ReactBlockSpec.tsx` — group references
- `pasteHandler.ts` — node type references
- `hm-link-preview.tsx` — node type references
- `utils.ts` — node type references

### 1G. Desktop app files

- `editor-utils.ts` — `'blockGroup'`→`'blockChildren'`
- `documents.ts` — `findBlock` usage
- `schema.ts` — no changes needed (defines hmBlockSchema, not PM schema)

### 1H. CSS files

**`Block.module.css`**

- `.blockOuter` → `.blockNode` (single element now)
- Remove `.block` (was the inner div, no longer exists)
- `.blockContent` → move styles to block elements directly
- `.blockGroup` → `.blockChildren`
- `.isEmpty` placeholder styles — update selectors
- List nesting selectors update

**`editor.css`**

- `[data-node-type='blockContainer']` → `[data-node-type='blockNode']`
- `[data-node-type='blockGroup']` → `[data-node-type='blockChildren']`
- List styling selectors

### Verification — Phase 1

```bash
pnpm typecheck           # Must pass
pnpm format:write        # Format
./dev run-desktop        # Manual testing
```

Manual test checklist:

- [ ] Type text in empty document
- [ ] Create headings (# shortcut)
- [ ] Create lists (-, 1., >)
- [ ] Nest/unnest blocks (Tab, Shift-Tab)
- [ ] Split blocks (Enter)
- [ ] Merge blocks (Backspace at start)
- [ ] Delete blocks
- [ ] Paste plain text
- [ ] Paste formatted HTML
- [ ] Copy/paste blocks within editor
- [ ] Drag blocks
- [ ] Undo/redo
- [ ] All block types: image, video, file, embed, code, math, button, web-embed,
      query
- [ ] Placeholder text shows correctly
- [ ] Side menu appears on hover

### Risks — Phase 1

1. **Missing a string reference** — mitigate with thorough grep for old names
2. **CSS selectors breaking** — fewer wrapper divs changes specificity; test
   visually
3. **parseHTML not matching on paste** — new DOM structure needs updated parse
   rules
4. **React nodeViews** — `ReactBlockSpec.tsx` creates DOM structure that may
   assume wrapper divs

---

## Phase 2: Edge Cases and Polish

After Phase 1 is working, address edge cases found during testing:

- Fix any paste normalization edge cases
- Fix drag/drop positioning if DOM measurements changed
- Fix side menu positioning
- Fix any CSS specificity issues
- Update `fragmentToBlocks.ts` if needed (currently commented out)
- Clean up dead code, comments, TODOs

### Verification — Phase 2

```bash
pnpm typecheck
pnpm test                # All tests pass
pnpm format:write
```

- Full QA pass on all block types
- Test paste from external sources (Google Docs, Notion, web pages)
- Test deeply nested documents (4+ levels)
- Test collaborative editing if applicable

---

## Files Summary (all changes)

### Must modify (~35 files):

- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/BlockGroup.ts`
  → `BlockChildren.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/BlockContainer.ts`
  → `BlockNode.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/index.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/api/block.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/api/blockTypes.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/BlockContent/ParagraphBlockContent/ParagraphBlockContent.ts`
- `frontend/packages/editor/src/heading-component-plugin.tsx`
- `frontend/packages/editor/src/tiptap-extension-code-block/code-block.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/helpers/getGroupInfoFromPos.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/helpers/findBlock.ts`
- `frontend/packages/editor/src/blocknote/core/api/blockManipulation/commands/nestBlock.ts`
- `frontend/packages/editor/src/blocknote/core/api/blockManipulation/commands/splitBlock.ts`
- `frontend/packages/editor/src/blocknote/core/api/blockManipulation/commands/mergeBlocks.ts`
- `frontend/packages/editor/src/blocknote/core/api/blockManipulation/commands/updateBlock.ts`
- `frontend/packages/editor/src/blocknote/core/api/blockManipulation/commands/updateGroup.ts`
- `frontend/packages/editor/src/blocknote/core/api/blockManipulation/commands/replaceBlocks.ts`
- `frontend/packages/editor/src/blocknote/core/api/blockManipulation/commands/insertBlocks.ts`
- `frontend/packages/editor/src/blocknote/core/api/blockManipulation/blockManipulation.ts`
- `frontend/packages/editor/src/blocknote/core/api/nodeConversions/nodeConversions.ts`
- `frontend/packages/editor/src/blocknote/core/api/formatConversions/simplifyBlocksRehypePlugin.ts`
- `frontend/packages/editor/src/blocknote/core/BlockNoteExtensions.ts`
- `frontend/packages/editor/src/blocknote/core/BlockNoteEditor.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/TrailingNode/TrailingNodeExtension.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/KeyboardShortcuts/KeyboardShortcutsExtension.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/DraggableBlocks/DraggableBlocksPlugin.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/SideMenu/SideMenuPlugin.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/BlockManipulation/BlockManipulationExtension.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Markdown/MarkdownExtension.ts`
- `frontend/packages/editor/src/blocknote/core/extensions/Markdown/MarkdownToBlocks.ts`
- `frontend/packages/editor/src/blocknote/react/ReactBlockSpec.tsx`
- `frontend/packages/editor/src/block-utils.ts`
- `frontend/packages/editor/src/utils.ts`
- `frontend/packages/editor/src/tiptap-extension-link/helpers/pasteHandler.ts`
- `frontend/packages/editor/src/hm-link-preview.tsx`
- `frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/Block.module.css`
- `frontend/packages/editor/src/editor.css`
- `frontend/apps/desktop/src/models/editor-utils.ts`
- `frontend/apps/desktop/src/models/documents.ts`

### NOT modified:

- `frontend/packages/shared/src/client/editorblock-to-hmblock.ts` — HMBlock
  format unchanged
- `frontend/packages/shared/src/client/hmblock-to-editorblock.ts` — HMBlock
  format unchanged
- `frontend/packages/shared/src/editor-types.ts` — EditorBlock types unchanged
- `frontend/packages/ui/src/blocks-content.tsx` — renders from HMBlock, not PM
- `frontend/packages/ui/src/blocks-content.css` — styles published content, not
  editor

---

## Appendix A: Current Pseudo-Schema (for reference)

```
Doc {
  content: 'blockGroup'
}

blockGroup {
  name: 'blockGroup'
  group: 'childContainer'
  content: 'blockGroupChild+'
  attrs: { listLevel: '1', listType: 'Group' }
  // listType: 'Group' | 'Unordered' | 'Ordered' | 'Blockquote'
  // Renders: <div class="blockGroup"><ul|ol|blockquote|div ...>0</div>
  //          (outer div wrapper + inner semantic element)
}

blockContainer {
  name: 'blockContainer'
  group: 'blockGroupChild block'
  content: 'blockContent blockGroup?'
  attrs: { id, ...BlockAttributes }
  // Renders: <div class="blockOuter"><div class="block">0</div></div>
  //          (TWO nested divs)
}

// --- Block content types (all in group 'blockContent') ---

paragraph {
  group: 'blockContent'   // set by createTipTapBlock
  content: 'inline*'
  // Renders: <div class="blockContent"><p class="inlineContent">0</p></div>
}

heading {
  group: 'blockContent'
  content: 'inline*'
  attrs: { level: '2' }
  // Renders: <div class="blockContent"><h2 class="inlineContent">0</h2></div>
}

image, video, file, embed, button, web-embed, math, query, nostr, unknown {
  group: 'blockContent'
  content: '' or 'inline*' (depends on containsInlineContent)
  // Created via createBlockSpec / createReactBlockSpec
  // Render: <div class="blockContent">..custom dom..</div>
}

code-block {
  group: 'blockContent'
  content: 'text*'
  // Custom rendering with pre/code
}

// --- Inline nodes ---
text, hardBreak, inline-embed (atom, inline)

// --- Marks ---
bold, italic, underline, strike, code, link, textColor, backgroundColor
```

---

## Appendix B: Grep Checklist — All String Literals to Replace

Run these greps AFTER making changes to verify no references remain:

```bash
# Node names (must have ZERO matches after refactoring)
rg "'blockGroup'" frontend/packages/editor/src/
rg "'blockContainer'" frontend/packages/editor/src/
rg '"blockGroup"' frontend/packages/editor/src/
rg '"blockContainer"' frontend/packages/editor/src/

# Group names in spec checks (must have ZERO matches)
rg "'blockContent'" frontend/packages/editor/src/
rg "'blockGroupChild'" frontend/packages/editor/src/

# CSS class names (must have ZERO matches)
rg 'blockOuter' frontend/packages/editor/src/
rg '\.block[^A-Za-z_-]' frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/Block.module.css
rg 'blockGroup' frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/Block.module.css

# data-node-type HTML attributes (must have ZERO matches for old values)
rg "data-node-type='blockContainer'" frontend/packages/editor/src/
rg "data-node-type='blockGroup'" frontend/packages/editor/src/
rg 'data-node-type="blockContainer"' frontend/packages/editor/src/
rg 'data-node-type="blockGroup"' frontend/packages/editor/src/
rg "data-node-type='block-outer'" frontend/packages/editor/src/

# Also check desktop app
rg "'blockGroup'" frontend/apps/desktop/src/
rg "'blockContainer'" frontend/apps/desktop/src/

# TipTap auto-generated CSS classes (these come from node names)
# node-blockContainer → node-blockNode (TipTap adds 'node-' prefix)
rg 'node-blockContainer' frontend/packages/editor/src/
```

---

## Appendix C: Detailed Code Changes Per Key File

### C1. `BlockGroup.ts` → `BlockChildren.ts` (461 lines)

**Node definition (line 46-51):**

```ts
// BEFORE:
name: 'blockGroup',
group: 'childContainer',
content: 'blockGroupChild+',

// AFTER:
name: 'blockChildren',
group: 'childContainer',
content: 'blockNodeChild+',
```

**renderHTML (line 202-221):** Currently renders with
`data-node-type: 'blockGroup'`. Change to `'blockChildren'`. The `listNode()`
function (returns ul/ol/blockquote/div) stays unchanged.

**parseHTML (line 137-199):** The `div` rule checks
`data-node-type === 'blockGroup'` at line 190. Change to `'blockChildren'`. The
`ul/ol/blockquote` rules stay as-is (they parse external HTML).

**normalizeFragment (line 327-426):** Contains these string references:

- Line 331: `node.type.name === 'blockContainer'` → `'blockNode'`
- Line 339: `node.type.name === 'blockGroup'` → `'blockChildren'`
- Line 247-248: `node.type.name !== 'blockContainer'` and
  `node.type.name !== 'blockGroup'` → update both
- Line 296: `child.type.spec.group === 'blockContent'` → `'block'`
- Line 298: `child.type.name === 'blockGroup'` → `'blockChildren'`
- Line 350/355: `firstChild.type?.name === 'blockContainer'`/`'blockGroup'` →
  update
- Line 369/370: `child.type?.name === 'blockContainer'`/`'blockGroup'` → update
- Line 408: `node.type.spec?.group === 'blockContent'` → `'block'`

**wrapBlockContentInContainer (line 13-15):**

```ts
// BEFORE:
schema.nodes['blockContainer']!.create(null, blockContentNode)
// AFTER:
schema.nodes['blockNode']!.create(null, blockContentNode)
```

**wrapBlockGroupInContainer (line 22-44):**

```ts
// Line 29: 'blockContainer' → 'blockNode'
// Line 31: 'blockContent' → 'block'
// Line 33: 'blockContainer' → 'blockNode'
// Line 40: 'blockContainer' → 'blockNode'
```

**splitBlockContainerNode (line 290-325):**

```ts
// Line 296: 'blockContent' → 'block'
// Line 298: 'blockGroup' → 'blockChildren'
```

**transformPasted plugin (line 223-270):**

```ts
// Line 232: 'blockContent' → 'block'
// Line 247: 'blockContainer' → 'blockNode'
// Line 248: 'blockGroup' → 'blockChildren'
```

### C2. `BlockContainer.ts` → `BlockNode.ts` (407 lines)

**Node definition (line 189-198):**

```ts
// BEFORE:
name: 'blockContainer',
group: 'blockGroupChild block',
content: 'blockContent blockGroup?',

// AFTER:
name: 'blockNode',
group: 'blockNodeChild block',
content: 'block blockChildren?',
```

**renderHTML (line 230-253):** CRITICAL CHANGE — currently renders TWO nested
divs:

```ts
// BEFORE (2 divs):
return [
  'div',
  mergeAttributes(HTMLAttributes, {
    class: `${styles.blockOuter}`,
    'data-node-type': 'block-outer',
  }),
  [
    'div',
    mergeAttributes(
      {
        ...domAttributes,
        class: mergeCSSClasses(styles.block, domAttributes.class),
        'data-node-type': this.name,
      },
      HTMLAttributes,
    ),
    0,
  ],
]

// AFTER (1 div):
return [
  'div',
  mergeAttributes(HTMLAttributes, {
    ...domAttributes,
    class: mergeCSSClasses(styles.blockNode, domAttributes.class),
    'data-node-type': this.name,
  }),
  0,
]
```

**parseHTML (line 200-228):** Line 221: `data-node-type === 'blockContainer'` →
`'blockNode'`

**BNCreateBlock command (line 262):**

```ts
// BEFORE:
state.schema.nodes['blockContainer'].createAndFill()!
// AFTER:
state.schema.nodes['blockNode'].createAndFill()!
```

**BNSplitHeadingBlock (line 289-369):**

- Line 303: `.sinkListItem('blockContainer')` → `.sinkListItem('blockNode')`
- Line 324: `state.schema.nodes['blockContainer'].createAndFill()!` →
  `'blockNode'`

**getNearestHeadingFromPos (line 150-174):**

- Line 160: `node.type.name === 'blockContainer'` → `'blockNode'`

### C3. `block.ts` — createTipTapBlock (line 277-281)

```ts
// BEFORE:
return Node.create<Options, Storage>({
  ...config,
  group: 'blockContent',
})

// AFTER:
return Node.create<Options, Storage>({
  ...config,
  group: 'block',
})
```

This affects ALL block content types (paragraph, heading, image, video, etc.)
since they all use `createTipTapBlock`.

### C4. `createBlockSpec` in `block.ts` (line 130-260)

The `addNodeView` function at line 168-253 creates a DOM element with class
`styles.blockContent`. After refactoring, the block content IS the top-level
element, so:

- Line 171-189: Remove the outer `blockContent` div wrapper. The `dom` returned
  by the block's render function becomes the top-level DOM.
- Line 183-185: `styles.blockContent` → need a replacement class or just use
  `data-content-type` for styling

The `render` function (line 86-126) also creates a `blockContent` div at
line 100. After refactoring, the element should directly be the content type
element.

### C5. `ReactBlockSpec.tsx` (line 89-206)

The React version of createBlockSpec. Same pattern:

- Line 170-191: `NodeViewWrapper` gets class `bnBlockStyles.blockContent` —
  change to appropriate class
- Line 178-179: `bnBlockStyles.blockContent` → remove or replace

### C6. `nodeConversions.ts` — blockToNode (line 143-204)

```ts
// Line 191 — BEFORE:
const groupNode = schema.nodes['blockGroup'].create({listType: 'Group'}, children)
// AFTER:
const groupNode = schema.nodes['blockChildren'].create({listType: 'Group'}, children)

// Line 197 — BEFORE:
return schema.nodes['blockContainer'].create({id, ...block.props}, ...)
// AFTER:
return schema.nodes['blockNode'].create({id, ...block.props}, ...)
```

### C7. `nodeConversions.ts` — nodeToBlock (line 393-489)

```ts
// Line 398 — BEFORE:
if (node.type.name !== 'blockContainer') {
  throw Error('Node must be of type blockContainer...')
}
// AFTER:
if (node.type.name !== 'blockNode') {
  throw Error('Node must be of type blockNode...')
}
```

The children iteration at line 468-476 reads `node.lastChild` (the
blockGroup/blockChildren) and `node.childCount === 2`. This stays the same since
the PM structure is unchanged (blockNode still has 1-2 children: block content +
optional blockChildren).

### C8. `nestBlock.ts` — liftListItem (line 17-156)

```ts
// Line 56: editor.chain().liftListItem('blockContainer') → 'blockNode'
// Line 110: state.schema.nodes['blockGroup'].create(...) → 'blockChildren'
// Line 127: state.schema.nodes['blockContainer'].create(...) → 'blockNode'
// Line 148: editor.commands.liftListItem('blockContainer') → 'blockNode'
// Line 168: node.type.name === 'blockGroup' → 'blockChildren'
```

### C9. `nestBlock.ts` — sinkListItem (line 158-222)

```ts
// Line 168: node.type.name === 'blockGroup' → 'blockChildren'
// (groupType is already passed in, no hardcoded string)
```

### C10. `nestBlock.ts` — nestBlock (line 224-237)

```ts
// Line 231: schema.nodes['blockContainer'] → 'blockNode'
// Line 232: schema.nodes['blockGroup'] → 'blockChildren'
```

### C11. `splitBlock.ts` (67 lines)

```ts
// Line 23: blockInfo.block.node.type.name !== 'blockContainer' → 'blockNode'
// The split depth 2 and types array at line 29-40 stays the same structurally,
// since blockNode (was blockContainer) + block content type is still 2 levels.
```

### C12. `updateGroup.ts` (258 lines)

```ts
// Line 94: .sinkListItem('blockContainer') → 'blockNode'
// Line 117: .sinkListItem('blockContainer') → 'blockNode'
// Line 125: group.type.name === 'blockGroup' → 'blockChildren'
// Line 190: childContainer.type.name === 'blockContainer' → 'blockNode'
// Line 200: childGroup.type.name === 'blockGroup' → 'blockChildren'
// Line 219: maybeContainer.type.name === 'blockContainer' → 'blockNode'
```

### C13. `getBlockInfoFromPos.ts` (222 lines)

```ts
// Line 133: node.type.spec.group === 'blockContent' → 'block'
// Line 143: node.type.name === 'blockGroup' → 'blockChildren'
// isInGroup('block') at lines 48, 60, 79 — ALREADY CORRECT (no change needed)
// Update JSDoc comments mentioning 'blockContainer' and 'blockContent'
```

### C14. `DraggableBlocksPlugin.ts` (743 lines)

```ts
// Line 160: doc.resolve(selection.from).node().type.spec.group === 'blockContent' → 'block'
// Line 162: doc.resolve(selection.to).node().type.spec.group === 'blockContent' → 'block'
// Line 567: hoveredBlock.getAttribute('data-node-type') === 'blockContainer' → 'blockNode'
```

### C15. `SideMenuPlugin.ts` (659 lines)

```ts
// Line 102: doc.resolve(selection.from).node().type.spec.group === 'blockContent' → 'block'
// Line 104: doc.resolve(selection.to).node().type.spec.group === 'blockContent' → 'block'
// Line 467: block.node?.getAttribute('data-node-type') == 'blockContainer' → 'blockNode'
```

### C16. `BlockNoteExtensions.ts` (130 lines)

```ts
// Line 22: import {BlockContainer, BlockGroup, Doc} from './extensions/Blocks'
//   → import {BlockNode, BlockChildren, Doc} from './extensions/Blocks'
// Line 73: UniqueID.configure({types: ['blockContainer']}) → 'blockNode'
// Line 105: BlockGroup.configure(...) → BlockChildren.configure(...)
// Line 121: BlockContainer.configure(...) → BlockNode.configure(...)
```

### C17. `ParagraphBlockContent.ts` (61 lines)

```ts
// BEFORE (line 32-58):
return [
  'div',
  mergeAttributes(
    {
      ...blockContentDOMAttributes,
      class: mergeCSSClasses(
        styles.blockContent,
        blockContentDOMAttributes.class,
      ),
      'data-content-type': this.name,
    },
    HTMLAttributes,
  ),
  [
    'p',
    {
      ...inlineContentDOMAttributes,
      class: mergeCSSClasses(
        styles.inlineContent,
        inlineContentDOMAttributes.class,
      ),
    },
    0,
  ],
]

// AFTER — single element:
return [
  'p',
  mergeAttributes(
    {
      ...blockContentDOMAttributes,
      ...inlineContentDOMAttributes,
      class: mergeCSSClasses(
        'block-paragraph',
        blockContentDOMAttributes.class,
        inlineContentDOMAttributes.class,
      ),
      'data-content-type': this.name,
    },
    HTMLAttributes,
  ),
  0,
]
```

### C18. `heading-component-plugin.tsx` (122 lines)

```ts
// BEFORE (line 93-111):
return [
  'div', mergeAttributes(HTMLAttributes, {
    class: `${styles.blockContent} block-heading`,
    'data-content-type': this.name,
  }),
  [`h${node.attrs.level}`, {
    class: `${styles.inlineContent} heading-content ${headingVariants(...)}`,
  }, 0],
]

// AFTER — single element:
return [
  `h${node.attrs.level}`, mergeAttributes(HTMLAttributes, {
    class: `block-heading heading-content ${headingVariants(...)}`,
    'data-content-type': this.name,
  }),
  0,
]
```

---

## Appendix D: CSS Selector Mapping

### Block.module.css — Key Selector Changes

| Old Selector                                    | New Selector                                      | Notes                                                        |
| ----------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `.blockOuter`                                   | `.blockNode`                                      | Was outer wrapper, now the single block div                  |
| `.block`                                        | (removed)                                         | Was inner wrapper, no longer exists                          |
| `.blockContent`                                 | `.blockContent` or `[data-content-type]`          | Keep class for common styles, OR move to data-attr selectors |
| `.blockGroup`                                   | `.blockChildren`                                  | Child container                                              |
| `.blockGroup .blockGroup`                       | `.blockChildren .blockChildren`                   | Nesting indent                                               |
| `.blockGroup .blockGroup > .blockOuter`         | `.blockChildren .blockChildren > .blockNode`      | Nested block positioning                                     |
| `.blockOuter > .block > .blockContent`          | `.blockNode > [data-content-type]`                | Since inner div removed                                      |
| `.blockGroup[data-list-type='X'] > .blockOuter` | `.blockChildren[data-list-type='X'] > .blockNode` | List item display                                            |

### Block.module.css — Heading depth cascade (lines 257-289)

```css
/* BEFORE: */
[data-node-type='blockGroup'] [data-content-type='heading'] {
  --level: 30px;
}
[data-node-type='blockGroup']
  [data-node-type='blockGroup']
  [data-content-type='heading'] {
  --level: 24px;
}
/* ... etc ... */

/* AFTER: */
[data-node-type='blockChildren'] [data-content-type='heading'] {
  --level: 30px;
}
[data-node-type='blockChildren']
  [data-node-type='blockChildren']
  [data-content-type='heading'] {
  --level: 24px;
}
/* ... etc ... */
```

### Block.module.css — Placeholder selectors (lines 465-575)

The placeholder styles use
`.blockContent.isEmpty.hasAnchor .inlineContent:before`. After refactoring:

- If we keep `.blockContent` class on the block content element → selectors stay
  similar
- If we remove `.blockContent` class → need
  `[data-content-type].isEmpty.hasAnchor:before`
- The `.inlineContent` nesting level goes away since there's no inner element

**Recommendation:** Keep a `.blockContent` class on all block content elements
for backwards-compatible placeholder styling. The class no longer corresponds to
a wrapper div, but it provides a stable hook for CSS.

### editor.css — Key changes

```css
/* BEFORE: */
[data-node-type='block-outer']::marker { ... }
ol > [data-node-type='block-outer']::marker { ... }
[data-list-type='Unordered'] .node-blockContainer { display: list-item; }
[data-list-type='Ordered'] .node-blockContainer { display: list-item; }

/* AFTER: */
[data-node-type='blockNode']::marker { ... }
ol > [data-node-type='blockNode']::marker { ... }
[data-list-type='Unordered'] .node-blockNode { display: list-item; }
[data-list-type='Ordered'] .node-blockNode { display: list-item; }
```

```css
/* BEFORE (heading margin rules, lines 537-551): */
[data-node-type='block-outer']:has(> [data-node-type='blockContainer'] > ...) { ... }

/* AFTER: */
[data-node-type='blockNode']:has(> [data-content-type='heading']) { ... }
/* Simpler since there's only one div level now */
```

### Safari list fix (Block.module.css lines 376-406)

```css
/* BEFORE: */
.blockGroup[data-list-type='Unordered'] > .blockOuter > .block > .blockContent { ... }
.blockGroup[data-list-type='Ordered'] > .blockOuter > .block > .blockContent { ... }

/* AFTER — fewer nesting levels: */
.blockChildren[data-list-type='Unordered'] > .blockNode > [data-content-type] { ... }
.blockChildren[data-list-type='Ordered'] > .blockNode > [data-content-type] { ... }
```

---

## Appendix E: DOM Structure Before & After

### Current DOM (simple paragraph):

```html
<div class="ProseMirror">
  <div class="blockGroup" data-node-type="blockGroup" data-list-type="Group">
    <div class="blockOuter" data-node-type="block-outer" data-id="abc123">
      <div class="block" data-node-type="blockContainer" data-id="abc123">
        <div class="blockContent" data-content-type="paragraph">
          <p class="inlineContent">Hello world</p>
        </div>
      </div>
    </div>
  </div>
</div>
```

**7 levels of nesting** (ProseMirror > blockGroup > blockOuter > block >
blockContent > p > text)

### Target DOM (same paragraph):

```html
<div class="ProseMirror">
  <div
    class="blockChildren"
    data-node-type="blockChildren"
    data-list-type="Group"
  >
    <div class="blockNode" data-node-type="blockNode" data-id="abc123">
      <p class="blockContent" data-content-type="paragraph">Hello world</p>
    </div>
  </div>
</div>
```

**4 levels of nesting** (ProseMirror > blockChildren > blockNode > p > text)

### Current DOM (nested unordered list):

```html
<div class="ProseMirror">
  <div class="blockGroup" data-node-type="blockGroup" data-list-type="Group">
    <div class="blockOuter" data-node-type="block-outer" data-id="abc">
      <div class="block" data-node-type="blockContainer" data-id="abc">
        <div class="blockContent" data-content-type="paragraph">
          <p class="inlineContent">Parent</p>
        </div>
        <ul
          class="blockGroup"
          data-node-type="blockGroup"
          data-list-type="Unordered"
        >
          <div class="blockOuter" data-node-type="block-outer" data-id="def">
            <div class="block" data-node-type="blockContainer" data-id="def">
              <div class="blockContent" data-content-type="paragraph">
                <p class="inlineContent">Child item</p>
              </div>
            </div>
          </div>
        </ul>
      </div>
    </div>
  </div>
</div>
```

### Target DOM (same nested list):

```html
<div class="ProseMirror">
  <div
    class="blockChildren"
    data-node-type="blockChildren"
    data-list-type="Group"
  >
    <div class="blockNode" data-node-type="blockNode" data-id="abc">
      <p class="blockContent" data-content-type="paragraph">Parent</p>
      <ul
        class="blockChildren"
        data-node-type="blockChildren"
        data-list-type="Unordered"
      >
        <div class="blockNode" data-node-type="blockNode" data-id="def">
          <p class="blockContent" data-content-type="paragraph">Child item</p>
        </div>
      </ul>
    </div>
  </div>
</div>
```

---

## Appendix F: Position Arithmetic Unchanged

The PM doc structure stays at the same depth. Example for a simple paragraph:

```
doc(0)
  blockChildren(1)     // was blockGroup — depth 1
    blockNode(2)       // was blockContainer — depth 2
      paragraph(3)     // was paragraph — depth 3
        "text"(4)      // inline content — depth 4
      /paragraph(3+n)
    /blockNode
  /blockChildren
/doc
```

Position offsets like `block.beforePos + 2` (to reach inside the block content
node) remain correct because the relative depth between blockNode and its first
child (the block content) is still 1.

The `split(posInBlock, 2, types)` call in `splitBlock.ts` stays depth 2 because
it splits through blockNode + block content type — same as before.

The `level: Math.ceil((maxDepth - 1) / 2)` calculation in
`getGroupInfoFromPos.ts` remains correct since each nesting level still adds 2
to the PM depth (blockChildren + blockNode = 2 levels per nesting).

---

## Appendix G: Implementation Order

Recommended order to minimize confusion:

1. **Rename files first** (git mv):

   - `BlockGroup.ts` → `BlockChildren.ts`
   - `BlockContainer.ts` → `BlockNode.ts`

2. **Core definitions** (these define the schema):

   - `BlockChildren.ts`: name, group, content, renderHTML, parseHTML
   - `BlockNode.ts`: name, group, content, renderHTML, parseHTML
   - `block.ts`: group change to `'block'`
   - `Blocks/index.ts`: Doc content, exports

3. **Block content rendering** (depends on step 2):

   - `ParagraphBlockContent.ts`
   - `heading-component-plugin.tsx`
   - `code-block.ts`
   - `block.ts` createBlockSpec render/addNodeView
   - `ReactBlockSpec.tsx`

4. **Helpers** (used by everything below):

   - `getBlockInfoFromPos.ts`
   - `getGroupInfoFromPos.ts`
   - `findBlock.ts`

5. **Commands** (depend on helpers):

   - `nestBlock.ts`, `splitBlock.ts`, `mergeBlocks.ts`, `updateBlock.ts`
   - `updateGroup.ts`, `replaceBlocks.ts`, `insertBlocks.ts`
   - `blockManipulation.ts`, `nodeConversions.ts`

6. **Extensions** (depend on commands):

   - `BlockNoteExtensions.ts`, `BlockNoteEditor.ts`
   - `TrailingNodeExtension.ts`, `KeyboardShortcutsExtension.ts`
   - `DraggableBlocksPlugin.ts`, `SideMenuPlugin.ts`
   - `BlockManipulationExtension.ts`
   - `MarkdownExtension.ts`, `MarkdownToBlocks.ts`
   - `simplifyBlocksRehypePlugin.ts`

7. **Other editor files**:

   - `block-utils.ts`, `utils.ts`, `pasteHandler.ts`, `hm-link-preview.tsx`

8. **CSS** (do last, test visually):

   - `Block.module.css`
   - `editor.css`

9. **Desktop app files**:

   - `editor-utils.ts`, `documents.ts`

10. **Verify**: `pnpm typecheck && pnpm format:write`
