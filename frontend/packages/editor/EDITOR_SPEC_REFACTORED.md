# Editor Technical Specification (editor-refactor-plan branch)

This document describes the ProseMirror-based editor architecture after the
schema refactoring on the `editor-refactor-plan` branch. Use this as context
when working on editor features.

For the pre-refactoring spec, see `EDITOR_SPEC_MAIN.md`.

## What Changed (Summary)

| Aspect                   | Before (main)                     | After (refactored)          |
| ------------------------ | --------------------------------- | --------------------------- |
| Block wrapper node       | `blockContainer`                  | `blockNode`                 |
| Children node            | `blockGroup`                      | `blockChildren`             |
| Content group            | `blockContent`                    | `block`                     |
| Container group          | `blockGroupChild`                 | `blockNodeChild`            |
| DOM depth per block      | ~7 levels                         | ~4 levels                   |
| blockContent wrapper div | Yes (in createBlockSpec NodeView) | No (removed)                |
| blockOuter wrapper div   | Yes (in renderHTML)               | No (removed)                |
| List items               | `<div>` with `display: list-item` | `<li>` via NodeView         |
| Doc content              | `blockGroup`                      | `blockChildren`             |
| File: BlockContainer.ts  | exists                            | renamed to BlockNode.ts     |
| File: BlockGroup.ts      | exists                            | renamed to BlockChildren.ts |

**HMBlock server format is unchanged.** The refactoring only affects the
ProseMirror schema and DOM output.

---

## ProseMirror Schema

### Node Hierarchy

```
doc
  blockChildren (listType='Group')
    blockNode (id=...)
      paragraph | heading | ... (content, group='block')
      blockChildren? (listType='Group'|'Ordered'|'Unordered'|'Blockquote')
        blockNode (id=...)
          ...
```

### Node Definitions

| Node             | PM name         | group                  | content                 |
| ---------------- | --------------- | ---------------------- | ----------------------- |
| Doc              | `doc`           | (topNode)              | `blockChildren`         |
| BlockNode        | `blockNode`     | `blockNodeChild block` | `block blockChildren?`  |
| BlockChildren    | `blockChildren` | `childContainer`       | `blockNodeChild+`       |
| Paragraph        | `paragraph`     | `block`                | `inline*`               |
| Heading          | `heading`       | `block`                | `inline*`               |
| Code Block       | `code-block`    | `block`                | `inline*` (marks: none) |
| Image            | `image`         | `block`                | `inline*`               |
| File/Embed/Video | various         | `block`                | varies                  |

### Key Files

| File                                       | Purpose                                               |
| ------------------------------------------ | ----------------------------------------------------- |
| `extensions/Blocks/index.ts`               | Doc node, exports                                     |
| `extensions/Blocks/nodes/BlockNode.ts`     | Main block wrapper node (renamed from BlockContainer) |
| `extensions/Blocks/nodes/BlockChildren.ts` | Block children/list node (renamed from BlockGroup)    |
| `extensions/Blocks/api/block.ts`           | `createTipTapBlock`, `createBlockSpec`                |
| `extensions/Blocks/api/blockTypes.ts`      | TypeScript type definitions                           |

All paths relative to `frontend/packages/editor/src/blocknote/core/`.

---

## Doc Node

```ts
// extensions/Blocks/index.ts
export const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'blockChildren',
})
```

---

## BlockNode (was BlockContainer)

**File:** `extensions/Blocks/nodes/BlockNode.ts`

```ts
export const BlockNode = Node.create({
  name: 'blockNode',
  group: 'blockNodeChild block',
  content: 'block blockChildren?',
  priority: 50,
  defining: true,
})
```

### Groups — Critical Design Detail

`blockNode` is in **two groups**: `blockNodeChild` and `block`.

Content nodes (paragraph, heading, etc.) are in group `block` only.

This means `isInGroup('block')` matches **both** blockNode and content nodes. To
find only blockNode wrappers, always use **`isInGroup('blockNodeChild')`**.

```
isInGroup('blockNodeChild')  →  blockNode only         ← use this for block lookups
isInGroup('block')           →  blockNode + paragraph + heading + ...
spec.group === 'block'       →  paragraph, heading, ... only (exact match)
```

### Attributes

Defined in `BlockAttributes.ts`:

- `id` — unique block identifier
- `blockColor` — block color attribute
- `blockStyle` — block style attribute
- `depth` — nesting depth
- `depthChange` — animation helper for indent transitions

### parseHTML

Matches `<li>` (priority 300) and
`<div data-node-type="blockNode"|"blockContainer">` (priority 200 — backward
compat).

