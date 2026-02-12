# Editor Technical Specification (main branch)

This document describes the ProseMirror-based editor architecture as it exists
on the `main` branch. Use this as context when working on editor features.

## Overview

The editor is built on **TipTap** (a wrapper around ProseMirror) and uses a
**BlockNote**-derived architecture. Every document is a tree of "blocks" — each
block has an ID, a content type (paragraph, heading, image, etc.), optional
children, and belongs to a group (list, blockquote, or plain group).

Key packages:

- `frontend/packages/editor/src/blocknote/core/` — schema, commands, helpers
- `frontend/packages/editor/src/` — custom block types, plugins, CSS

---

## ProseMirror Schema

### Node Hierarchy

```
doc
  blockGroup (listType='Group')
    blockContainer (id=...)
      blockContent (paragraph | heading | image | ...)
      blockGroup? (listType='Group'|'Ordered'|'Unordered'|'Blockquote')
        blockContainer (id=...)
          ...
```

### Node Definitions

| Node             | PM name          | group                   | content                    |
| ---------------- | ---------------- | ----------------------- | -------------------------- |
| Doc              | `doc`            | (topNode)               | `blockGroup`               |
| BlockContainer   | `blockContainer` | `blockGroupChild block` | `blockContent blockGroup?` |
| BlockGroup       | `blockGroup`     | `childContainer`        | `blockGroupChild+`         |
| Paragraph        | `paragraph`      | `blockContent`          | `inline*`                  |
| Heading          | `heading`        | `blockContent`          | `inline*`                  |
| Code Block       | `code-block`     | `blockContent`          | `inline*` (marks: none)    |
| Image            | `image`          | `blockContent`          | `inline*`                  |
| File/Embed/Video | various          | `blockContent`          | varies                     |

### Key Files

| File                                        | Purpose                                |
| ------------------------------------------- | -------------------------------------- |
| `extensions/Blocks/index.ts`                | Doc node, exports                      |
| `extensions/Blocks/nodes/BlockContainer.ts` | Main block wrapper node                |
| `extensions/Blocks/nodes/BlockGroup.ts`     | Block children/list node               |
| `extensions/Blocks/api/block.ts`            | `createTipTapBlock`, `createBlockSpec` |
| `extensions/Blocks/api/blockTypes.ts`       | TypeScript type definitions            |

All paths are relative to `frontend/packages/editor/src/blocknote/core/`.

---

## Doc Node

```ts
// extensions/Blocks/index.ts
export const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'blockGroup',
})
```

The document has exactly one child: a `blockGroup` node.

---

## BlockContainer

**File:** `extensions/Blocks/nodes/BlockContainer.ts`

```ts
export const BlockContainer = Node.create({
  name: 'blockContainer',
  group: 'blockGroupChild block',
  content: 'blockContent blockGroup?',
  priority: 50,
  defining: true,
})
```

- **group `blockGroupChild`** — used as content of `blockGroup`
- **group `block`** — used by helpers like `getNearestBlockPos` with
  `isInGroup('block')`
- **content** — exactly one content node from group `blockContent`, optionally
  followed by a `blockGroup`
- **Attributes:** `id`, `blockColor`, `blockStyle`, `depth`, `depthChange`
  (defined in `BlockAttributes.ts`)

### parseHTML

Matches `<li>` (priority 300) and `<div data-node-type="blockContainer">`
(priority 200).

### renderHTML — Two Nested Divs

```ts
renderHTML({HTMLAttributes}) {
  return [
    'div',
    mergeAttributes(HTMLAttributes, {
      class: styles.blockOuter,
      'data-node-type': 'block-outer',
    }),
    [
      'div',
      mergeAttributes({
        class: styles.block,
        'data-node-type': 'blockContainer',
      }, HTMLAttributes),
      0,   // ← ProseMirror content hole
    ],
  ]
}
```

Produces:

