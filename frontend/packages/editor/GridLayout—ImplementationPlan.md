---
title: Grid Layout — Implementation Plan
icon:
cover_image:
created_at: 2026-03-09T20:42:01.716Z
path: /projects/column-layouts-in-the-editor/grid-layout-implementation-plan
---

Context

Documents are trees of `BlockNode { block, children }`. Blocks stack vertically — no way to flow items into a
multi-column grid. The Query block has a `columnCount` attribute with CSS grid rendering in `DocumentCardGrid`, but this
only applies to query results (document cards), not arbitrary block content.

We want a **Flow Grid** layout: items wrap into N columns automatically. Column count is defined by an attribute, and
items stack/wrap when there are more items than columns. Think Pinterest / card grid / the Query block's card view — but
for any block type.

Why `childrenType` and not dedicated block types?

Our editor is forked from an old BlockNote. The ProseMirror schema enforces `blockNode → block blockChildren?` — `block`
nodes can only contain `inline*` or `''`. Adding custom PM nodes outside this hierarchy (like Notion's
`column_list`/`column` or BlockNote v0.19's `@blocknote/xl-multi-column`) requires refactoring 15-20+ editor files. The
`childrenType` approach produces the same tree shape but fits within the existing schema.

Data Model

```plaintext
BlockNode {
  block: {
    id: "grid-1",
    type: "Paragraph",
    text: "",
    attributes: { childrenType: "Grid", columnCount: 3 }
  }
  children: [
    BlockNode { block: { id: "item-1", type: "Image", ... } }
    BlockNode { block: { id: "item-2", type: "Image", ... } }
    BlockNode { block: { id: "item-3", type: "Image", ... } }
    BlockNode { block: { id: "item-4", type: "Image", ... } }   <- wraps to row 2
  ]
}
```

ProseMirror tree:

```plaintext
blockNode (container)
  block:paragraph ("")                    <- empty, invisible
  blockChildren [listType='Grid']         <- CSS grid
    blockNode -> block:image (...)
    blockNode -> block:image (...)
    blockNode -> block:image (...)
    blockNode -> block:image (...)        <- wraps to row 2
```

Attributes on container block:

- `columnCount: number` (1-4, default 3) — max columns before wrapping
- `gap: number` (optional, px, default from layout unit)

CRDT Behavior

Uses existing parent-child tree mechanics — no changes needed:

- Grid items are children in the container's RGA sublist
- Concurrent adds: both items appear, ordered by opID
- Reordering: standard OpMoveBlocks

Implementation Steps Step 1: Types & Schema

`frontend/packages/shared/src/hm-types.ts` (line 42-44)

```ts
// Before:
z.union([z.literal('Group'), z.literal('Ordered'), z.literal('Unordered'), z.literal('Blockquote')])

// After:
z.union([z.literal('Group'), z.literal('Ordered'), z.literal('Unordered'), z.literal('Blockquote'), z.literal('Grid')])
```

`frontend/packages/editor/src/blocknote/core/extensions/Blocks/api/defaultBlocks.ts` (line 14-17)

```ts
// Add 'Grid' to childrenType values
childrenType: {
  default: 'Group',
  values: ['Group', 'Unordered', 'Ordered', 'Blockquote', 'Grid'],
}
```

Step 2: Block Conversion

`frontend/packages/shared/src/client/hmblock-to-editorblock.ts`

- In `hmBlocksToEditorContent()` where `childrenType` is validated/read: accept `'Grid'` as valid value

`frontend/packages/shared/src/client/editorblock-to-hmblock.ts`

- In `editorBlockToHMBlock()` where `childrenType` is written to attributes: pass through `'Grid'`
- Ensure `columnCount` attribute is preserved in conversion

Step 3: Editor — BlockChildren Rendering

`frontend/packages/editor/src/blocknote/core/extensions/Blocks/nodes/BlockChildren.ts`

- `listNode()` (line 228-238): Add case for `'Grid'` — render as``

  with CSS grid classes

- `addInputRules()`: Add guard so list input rules (`- `, `1. `, `> `) don't trigger inside Grid containers

Step 4: Editor — Keyboard Guards

`frontend/packages/editor/src/blocknote/core/extensions/KeyboardShortcuts/KeyboardShortcutsExtension.ts`

Add utility: `isInGridContainer(state, pos) -> boolean` — checks if current block's parent `blockChildren` has
`listType='Grid'`.

\| Handler | Guard | | ------------------- | -------------------------------------- | | `handleTab` (\~541) | Prevent
indent when parent is Grid | | `Shift-Tab` (\~621) | Prevent outdent of grid children |

Note: Enter, Backspace, Delete work normally inside a Grid — items are flat siblings, no cross-boundary issues.

Step 5: Editor — Block Manipulation Commands

`frontend/packages/editor/src/blocknote/core/api/blockManipulation/commands/nestBlock.ts`

- `sinkListItem()` / `canNestBlock()`: Return false if parent is Grid (prevent indenting grid items)
- `liftListItem()` / `canUnnestBlock()`: Return false if block's parent group is Grid

Step 6: Editor — Slash Menu

`frontend/packages/editor/src/slash-menu-items.tsx`

Add slash menu item:

```ts
{
  name: 'Grid',
  aliases: ['gallery', 'cards', 'grid'],
  group: 'Layout',
  icon: GridIcon,
  execute: (editor) => {
    // 1. Replace current block with empty block, set childrenType: 'Grid', columnCount: 3
    // 2. Create 3 empty paragraph child blocks
    // 3. Place cursor in first child
  }
}
```

Step 7: Editor — Grid Settings UI

Create a toolbar/popover on the Grid container block that allows:

- Column count selector (1, 2, 3, 4) — updates `columnCount` attribute
- Reuse the pattern from the Query block's column count selector in `frontend/apps/desktop/src/editor/query-block.tsx`

Step 8: Read-Only Rendering

`frontend/packages/ui/src/blocks-content.tsx` — `BlockNodeList` (line 464):

```tsx
if (childrenType === 'Grid') {
  return {children}
}
```

Helper function:

```ts
function gridColumnClass(count: number): string {
  switch (count) {
    case 1:
      return 'grid-cols-1'
    case 2:
      return 'grid-cols-1 sm:grid-cols-2'
    case 3:
      return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
    case 4:
      return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
    default:
      return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
  }
}
```

`BlockNodeContent`: When inside a Grid, each child renders normally (no list markers). The empty container paragraph is
hidden.

Step 9: Responsive Behavior

Tailwind responsive prefixes handle column reduction automatically:

- Mobile: 1 column
- Tablet (sm): 2 columns
- Desktop (md/lg): full `columnCount`

Testing Unit Tests — Block Conversion

`frontend/packages/shared/src/client/__tests__/hmblock-to-editorblock.test.ts`

Add to existing `describe('childrenType')` block (follows pattern of Group/Unordered/Ordered tests):

```ts
test('Grid', () => {
  const hmBlock: HMBlock = {
    id: 'foo',
    type: 'Paragraph',
    text: '',
    annotations: [],
    attributes: {childrenType: 'Grid', columnCount: 3},
    revision: 'revision123',
  }
  const val = hmBlockToEditorBlock(hmBlock)
  expect(val.props.childrenType).toBe('Grid')
})

test('Grid with children preserves structure', () => {
  const blocks: HMBlockNode[] = [
    {
      block: {
        id: 'grid-1',
        type: 'Paragraph',
        text: '',
        annotations: [],
        attributes: {childrenType: 'Grid', columnCount: 2},
      },
      children: [
        {
          block: {
            id: 'item-1',
            type: 'Paragraph',
            text: 'Item 1',
            annotations: [],
            attributes: {},
          },
          children: [],
        },
        {
          block: {
            id: 'item-2',
            type: 'Paragraph',
            text: 'Item 2',
            annotations: [],
            attributes: {},
          },
          children: [],
        },
      ],
    },
  ]
  const result = hmBlocksToEditorContent(blocks)
  expect(result[0].props.childrenType).toBe('Grid')
  expect(result[0].children).toHaveLength(2)
})
```

`frontend/packages/shared/src/client/__tests__/editorblock-to-hmblock.test.ts`

Add to existing `describe('childrenType')` block:

```ts
test('Grid', () => {
  const editorBlock: EditorBlock = {
    id: 'foo',
    type: 'paragraph',
    children: [],
    props: {childrenType: 'Grid'},
    content: [{type: 'text', text: '', styles: {}}],
  }
  const val = editorBlockToHMBlock(editorBlock)
  expect(val.attributes.childrenType).toBe('Grid')
})
```

Unit Tests — Editor Commands

`frontend/packages/editor/src/blocknote/core/api/blockManipulation/__tests__/nestBlock.test.ts`

Add test using existing `buildDoc`/`createMockEditor` helpers:

```ts
describe('Grid container', () => {
  it('prevents nesting inside Grid', () => {
    const doc = buildDoc(schema, [
      {
        id: 'grid',
        text: '',
        children: {
          listType: 'Grid',
          blocks: [
            {id: 'item-1', text: 'Item 1'},
            {id: 'item-2', text: 'Item 2'},
          ],
        },
      },
    ])
    const state = EditorState.create({doc, schema})
    const editor = createMockEditor(state)
    const pos = findPosInBlock(doc, 'item-2')
    // Tab should NOT indent item-2 inside a Grid
    const result = nestBlock(editor, pos)
    expect(result).toBe(false)
  })
})
```

Unit Tests — Type Schema Validation

`frontend/packages/shared/src/__tests__/hm-types.test.ts` (add to existing or create):

```ts
import {HMBlockChildrenTypeSchema} from '../hm-types'

describe('HMBlockChildrenType', () => {
  test('accepts Grid', () => {
    expect(HMBlockChildrenTypeSchema.parse('Grid')).toBe('Grid')
  })

  test('rejects invalid values', () => {
    expect(() => HMBlockChildrenTypeSchema.parse('InvalidType')).toThrow()
  })
})
```

Pre-Completion Checks

Run these before marking the task as done:

```bash
# Format all code
pnpm format:write

# Type check everything
pnpm typecheck

# Run shared package tests (block conversion)
pnpm --filter @shm/shared test

# Run editor package tests (block manipulation)
pnpm --filter @shm/editor test

# Run all tests
pnpm test
```

All must pass with zero failures.

Backwards Compatibility

- Old clients: `'Grid'` falls through to default``

  - in
  - `BlockNodeList`
  - — content visible, stacked vertically as a plain list
  - No proto changes needed (attributes are open Struct)
  - No CRDT changes needed