### renderHTML — Single Div (Flat)

```ts
renderHTML({HTMLAttributes}) {
  return [
    'div',
    mergeAttributes({
      class: styles.blockNode,
      'data-node-type': 'blockNode',
    }, HTMLAttributes),
    0,
  ]
}
```

### addNodeView — Dynamic li/div Tag

The NodeView chooses `<li>` when inside `<ol>`/`<ul>`, `<div>` otherwise:

```ts
addNodeView() {
  return ({node, HTMLAttributes, getPos, editor, decorations}) => {
    let tag: 'li' | 'div' = 'div'
    if (typeof getPos === 'function') {
      const pos = getPos()
      if (pos != null) {
        const $pos = editor.state.doc.resolve(pos)
        if ($pos.parent.type.name === 'blockChildren') {
          const listType = $pos.parent.attrs.listType
          if (listType === 'Ordered' || listType === 'Unordered') {
            tag = 'li'
          }
        }
      }
    }

    const dom = document.createElement(tag)
    // ... set attributes from HTMLAttributes ...

    // Apply node decorations (e.g. selection-in-section from headingBoxPlugin)
    applyDecorations(decorations)

    return {
      dom,
      contentDOM: dom,
      update: (updatedNode, updatedDecorations) => {
        if (updatedNode.type.name !== 'blockNode') return false

        // Force re-creation if tag needs to change (li ↔ div)
        const parent = dom.parentElement
        if (parent) {
          const parentTag = parent.tagName.toLowerCase()
          const needsLi = parentTag === 'ol' || parentTag === 'ul'
          const isLi = dom.tagName.toLowerCase() === 'li'
          if (needsLi !== isLi) return false
        }

        // Update node attributes and decorations
        removeDecorations(currentDecorations)
        applyDecorations(updatedDecorations)
        currentDecorations = updatedDecorations
        return true
      },
    }
  }
}
```

**Important:** Because this is a custom NodeView, ProseMirror does NOT
automatically apply `Decoration.node` attributes. The NodeView must explicitly
handle decorations (adding/removing CSS classes).

### ProseMirror Plugins

Defined inline in `BlockNode.ts`:

- **SelectionPlugin** — manages selection decorations
- **ClickSelectionPlugin** — handles shift+click range selection
- **PastePlugin** — handles paste into image caption
- **headingBoxPlugin** — adds `selection-in-section` class to blockNode
  containing nearest heading
- **Em-dash plugin** — replaces `--` with `—`

---

## BlockChildren (was BlockGroup)

**File:** `extensions/Blocks/nodes/BlockChildren.ts`

```ts
export const BlockChildren = Node.create({
  name: 'blockChildren',
  group: 'childContainer',
  content: 'blockNodeChild+',
})
```

### Attributes

- `listType` — default `'Group'`, values:
  `'Group' | 'Ordered' | 'Unordered' | 'Blockquote'`
- `listLevel` — default `'1'`

### renderHTML — Dynamic Tag