```html
<div class="blockOuter" data-node-type="block-outer">
  <div class="block" data-node-type="blockContainer" data-id="abc123">
    <!-- content + optional blockGroup rendered here -->
  </div>
</div>
```

### ProseMirror Plugins

Defined inline in `BlockContainer.ts`:

- **SelectionPlugin** — manages selection decorations
- **ClickSelectionPlugin** — handles shift+click range selection
- **PastePlugin** — handles paste into image caption
- **headingBoxPlugin** — adds `selection-in-section` class to blockContainer
  containing nearest heading when cursor is in its subtree
- **Em-dash plugin** — replaces `--` with `—`

---

## BlockGroup

**File:** `extensions/Blocks/nodes/BlockGroup.ts`

```ts
export const BlockGroup = Node.create({
  name: 'blockGroup',
  group: 'childContainer',
  content: 'blockGroupChild+',
})
```

- **Attributes:** `listType` (default `'Group'`), `listLevel` (default `'1'`)
- `listType` values: `'Group' | 'Ordered' | 'Unordered' | 'Blockquote'`

### renderHTML — Dynamic Tag

```ts
renderHTML({node, HTMLAttributes}) {
  return [
    listNode(node.attrs.listType), // 'ul' | 'ol' | 'blockquote' | 'div'
    mergeAttributes({
      class: styles.blockGroup,
      'data-node-type': 'blockGroup',
    }, HTMLAttributes),
    0,
  ]
}

function listNode(listType) {
  if (listType == 'Unordered') return 'ul'
  if (listType == 'Ordered')   return 'ol'
  if (listType == 'Blockquote') return 'blockquote'
  return 'div'
}
```

### Paste Normalization

`BlockGroup.ts` contains extensive paste normalization logic:

- `wrapBlockContentInContainer(node, schema)` — wraps a bare content node in a
  blockContainer
- `wrapBlockGroupInContainer(groupNode, schema, prevNode)` — wraps a bare
  blockGroup in a blockContainer, merging with previous if possible
- `normalizeFragment(fragment, schema)` — ensures all children of a blockGroup
  are valid blockContainers
- `splitBlockContainerNode(node, schema)` — splits a blockContainer that has
  multiple content children
- `normalizeBlockContainer(node, schema)` — ensures a blockContainer has exactly
  one content child + optional blockGroup
- `transformPasted` plugin processes all pasted content through these
  normalizers

---

## Content Blocks (group: blockContent)

### createTipTapBlock

```ts
// extensions/Blocks/api/block.ts
export function createTipTapBlock<Type extends string>(config) {
  return Node.create({
    ...config,
    group: 'blockContent', // always forced
  })
}
```

### createBlockSpec — NodeView with Wrapper

```ts
export function createBlockSpec(blockConfig, blockSchema) {
  return {
    node: createTipTapBlock({
      name: blockConfig.type,
      content: blockConfig.containsInlineContent ? 'inline*' : '',
      // ...
      addNodeView() {
        return ({HTMLAttributes, getPos}) => {
          const rendered = blockConfig.render(block, editor)

          // WRAPPER DIV around the block's rendered content
          const blockContent = document.createElement('div')
          blockContent.className = mergeCSSClasses(
            styles.blockContent,
            blockConfig.type,
          )
          blockContent.setAttribute('data-content-type', blockConfig.type)
          blockContent.appendChild(rendered.dom)

          return {
            dom: blockContent, // wrapper div IS the outer element
            contentDOM: rendered.contentDOM,
          }
        }
      },
    }),
    propSchema: blockConfig.propSchema,
  }
}
```

Each content block gets wrapped in a
`<div class="blockContent" data-content-type="...">` by the NodeView.

### Paragraph

```ts
// extensions/Blocks/nodes/BlockContent/ParagraphBlockContent/ParagraphBlockContent.ts
export const ParagraphBlockContent = createTipTapBlock<'paragraph'>({
  name: 'paragraph',
  content: 'inline*',
  parseHTML() { return [{ tag: 'p', ... }] },
  renderHTML() {
    return ['p', mergeAttributes({ class: 'block-paragraph ...' }), 0]
  },
})
```