```ts
renderHTML({node, HTMLAttributes}) {
  return [
    listNode(node.attrs.listType), // 'ul' | 'ol' | 'blockquote' | 'div'
    mergeAttributes({
      class: styles.blockChildren,
      'data-node-type': 'blockChildren',
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

`BlockChildren.ts` contains extensive paste normalization logic:

- `wrapBlockContentInContainer(node, schema)` — wraps bare content node in a
  blockNode
- `wrapBlockGroupInContainer(groupNode, schema, prevNode)` — wraps bare
  blockChildren in a blockNode
- `normalizeFragment(fragment, schema)` — ensures all children are valid
  blockNodes
- `splitBlockContainerNode(node, schema)` — splits blockNode with multiple
  content children
- `normalizeBlockContainer(node, schema)` — ensures blockNode has exactly one
  content + optional blockChildren
- `transformPasted` plugin processes all pasted content through normalizers

---

## Content Blocks (group: block)

### createTipTapBlock

```ts
// extensions/Blocks/api/block.ts
export function createTipTapBlock<Type extends string>(config) {
  return Node.create({
    ...config,
    group: 'block', // always forced to 'block'
  })
}
```

### createBlockSpec — NodeView WITHOUT Wrapper

In the refactored schema, the intermediate `blockContent` wrapper div is
**removed**. The block's rendered DOM gets the blockContent class directly:

```ts
addNodeView() {
  return ({HTMLAttributes, getPos}) => {
    const rendered = blockConfig.render(block, editor)
    const dom = rendered.dom

    // Apply blockContent styles directly to rendered.dom (no wrapper!)
    dom.className = mergeCSSClasses(dom.className, styles.blockContent, ...)
    dom.setAttribute('data-content-type', blockConfig.type)
    // ... apply HTMLAttributes ...

    return {
      dom,                         // rendered element IS the outer element
      contentDOM: rendered.contentDOM,
    }
  }
}
```

### Paragraph

```ts
export const ParagraphBlockContent = createTipTapBlock<'paragraph'>({
  name: 'paragraph',
  content: 'inline*',
  renderHTML() {
    return [
      'p',
      {class: 'block-paragraph blockContent', 'data-content-type': 'paragraph'},
      0,
    ]
  },
})
```

### Heading

```ts
export const HMHeadingBlockContent = createTipTapBlock<'heading'>({
  name: 'heading',
  content: 'inline*',
  // Attribute: level (default '2')
  renderHTML({node}) {
    return [
      `h${node.attrs.level}`,
      {
        class: 'block-heading heading-content blockContent',
        'data-content-type': 'heading',
      },
      0,
    ]
  },
})
```

### Code Block

```ts
export const CodeBlock = Node.create({
  name: 'code-block',
  content: 'inline*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
})
```

---

## Resulting DOM Structure

```html
<!-- Document root -->
<div data-node-type="blockChildren" data-list-type="Group">
  <!-- A heading block with children -->
  <div class="blockNode" data-node-type="blockNode" data-id="abc">
    <h2 class="block-heading blockContent" data-content-type="heading">
      My Heading
    </h2>
    <div data-node-type="blockChildren" data-list-type="Group">
      <!-- child blocks... -->
    </div>
  </div>

  <!-- An ordered list -->
  <div class="blockNode" data-node-type="blockNode" data-id="def">
    <p class="block-paragraph blockContent" data-content-type="paragraph">
      Parent item
    </p>
    <ol data-node-type="blockChildren" data-list-type="Ordered">
      <li class="blockNode" data-node-type="blockNode" data-id="ghi">
        <p class="block-paragraph blockContent" data-content-type="paragraph">
          List item 1
        </p>
      </li>
      <li class="blockNode" data-node-type="blockNode" data-id="jkl">
        <p class="block-paragraph blockContent" data-content-type="paragraph">
          List item 2
        </p>
      </li>
    </ol>
  </div>
</div>
```

**DOM depth per block:** ~4 levels (blockChildren > blockNode > element > text)

Compare with old: ~7 levels (blockGroup > blockOuter > block > blockContent >
element > inlineContent > text)

---

## Group Checks — isInGroup

| Check                                | Matches                                         | Used For                                                                                                           |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `isInGroup('blockNodeChild')`        | `blockNode` only                                | Finding block wrappers in `getNearestBlockPos`, `getBlockInfoWithManualOffset`, `replaceBlocks`, `BlockNoteEditor` |
| `isInGroup('block')`                 | `blockNode` + `paragraph` + `heading` + ...     | **AVOID for block lookup** — matches too broadly                                                                   |
| `spec.group === 'block'`             | `paragraph`, `heading`, etc. only (exact match) | Identifying content nodes in `getBlockInfoWithManualOffset`, `updateBlock`                                         |
| `node.type.name === 'blockChildren'` | `blockChildren` only                            | Identifying child containers                                                                                       |
| `node.type.name === 'blockNode'`     | `blockNode` only                                | Explicit type check (headingBoxPlugin, findBlock)                                                                  |

**Critical rule:** Never use `isInGroup('block')` to find blockNode wrappers.
Always use `isInGroup('blockNodeChild')`.

---

## Block Info Helpers

### getBlockInfoFromPos

**File:** `extensions/Blocks/helpers/getBlockInfoFromPos.ts`

```ts
export type BlockInfo = {
  block: SingleBlockInfo // The blockNode (has the ID)
  blockContentType: string // 'paragraph', 'heading', etc.
  childContainer?: SingleBlockInfo // The blockChildren, if it exists
  blockContent: SingleBlockInfo // The content node (paragraph, heading, etc.)
}
```

**`getNearestBlockPos(doc, pos)`** — walks up tree using
`isInGroup('blockNodeChild')`:

```ts
export function getNearestBlockPos(doc, pos) {
  const $pos = doc.resolve(pos)
  if ($pos.nodeAfter?.type.isInGroup('blockNodeChild')) {
    return {posBeforeNode: $pos.pos, node: $pos.nodeAfter}
  }
  let depth = $pos.depth
  while (depth > 0) {
    if (node.type.isInGroup('blockNodeChild')) {
      return {posBeforeNode: $pos.before(depth), node}
    }
    depth--
    node = $pos.node(depth)
  }
  // Fallback: expensive full-document scan
}
```

**`getBlockInfoWithManualOffset(node, offset)`** — iterates blockNode children:

- Child with `spec.group === 'block'` → blockContent (content node)
- Child with `type.name === 'blockChildren'` → childContainer

### getGroupInfoFromPos

```ts
export type GroupInfo = {
  group: Node // The blockChildren node
  container?: Node // The blockNode at this position
  depth: number
  level: number
  $pos: ResolvedPos
}
```

### findBlock

```ts
export const findBlock = findParentNode(
  (node) => node.type.name === 'blockNode',
)
```

---

## Block Manipulation Commands

All in `api/blockManipulation/commands/`.

### splitBlock

Splits at cursor using `tr.split(pos, 2, types)`:

```ts
const types = [
  { type: blockNodeType, attrs: { ...attrs, id: undefined } },
  { type: keepType ? contentType : paragraphType, attrs: ... },
]
```

### nestBlock / unnestBlock

- `nestBlock` — custom `sinkListItem` using `ReplaceAroundStep` to wrap in
  `blockNode > blockChildren`
- `unnestBlock` — custom `liftListItem` handling sibling blocks
- `canNestBlock` / `canUnnestBlock` — checks preceding sibling / depth > 1

### updateBlock

```ts
// Determine if newNodeType is a blockNode-level type or a content type
const newBlockNodeType = newNodeType.isInGroup('blockNodeChild')
  ? newNodeType
  : state.schema.nodes['blockNode']