### Heading

```ts
// heading-component-plugin.tsx
export const HMHeadingBlockContent = createTipTapBlock<'heading'>({
  name: 'heading',
  content: 'inline*',
  // Attribute: level (default '2')
  renderHTML({node}) {
    return [`h${node.attrs.level}`, {class: 'block-heading ...'}, 0]
  },
})
```

### Code Block

```ts
// tiptap-extension-code-block/code-block.ts
export const CodeBlock = Node.create({
  name: 'code-block',
  content: 'inline*',
  marks: '',
  group: 'blockContent',
  code: true,
  defining: true,
})
```

---

## Resulting DOM Structure

```html
<!-- Document -->
<div data-node-type="blockGroup" data-list-type="Group">
  <!-- A heading block with children -->
  <div class="blockOuter" data-node-type="block-outer">
    <div class="block" data-node-type="blockContainer" data-id="abc">
      <div class="blockContent" data-content-type="heading">
        <h2 class="block-heading">My Heading</h2>
      </div>
      <div data-node-type="blockGroup" data-list-type="Group">
        <!-- child blocks... -->
      </div>
    </div>
  </div>

  <!-- An ordered list -->
  <div class="blockOuter" data-node-type="block-outer">
    <div class="block" data-node-type="blockContainer" data-id="def">
      <div class="blockContent" data-content-type="paragraph">
        <p class="block-paragraph">Parent item</p>
      </div>
      <ol data-node-type="blockGroup" data-list-type="Ordered">
        <div class="blockOuter" data-node-type="block-outer">
          <div class="block" data-node-type="blockContainer" data-id="ghi">
            <div class="blockContent" data-content-type="paragraph">
              <p class="block-paragraph">List item 1</p>
            </div>
          </div>
        </div>
      </ol>
    </div>
  </div>
</div>
```

**DOM depth per block:** ~7 levels (blockGroup > blockOuter > block >
blockContent > element > inlineContent > text)

Note: `<div>` elements inside `<ol>`/`<ul>` use `display: list-item !important`
via CSS.

---

## Group Checks — isInGroup

| Check                                     | Matches                      | Used For                                                                                        |
| ----------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `isInGroup('block')`                      | `blockContainer` only        | Finding block wrappers in `getNearestBlockPos`, `getBlockInfoWithManualOffset`, `replaceBlocks` |
| `isInGroup('blockContent')`               | `paragraph`, `heading`, etc. | Identifying content nodes in `updateBlock`                                                      |
| `isInGroup('blockGroupChild')`            | `blockContainer` only        | Not commonly used directly                                                                      |
| `node.type.name === 'blockGroup'`         | `blockGroup` only            | Identifying child containers                                                                    |
| `node.type.spec.group === 'blockContent'` | Content nodes (exact match)  | Finding content inside blockContainer children                                                  |

---

## Block Info Helpers

### getBlockInfoFromPos

**File:** `extensions/Blocks/helpers/getBlockInfoFromPos.ts`

```ts
export type BlockInfo = {
  block: SingleBlockInfo // The blockContainer node (has the ID)
  blockContentType: string // 'paragraph', 'heading', etc.
  childContainer?: SingleBlockInfo // The blockGroup, if it exists
  blockContent: SingleBlockInfo // The content node
}
```

**`getNearestBlockPos(doc, pos)`** — walks up the tree using
`isInGroup('block')` to find the nearest blockContainer.

**`getBlockInfoWithManualOffset(node, offset)`** — iterates blockContainer
children:

- Child with `spec.group === 'blockContent'` → blockContent
- Child with `type.name === 'blockGroup'` → childContainer

### getGroupInfoFromPos