if (newNodeType.spec.group === 'block') {  // content type check (exact match)
  updateChildren(block, state, blockInfo)
  updateBlockContentNode(...)
}
```

### updateGroup

Changes `listType` on a `blockChildren` node. Handles type conversion and
updates child `listLevel` attributes.

### replaceBlocks

Traverses document finding blocks by ID using `isInGroup('blockNodeChild')`.

---

## Node Conversions (HMBlock ↔ ProseMirror)

**File:** `api/nodeConversions/nodeConversions.ts`

### blockToNode (HMBlock → PM Node)

```ts
function blockToNode(block, schema) {
  const contentNode = schema.nodes[type].create(props, inlineContent)
  const children = block.children.map((child) => blockToNode(child, schema))
  const groupNode = schema.nodes['blockChildren'].create(
    {listType: 'Group'},
    children,
  )
  return schema.nodes['blockNode'].create(
    {id, ...props},
    children.length > 0 ? [contentNode, groupNode] : contentNode,
  )
}
```

### nodeToBlock (PM Node → HMBlock)

```ts
function nodeToBlock(node, schema, cache) {
  // node.type.name === 'blockNode'
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

Converts BlockNote internal HTML → standard HTML for clipboard/export. After
refactoring, the plugin walks a simpler structure:

- `blockNode > blockContent` (no blockOuter wrapper to strip)
- Extracts the content element directly
- Wraps list items in proper `<ul>`/`<ol>`

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
    UniqueID.configure({types: ['blockNode']}), // ← was 'blockContainer'
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
    BlockChildren.configure({domAttributes}), // ← was BlockGroup
    ...blockSpecs,
    CustomBlockSerializerExtension,
    Dropcursor,
    HardBreak,
    TrailingNode,
    BlockNode.configure({domAttributes}), // ← was BlockContainer
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

- `.blockNode` —
  `display: flex; flex-direction: column; position: relative; line-height: 1.5`
- `.blockContent` — `padding: 12px 0 3px 0; flex-grow: 1`
- `.blockChildren .blockChildren` — `margin-left: 1.5em` (nesting indent)
- `.inlineContent` — `font-size: 0.9em`

List rendering:

```css
.blockChildren[data-list-type='Unordered'] > .blockNode {
  display: list-item !important;
}
.blockChildren[data-list-type='Ordered'] > .blockNode {
  display: list-item !important;
}
.blockChildren[data-list-type='Unordered'] {
  list-style-type: disc;
}
.blockChildren[data-list-type='Ordered'] {
  list-style-type: decimal;
}
.blockChildren[data-list-type='Blockquote'] {
  border-left: 3px solid var(--border);
}
```

Heading sizes via nesting depth:

```css
[data-node-type='blockChildren'] [data-content-type='heading'] {
  --level: 30px;
}
[data-node-type='blockChildren']
  [data-node-type='blockChildren']
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

- `.selection-in-section::before` — heading section highlight with `z-index: -1`
- `[data-node-type='blockNode']::marker` — list marker styling
- `[data-node-type='blockNode']:has(> [data-content-type='heading'])` — heading
  margins
- `.block-heading + [data-node-type='blockChildren']` — group margin after
  headings

---

## headingBoxPlugin

Decorates the blockNode containing the nearest heading when cursor is in its
subtree:

```ts
function getHeadingDecorations(state) {
  const res = getNearestHeadingFromPos(state, state.selection.from)
  if (res?.heading?.type.name === 'heading') {
    Decoration.node(from - 1, to - 1, {class: 'selection-in-section'})
  }
}

function getNearestHeadingFromPos(state, pos) {
  for (let depth = maxDepth; depth >= 0; depth--) {
    if (
      node.type.name === 'blockNode' &&
      node.firstChild?.type.name === 'heading'
    ) {
      return {depth, groupStartPos, heading, group: node, $pos}
    }
  }
}
```

**Important:** Since blockNode uses a custom NodeView, the NodeView must
explicitly apply/remove the `selection-in-section` CSS class from decorations.
ProseMirror does NOT auto-apply `Decoration.node` attrs to custom NodeViews.

---

## Position Arithmetic

ProseMirror positions for a blockNode at depth `d`:

```
$pos.before(d)     = position before blockNode opening token
$pos.start(d)      = position after opening token (= before(d) + 1)
$pos.end(d)        = position before closing token
$pos.after(d)      = position after closing token
node.nodeSize       = total size including open/close tokens
```

For blockNode content (simplified from old schema):

```
blockNode [+1] paragraph [+1] ... [-1] blockChildren? [+1] ... [-1] [-1]
│               │                       │                             │
before(d)       start(d)                blockChildren start           after(d)
```

Old schema had one extra level (blockOuter > blockContainer), so all offsets
were +1 deeper.

---

## Bugs Found During Refactoring

### 1. isInGroup('block') Ambiguity

**Problem:** After renaming `blockContent` group to `block`, both `blockNode`
(group: `'blockNodeChild block'`) and content nodes like `paragraph` (group:
`'block'`) matched `isInGroup('block')`. This broke `getNearestBlockPos` which
returned paragraph nodes instead of blockNodes.

**Fix:** All block-lookup code uses `isInGroup('blockNodeChild')` instead.
Content-type checks use `spec.group === 'block'` (exact match).

Affected files:

- `getBlockInfoFromPos.ts` (4 occurrences)
- `BlockNoteEditor.ts` (1)
- `replaceBlocks.ts` (1)
- `updateBlock.ts` (2 — one `blockNodeChild`, one `spec.group === 'block'`)

### 2. NodeView Needed for List Items

**Problem:** `blockNode` renders as `<div>` via `renderHTML`, but `<div>` inside
`<ol>`/`<ul>` is invalid HTML. Old code also used `<div>` + `display: list-item`
CSS, but the visual rendering was unreliable.

**Fix:** Added `addNodeView` to `BlockNode` that creates `<li>` when parent is a
list, `<div>` otherwise. The `update` method returns `false` when tag needs to
change, forcing re-creation.

### 3. NodeView Decoration Handling

**Problem:** The `headingBoxPlugin` uses `Decoration.node` to add
`selection-in-section` class to the heading's blockNode. With a custom NodeView,
ProseMirror doesn't automatically apply node decoration attributes.

**Fix:** The NodeView explicitly tracks decorations and applies/removes CSS
classes in both the constructor and `update` method.

### 4. z-index on Heading Highlight

**Problem:** The `.selection-in-section::before` pseudo-element rendered on top
of heading content because with the flat DOM, the `::before` and heading are
siblings in the same containing block.

**Fix:** Added `z-index: -1` to `.selection-in-section::before`.

### 5. code-block Group and References

**Problem:** `code-block.ts` used `group: 'blockContent'` (the old group name)
and referenced `schema.nodes['blockContainer']` / `schema.nodes['blockGroup']`.

**Fix:** Changed to `group: 'block'`, `schema.nodes['blockNode']`,
`schema.nodes['blockChildren']`.

---

## Backward Compatibility

### parseHTML

Both `BlockNode` and `BlockChildren` accept old `data-node-type` values in
`parseHTML` rules for clipboard paste compatibility:

- `blockNode` matches both `data-node-type="blockNode"` and `"blockContainer"`
- `blockChildren` matches both `data-node-type="blockChildren"` and
  `"blockGroup"`

### document.css (Viewer)

`frontend/packages/shared/src/styles/document.css` uses dual selectors for both
old (viewer) and new (editor) attribute names:

```css
[data-node-type='blockContainer'], [data-node-type='blockNode'] { ... }
```

### BlockNoteDOMAttributes

The `blockContent` key in `BlockNoteDOMAttributes` was kept (not renamed to
`block`) to avoid public API breakage.