**File:** `extensions/Blocks/helpers/getGroupInfoFromPos.ts`

```ts
export type GroupInfo = {
  group: Node // The blockGroup node
  container?: Node // The blockContainer at this position
  depth: number
  level: number // Math.ceil((maxDepth - 1) / 2)
  $pos: ResolvedPos
}
```

### findBlock

```ts
export const findBlock = findParentNode(
  (node) => node.type.name === 'blockContainer',
)
```

---

## Block Manipulation Commands

All in `api/blockManipulation/commands/`.

### splitBlock

Splits at cursor using `tr.split(pos, 2, types)`:

```ts
const types = [
  { type: blockContainerType, attrs: { ...attrs, id: undefined } },
  { type: keepType ? contentType : paragraphType, attrs: ... },
]
```

### nestBlock / unnestBlock

- `nestBlock` — custom `sinkListItem` using `ReplaceAroundStep` to wrap block in
  `blockContainer > blockGroup`
- `unnestBlock` — custom `liftListItem` that handles sibling blocks
- `canNestBlock` / `canUnnestBlock` — checks for preceding sibling / depth > 1

### updateBlock

1. `updateChildren(block, state, blockInfo)` — replaces or creates blockGroup
2. `updateBlockContentNode(...)` — uses `setNodeMarkup` or `replaceWith`
3. Sets blockContainer attributes:
   `tr.setNodeMarkup(pos, type, {...attrs, ...props})`

Uses `isInGroup('block')` to detect if newNodeType is a blockContainer type, and
`isInGroup('blockContent')` for content types.

### updateGroup

Changes `listType` on a blockGroup node. Handles type conversion (Group ↔
Ordered ↔ Unordered ↔ Blockquote) and updates child `listLevel` attributes.

### replaceBlocks

Traverses document finding blocks by ID using `isInGroup('block')`, inserts
replacements, deletes originals.

---

## Node Conversions (HMBlock ↔ ProseMirror)

**File:** `api/nodeConversions/nodeConversions.ts`

### blockToNode (HMBlock → PM Node)

```ts
function blockToNode(block, schema) {
  const contentNode = schema.nodes[type].create(props, inlineContent)
  const children = block.children.map((child) => blockToNode(child, schema))
  const groupNode = schema.nodes['blockGroup'].create(
    {listType: 'Group'},
    children,
  )
  return schema.nodes['blockContainer'].create(
    {id, ...props},
    children.length > 0 ? [contentNode, groupNode] : contentNode,
  )
}
```

### nodeToBlock (PM Node → HMBlock)

```ts
function nodeToBlock(node, schema, cache) {
  // node.type.name === 'blockContainer'
  const type = node.firstChild!.type.name     // content type
  const props = { ...node.attrs, ...node.firstChild!.attrs }
  const content = contentNodeToInlineContent(node.firstChild!)
  const children = node.childCount === 2
    ? [...node.lastChild.content].map(child => nodeToBlock(child, ...))
    : []
  return { id, type, props, content, children }
}
```

---

## Format Conversions

### simplifyBlocksRehypePlugin

**File:** `api/formatConversions/simplifyBlocksRehypePlugin.ts`

Converts BlockNote internal HTML → standard HTML for clipboard/export:

- Removes `blockOuter` wrapper: walks
  `blockOuter > blockContainer > blockContent`
- Extracts the semantic element from inside `blockContent`
- Wraps list items in proper `<ul>`/`<ol>` elements
- Lifts nested blockGroups for non-list types

---

## Extensions Registration

**File:** `BlockNoteExtensions.ts`

```ts
function getBlockNoteExtensions(opts) {
  return [
    // Core
    ClipboardTextSerializer,
    Commands,
    Editable,
    FocusEvents,
    Tabindex,
    Gapcursor,
    Placeholder,
    UniqueID.configure({types: ['blockContainer']}),
    Text,
    Markdown,
    BlockManipulationExtension,
    KeyboardShortcuts,
    // Marks
    Bold,
    Code,
    Italic,
    Strike,
    Underline,
    Link,
    // Structure
    Doc,
    BlockGroup.configure({domAttributes}),
    ...blockSpecs, // all content block types from schema
    CustomBlockSerializerExtension,
    Dropcursor,
    HardBreak,
    TrailingNode,
    BlockContainer.configure({domAttributes}),
    // Debug/History
    debugPlugin,
    History,
  ]
}
```

---

## CSS Architecture

### Block.module.css (CSS Modules)

Key classes:

- `.blockOuter` — outer wrapper, no display set (defaults to `block`); becomes
  `display: list-item` in lists
- `.block` — inner wrapper with
  `display: flex; flex-direction: column; position: relative`
- `.blockContent` — `padding: 12px 0 3px 0; flex-grow: 1`
- `.blockGroup .blockGroup` — `margin-left: 1.5em` (nesting indent)
- `.inlineContent` — `font-size: 0.9em`

List rendering:

```css
.blockGroup[data-list-type='Unordered'] > .blockOuter {
  display: list-item !important;
}
.blockGroup[data-list-type='Ordered'] > .blockOuter {
  display: list-item !important;
}
.blockGroup[data-list-type='Unordered'] {
  list-style-type: disc;
}
.blockGroup[data-list-type='Ordered'] {
  list-style-type: decimal;
}
.blockGroup[data-list-type='Blockquote'] {
  border-left: 3px solid var(--border);
}
```

Heading sizes via nesting depth:

```css
[data-node-type='blockGroup'] [data-content-type='heading'] {
  --level: 30px;
}
[data-node-type='blockGroup']
  [data-node-type='blockGroup']
  [data-content-type='heading'] {
  --level: 24px;
}
/* ...deeper nesting = smaller */
```

Placeholders:

```css
.blockContent.isEmpty.hasAnchor:before {
  content: "Enter text or type '/' for commands";
}
.blockContent[data-content-type='heading'].isEmpty.hasAnchor:before {
  content: 'Heading';
}
```

### editor.css (Global)

- `.selection-in-section::before` — heading section highlight background
- `[data-node-type='block-outer']` selectors for marker styling and heading
  margins
- `.block-heading + [data-node-type='blockGroup']` — removes extra margin for
  group children of headings

---

## headingBoxPlugin

Decorates the blockContainer that contains the nearest heading when cursor is in
its subtree:

```ts
function getHeadingDecorations(state) {
  const res = getNearestHeadingFromPos(state, state.selection.from)
  if (res?.heading?.type.name === 'heading') {
    Decoration.node(from - 1, to - 1, {class: 'selection-in-section'})
  }
}

function getNearestHeadingFromPos(state, pos) {
  // Walk up tree, find blockContainer with heading as firstChild
  for (let depth = maxDepth; depth >= 0; depth--) {
    if (
      node.type.name === 'blockContainer' &&
      node.firstChild?.type.name === 'heading'
    ) {
      return {depth, groupStartPos, heading, group: node, $pos}
    }
  }
}
```

---

## Position Arithmetic

ProseMirror positions for a blockContainer at depth `d`:

```
$pos.before(d)     = position before blockContainer's opening token
$pos.start(d)      = position after opening token (first content position)
$pos.end(d)        = position before closing token
$pos.after(d)      = position after blockContainer's closing token
node.nodeSize       = total size including open/close tokens
```

For blockContainer content:

```
blockContainer [+1] blockContent [+1] ... [-1] blockGroup? [+1] ... [-1] [-1]
│                   │                           │                            │
before(d)           start(d)                    blockGroup start             after(d)
```

Offsets used in commands:

- `block.beforePos + 1` = start of blockContainer content
- `block.beforePos + 2` = start of blockContent's inline content
- `blockContent.afterPos` = end of content node
- `block.afterPos - 1` = before blockContainer's close token
