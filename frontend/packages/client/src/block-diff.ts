/**
 * Block diffing utilities for document update.
 *
 * Computes minimal document operations by comparing existing document
 * blocks with new blocks parsed from Markdown or JSON input.
 *
 * The primary flow trusts block IDs from the input: if an input block's
 * ID exists in the old document, it's treated as an existing block and
 * diffed for content changes. If the ID doesn't exist, the block is
 * treated as new. Old blocks whose IDs don't appear in the new tree
 * are deleted. This gives per-block granularity — a mix of known and
 * unknown IDs is handled correctly.
 *
 * Tables get an extra identity pass (rebindTableIdentities): the markdown
 * dialect only carries table, column, and row ids, so cell block ids are
 * re-derived from (row id, column id) against the old document, and
 * attributes markdown cannot express (column width, header column) are
 * carried over from the old blocks.
 *
 * A body written as markdown gets one more pass first (markdownUpdateTree):
 * a block whose markdown is what the stored block reads as is the stored
 * block, so nothing the dialect spells differently is stored again, and a
 * block that lost its id comment gets its id back.
 */

import {blocksToMarkdown} from './blocks-to-markdown'
import type {DocumentOperation} from './change'
import type {HMBlockNode, HMDocument} from './hm-types'
import {parseMarkdown} from './markdown-to-blocks'
import type {BlockNode, SeedBlock} from './markdown-to-blocks'

// ── Types matching the API response shape ────────────────────────────────────

export type APIBlockNode = {
  block: APIBlock
  children: APIBlockNode[]
}

export type APIBlock = {
  id: string
  type: string
  text: string
  link: string
  annotations: unknown[]
  attributes: Record<string, unknown>
  revision?: string
}

type BlocksMapItem = {
  parent: string
  left: string
  block: APIBlock
}

type BlocksMap = Record<string, BlocksMapItem>

// ── Build a flat map of existing blocks keyed by ID ──────────────────────────

export function createBlocksMap(nodes: APIBlockNode[], parentId: string = ''): BlocksMap {
  const result: BlocksMap = {}

  nodes.forEach((node, idx) => {
    if (!node.block?.id) return

    const prev = idx > 0 ? nodes[idx - 1] : undefined
    const prevId = prev?.block?.id || ''

    result[node.block.id] = {
      parent: parentId,
      left: prevId,
      block: node.block,
    }

    if (node.children?.length) {
      Object.assign(result, createBlocksMap(node.children, node.block.id))
    }
  })

  return result
}

// ── Positional matching: assign existing IDs to new blocks ───────────────────

/**
 * Walk old and new block trees in parallel. When the new block at
 * position N has the same type as the old block at position N, reuse
 * the old block's ID. Otherwise assign the new block's generated ID.
 *
 * Returns a new tree with IDs reassigned (does not mutate inputs).
 */
export function matchBlockIds(oldNodes: APIBlockNode[], newNodes: BlockNode[]): BlockNode[] {
  return newNodes.map((newNode, idx) => {
    const oldNode = idx < oldNodes.length ? oldNodes[idx] : undefined

    let matchedId = newNode.block.id
    if (oldNode && oldNode.block.type === newNode.block.type) {
      matchedId = oldNode.block.id
    }

    // A table's columns, rows and cells are bound to each other by id
    // (cells reference columns via `columnId`), so positional renaming would
    // break them. Only the table itself is matched here; its subtree is
    // rebound as a unit by rebindTableIdentities.
    const matchedChildren =
      newNode.block.type === 'Table' ? newNode.children : matchBlockIds(oldNode?.children ?? [], newNode.children)

    return {
      block: {...newNode.block, id: matchedId},
      children: matchedChildren,
    }
  })
}

// ── Table identity rebinding ─────────────────────────────────────────────────

/** Attributes of an old block minus the keys SeedBlock keeps at the top level. */
function extraAttributes(attrs: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!attrs) return {}
  const {childrenType: _c, language: _l, ...rest} = attrs
  return rest
}

/** Cell text of `row`'s cell in column `columnId`, or undefined when absent. */
function oldHeaderCellText(row: APIBlockNode | undefined, columnId: string): string | undefined {
  if (!row) return undefined
  for (const cell of row.children || []) {
    if (cell.block?.attributes?.columnId === columnId) return cell.block.text || ''
  }
  return undefined
}

/**
 * Rebind identity inside every Table in the new tree against the old tree.
 *
 * For a new Table whose id matches an old Table:
 *  - Columns match by explicit id first, then by header-cell text (unique,
 *    non-empty texts only), then by position among the still-unmatched.
 *  - Rows match by explicit id first, then by position among the unmatched.
 *  - Cells reuse the old cell's block id for (matched row, matched column) —
 *    cell ids never travel through markdown.
 *  - Attributes markdown cannot express (column width, header column, any
 *    future keys) are carried over from the matched old block. A row's
 *    isHeader comes from the new tree (the dialect does express it).
 *  - Position-0 invariants are enforced: only the first column / first row
 *    may carry isHeader.
 *
 * Fresh tables (no old match) are passed through with invariants enforced.
 * Non-table blocks are returned unchanged (children walked recursively).
 */
export function rebindTableIdentities(oldNodes: APIBlockNode[], newNodes: BlockNode[]): BlockNode[] {
  const oldTables = new Map<string, APIBlockNode>()
  const indexTables = (nodes: APIBlockNode[]) => {
    for (const node of nodes) {
      if (node.block?.type === 'Table') oldTables.set(node.block.id, node)
      if (node.children?.length) indexTables(node.children)
    }
  }
  indexTables(oldNodes)

  const walk = (nodes: BlockNode[]): BlockNode[] =>
    nodes.map((node) => {
      if (node.block.type === 'Table') {
        return rebindTable(oldTables.get(node.block.id), node)
      }
      return {...node, children: walk(node.children)}
    })

  return walk(newNodes)
}

function rebindTable(oldTable: APIBlockNode | undefined, newTable: BlockNode): BlockNode {
  const newCols = newTable.children.filter((c) => c.block.type === 'TableColumn')
  const newRows = newTable.children.filter((c) => c.block.type === 'TableRow')
  const otherChildren = newTable.children.filter((c) => c.block.type !== 'TableColumn' && c.block.type !== 'TableRow')

  const oldCols = (oldTable?.children || []).filter((c) => c.block?.type === 'TableColumn')
  const oldRows = (oldTable?.children || []).filter((c) => c.block?.type === 'TableRow')
  const oldColById = new Map(oldCols.map((c) => [c.block.id, c]))
  const oldRowById = new Map(oldRows.map((r) => [r.block.id, r]))

  // ── Column matching ──
  const usedOldCols = new Set<string>()
  const matchedOldCol: (APIBlockNode | undefined)[] = new Array(newCols.length).fill(undefined)

  // Pass 1: explicit ids.
  newCols.forEach((col, idx) => {
    const old = oldColById.get(col.block.id)
    if (old && !usedOldCols.has(old.block.id)) {
      matchedOldCol[idx] = old
      usedOldCols.add(old.block.id)
    }
  })

  // Pass 2: header-cell text. Old texts come from the old header row; new
  // texts from the new header row. Only unique, non-empty texts match.
  const oldHeaderRow = oldRows.find((r) => r.block.attributes?.isHeader === true)
  const newHeaderRow = newRows.find((r) => r.block.attributes?.isHeader === true)
  if (oldHeaderRow && newHeaderRow) {
    const textToOldCol = new Map<string, APIBlockNode | null>()
    for (const old of oldCols) {
      if (usedOldCols.has(old.block.id)) continue
      const text = oldHeaderCellText(oldHeaderRow, old.block.id)
      if (!text) continue
      textToOldCol.set(text, textToOldCol.has(text) ? null : old)
    }
    newCols.forEach((col, idx) => {
      if (matchedOldCol[idx]) return
      const cell = newHeaderRow.children.find((c) => c.block.attributes?.columnId === col.block.id)
      const text = cell?.block.text || ''
      const old = text ? textToOldCol.get(text) : undefined
      if (old && !usedOldCols.has(old.block.id)) {
        matchedOldCol[idx] = old
        usedOldCols.add(old.block.id)
      }
    })
  }

  // Pass 3: positional among the still-unmatched, in order.
  const remainingOldCols = oldCols.filter((c) => !usedOldCols.has(c.block.id))
  let remainingIdx = 0
  newCols.forEach((_, idx) => {
    if (matchedOldCol[idx]) return
    const old = remainingOldCols[remainingIdx]
    if (old) {
      matchedOldCol[idx] = old
      usedOldCols.add(old.block.id)
      remainingIdx++
    }
  })

  // Final column ids + rebuilt column nodes with attribute carry-over.
  const colIdMap = new Map<string, string>()
  const finalCols: BlockNode[] = newCols.map((col, idx) => {
    const old = matchedOldCol[idx]
    const finalId = old ? old.block.id : col.block.id
    colIdMap.set(col.block.id, finalId)
    // Markdown expresses nothing about a column beyond its id and order:
    // width / isHeader / future attributes all carry over from the old block.
    const carried = {...extraAttributes(old?.block.attributes), ...col.block.attributes}
    const block: SeedBlock = {
      ...col.block,
      id: finalId,
      ...(Object.keys(carried).length > 0 ? {attributes: carried} : {}),
    }
    return {block, children: []}
  })

  // ── Row matching ──
  const usedOldRows = new Set<string>()
  const matchedOldRow: (APIBlockNode | undefined)[] = new Array(newRows.length).fill(undefined)

  newRows.forEach((row, idx) => {
    const old = oldRowById.get(row.block.id)
    if (old && !usedOldRows.has(old.block.id)) {
      matchedOldRow[idx] = old
      usedOldRows.add(old.block.id)
    }
  })

  const remainingOldRows = oldRows.filter((r) => !usedOldRows.has(r.block.id))
  let remainingRowIdx = 0
  newRows.forEach((_, idx) => {
    if (matchedOldRow[idx]) return
    const old = remainingOldRows[remainingRowIdx]
    if (old) {
      matchedOldRow[idx] = old
      usedOldRows.add(old.block.id)
      remainingRowIdx++
    }
  })

  // ── Rebuild rows: reuse old row ids, rebind cells by (row, column) ──
  const finalRows: BlockNode[] = newRows.map((row, idx) => {
    const old = matchedOldRow[idx]
    const rowId = old ? old.block.id : row.block.id

    // isHeader comes from the new tree (markdown expresses it); everything
    // else carries over from the old row.
    const {isHeader: _oldIsHeader, ...oldRowExtras} = extraAttributes(old?.block.attributes)
    const rowAttrs = {...oldRowExtras, ...row.block.attributes}

    const cells = row.children.map((cell) => {
      const newColumnId = cell.block.attributes?.columnId
      const finalColumnId = typeof newColumnId === 'string' ? colIdMap.get(newColumnId) ?? newColumnId : newColumnId

      const oldCell = old?.children.find((c) => c.block?.attributes?.columnId === finalColumnId)
      const cellAttrs = {
        ...extraAttributes(oldCell?.block.attributes),
        ...cell.block.attributes,
        columnId: finalColumnId,
      }
      const block: SeedBlock = {
        ...cell.block,
        id: oldCell ? oldCell.block.id : cell.block.id,
        attributes: cellAttrs,
      }
      return {block, children: cell.children}
    })

    const block: SeedBlock = {
      ...row.block,
      id: rowId,
      ...(Object.keys(rowAttrs).length > 0 ? {attributes: rowAttrs} : {}),
    }
    return {block, children: cells}
  })

  // ── Position-0 invariants: only the first column / row may be a header ──
  const stripLateHeader = (nodes: BlockNode[]) => {
    nodes.forEach((node, idx) => {
      if (idx === 0 || node.block.attributes?.isHeader !== true) return
      const {isHeader: _h, ...rest} = node.block.attributes!
      node.block = {...node.block, attributes: rest}
    })
  }
  stripLateHeader(finalCols)
  stripLateHeader(finalRows)

  // Table block: carry over attributes from the old table as well.
  const tableAttrs = {...extraAttributes(oldTable?.block.attributes), ...newTable.block.attributes}
  const tableBlock: SeedBlock = {
    ...newTable.block,
    ...(Object.keys(tableAttrs).length > 0 ? {attributes: tableAttrs} : {}),
  }

  // Columns before rows, matching the editor's child ordering convention.
  return {block: tableBlock, children: [...finalCols, ...finalRows, ...otherChildren]}
}

// ── Compute minimal operations from matched tree ─────────────────────────────

/**
 * Compare the new block tree against the old blocks map and produce the
 * DocumentOperations that turn one into the other:
 *
 * - ReplaceBlock for new or content-changed blocks (an unchanged block gets none)
 * - MoveBlocks for a level whose order changed (an unchanged level gets none)
 * - DeleteBlocks for blocks removed from the document
 *
 * The replaces are minimal; the moves are not. A native MoveBlocks carries no
 * anchor: it places its blocks at the start of the parent's children, in the
 * order listed. So a level whose order changed in any way (a block added,
 * removed or moved) is listed whole, the blocks already in place included.
 * An update sent through `PrepareDocumentChange` (documentUpdateBlobs)
 * drops the moves that change nothing, so the stored Change is minimal there;
 * a Change built from these ops directly (createChangeOps) stores them all.
 * Skipping unchanged blocks here still matters on the daemon path: it writes
 * a block with a whole-number attribute again even when it is equal.
 *
 * The delete pass is global: every old block whose id does not appear
 * anywhere in the new tree is deleted, including descendants of deleted
 * blocks (so removing a table row also removes its cells, leaving no
 * orphans), while blocks that moved to a different parent are kept.
 */
export function computeReplaceOps(
  oldMap: BlocksMap,
  matchedTree: BlockNode[],
  parentId: string = '',
): DocumentOperation[] {
  const touchedIds = new Set<string>()
  const ops = computeReplaceOpsInner(oldMap, matchedTree, parentId, touchedIds)

  const deletedIds = Object.keys(oldMap).filter((id) => !touchedIds.has(id))
  if (deletedIds.length > 0) {
    ops.push({type: 'DeleteBlocks', blocks: deletedIds})
  }

  return ops
}

/** The ids of `parentId`'s children in the old document, in order. */
function oldSiblingOrder(oldMap: BlocksMap, parentId: string): string[] {
  const byLeft = new Map<string, string>()
  for (const [id, entry] of Object.entries(oldMap)) {
    if (entry.parent === parentId) byLeft.set(entry.left, id)
  }
  const order: string[] = []
  let cur = byLeft.get('')
  while (cur !== undefined && !order.includes(cur)) {
    order.push(cur)
    cur = byLeft.get(cur)
  }
  return order
}

function computeReplaceOpsInner(
  oldMap: BlocksMap,
  matchedTree: BlockNode[],
  parentId: string,
  touchedIds: Set<string>,
): DocumentOperation[] {
  const ops: DocumentOperation[] = []
  const blockIdsAtLevel: string[] = []

  matchedTree.forEach((node) => {
    const blockId = node.block.id
    touchedIds.add(blockId)
    blockIdsAtLevel.push(blockId)

    const oldEntry = oldMap[blockId]
    const isNew = !oldEntry

    // Build the block object for ReplaceBlock.
    // Attributes are inlined at the top level of the block (not nested).
    const block: Record<string, unknown> = {
      ...node.block.attributes,
      type: node.block.type,
      id: blockId,
      text: node.block.text,
      annotations: node.block.annotations,
    }
    if (node.block.language !== undefined) {
      block.language = node.block.language
    }
    if (node.block.childrenType !== undefined) {
      block.childrenType = node.block.childrenType
    }
    if (node.block.link !== undefined) {
      block.link = node.block.link
    }

    if (isNew) {
      // New block: need both ReplaceBlock and MoveBlocks
      ops.push({type: 'ReplaceBlock', block})
    } else {
      // Existing block: only ReplaceBlock if content changed
      if (!isBlockContentEqual(oldEntry.block, node.block)) {
        ops.push({type: 'ReplaceBlock', block})
      }
    }

    // Recurse into children
    if (node.children.length > 0) {
      ops.push(...computeReplaceOpsInner(oldMap, node.children, blockId, touchedIds))
    }
  })

  // Emit a single MoveBlocks for all blocks at this level, positioning them
  // under the parent in order — unless the level already reads exactly like
  // this in the old document, so an untouched document yields no ops at all.
  // A level whose order did change lists every block of it, the ones already
  // in place included (see computeReplaceOps).
  const oldOrder = oldSiblingOrder(oldMap, parentId)
  const sameOrder = oldOrder.length === blockIdsAtLevel.length && blockIdsAtLevel.every((id, i) => oldOrder[i] === id)
  if (blockIdsAtLevel.length > 0 && !sameOrder) {
    ops.push({
      type: 'MoveBlocks',
      blocks: blockIdsAtLevel,
      parent: parentId,
    })
  }

  return ops
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Shallow attribute equality; object/array values compared via JSON. */
function attrsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys({...a, ...b})
  for (const key of keys) {
    const av = a[key]
    const bv = b[key]
    if (av === bv) continue
    if (JSON.stringify(av) !== JSON.stringify(bv)) return false
  }
  return true
}

/** Deterministic annotation order: by first start, then longest first, then type. */
function compareAnnotations(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const sa = (a.starts as number[] | undefined)?.[0] ?? 0
  const sb = (b.starts as number[] | undefined)?.[0] ?? 0
  const ea = (a.ends as number[] | undefined)?.[0] ?? 0
  const eb = (b.ends as number[] | undefined)?.[0] ?? 0
  return sa - sb || eb - ea || String(a.type).localeCompare(String(b.type))
}

/** An annotation covering no text (every range empty) carries no meaning. */
function hasRange(a: Record<string, unknown>): boolean {
  const starts = (a.starts as number[] | undefined) || []
  const ends = (a.ends as number[] | undefined) || []
  return starts.some((s, i) => (ends[i] ?? -1) > s)
}

/** An annotation reduced to its meaning: no empty link/attributes, fixed key order. */
function canonicalAnnotation(ann: unknown): Record<string, unknown> {
  const a = (ann || {}) as Record<string, unknown>
  const starts = (a.starts as number[] | undefined) || []
  const ends = (a.ends as number[] | undefined) || []
  const keep = starts.map((_, i) => i).filter((i) => (ends[i] ?? -1) > starts[i]!)
  const out: Record<string, unknown> = {
    type: a.type,
    starts: keep.map((i) => starts[i]),
    ends: keep.map((i) => ends[i]),
  }
  if (a.link) out.link = a.link
  const attrs = a.attributes as Record<string, unknown> | undefined
  if (attrs && Object.keys(attrs).length > 0) {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(attrs).sort()) sorted[k] = attrs[k]
    out.attributes = sorted
  }
  return out
}

/**
 * Compare old API block content with new parsed block content.
 * Returns true if they're semantically equal.
 */
function isBlockContentEqual(old: APIBlock, newBlock: SeedBlock): boolean {
  if (old.type !== newBlock.type) return false
  if ((old.text || '') !== (newBlock.text || '')) return false
  if ((old.link || '') !== (newBlock.link || '')) return false

  // Compare annotations semantically: the API spells out empty `link` /
  // `attributes` and its own key order, the markdown parser does not.
  const oldAnn = (old.annotations || []).map(canonicalAnnotation).filter(hasRange).sort(compareAnnotations)
  const newAnn = (newBlock.annotations || []).map(canonicalAnnotation).filter(hasRange).sort(compareAnnotations)
  if (oldAnn.length !== newAnn.length) return false
  if (oldAnn.length > 0 && JSON.stringify(oldAnn) !== JSON.stringify(newAnn)) {
    return false
  }

  // Compare relevant attributes
  const oldAttrs = old.attributes || {}
  if ((oldAttrs.childrenType || '') !== (newBlock.childrenType || '')) {
    return false
  }
  if ((oldAttrs.language || '') !== (newBlock.language || '')) return false

  // Compare the remaining attributes (columnId, isHeader, width, …)
  if (!attrsEqual(extraAttributes(oldAttrs), newBlock.attributes || {})) return false

  return true
}

// ── HMBlockNode → APIBlockNode conversion ────────────────────────────────────

/**
 * Normalize an HMBlockNode tree (API response shape) into APIBlockNode with
 * all fields defaulted, for use as the "old document" side of the diff.
 */
export function toAPIBlockNode(node: HMBlockNode): APIBlockNode {
  const block = node.block as {
    id: string
    type: string
    text?: string
    link?: string
    annotations?: unknown[]
    attributes?: Record<string, unknown>
  }
  return {
    block: {
      id: block.id,
      type: block.type,
      text: block.text || '',
      link: block.link || '',
      annotations: block.annotations || [],
      attributes: block.attributes || {},
    },
    children: (node.children || []).map(toAPIBlockNode),
  }
}

// ── HMBlockNode → BlockNode conversion ──────────────────────────────────────

/**
 * Convert an HMBlockNode tree (from JSON input or API response) into
 * a BlockNode tree compatible with the diff pipeline.
 *
 * HMBlockNode nests childrenType/language inside `attributes`, while
 * SeedBlock/BlockNode has them at the top level. All other attributes
 * (columnId, isHeader, width, …) are preserved in `block.attributes`.
 */
export function hmBlockNodeToBlockNode(node: HMBlockNode): BlockNode {
  const b = node.block as Record<string, unknown>
  const attrs = (b.attributes || {}) as Record<string, unknown>
  const extra = extraAttributes(attrs)

  const block: SeedBlock = {
    type: (b.type as string) || '',
    id: (b.id as string) || '',
    text: (b.text as string) || '',
    annotations: (b.annotations as SeedBlock['annotations']) || [],
    ...(attrs.childrenType ? {childrenType: attrs.childrenType as string} : {}),
    ...(attrs.language ? {language: attrs.language as string} : {}),
    ...(b.link ? {link: b.link as string} : {}),
    ...(Object.keys(extra).length > 0 ? {attributes: extra} : {}),
  }

  return {
    block,
    children: (node.children || []).map(hmBlockNodeToBlockNode),
  }
}

// ── Markdown updates: unchanged markdown is the same block ───────────────────

const TABLE_PARTS = new Set(['Table', 'TableColumn', 'TableRow'])

/** JSON with every map's keys in order, so equal values give equal text. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  if (value && typeof value === 'object') {
    const map = value as Record<string, unknown>
    const keys = Object.keys(map)
      .filter((key) => map[key] !== undefined)
      .sort()
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableJson(map[key])).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

/** The markdown writer prints an `ipfs://` media link as this gateway address unless told not to. */
function nativeIpfsLink(link: string): string {
  const gateway = 'https://ipfs.io/ipfs/'
  return link.startsWith(gateway) ? 'ipfs://' + link.slice(gateway.length) : link
}

/**
 * What a block says, without its id, in one spelling: two blocks with the same key read the same.
 * `own` leaves out how the block's children are arranged, which is not something the block says
 * about itself.
 */
function blockKey(block: SeedBlock, own = false): string {
  const annotations = (block.annotations || [])
    .map(canonicalAnnotation)
    .filter(hasRange)
    .map((annotation) => stableJson(annotation))
    .sort()
  return stableJson([
    block.type,
    block.text || '',
    nativeIpfsLink(block.link || ''),
    annotations,
    own ? '' : block.childrenType || '',
    block.language || '',
    block.attributes || {},
  ])
}

function eachBlock(nodes: BlockNode[], visit: (block: SeedBlock) => void): void {
  for (const node of nodes) {
    visit(node.block)
    eachBlock(node.children, visit)
  }
}

/**
 * The tree to diff against a stored document when its new body was written as markdown.
 *
 * Markdown spells some things in one way only: an annotation over several ranges comes back as one
 * per range, a block with children gets an explicit `Group`, a mention gets its kind. A diff of
 * the parsed blocks against the stored ones would store every such block again although its author
 * changed nothing. So the stored document is written to markdown and parsed here, which says what
 * each stored block reads as, and then:
 *
 *  - a written block that reads the same as the stored block with its id is that block, as stored;
 *  - a written block with no stored id that reads the same as a stored block the body does not
 *    otherwise hold is that block: it gets the id back (the earliest such block in the document,
 *    when several read alike). Only blocks with text or a link are matched this way, and how
 *    their children are arranged does not count: markdown without id comments nests a list under
 *    the paragraph before it.
 *
 * Tables are rebound first (rebindTableIdentities). The result goes to computeReplaceOps. A body
 * that is the document's own markdown, with or without its id comments, yields no operations.
 */
export function markdownUpdateTree(oldContent: HMBlockNode[], written: BlockNode[]): BlockNode[] {
  const oldNodes = oldContent.map(toAPIBlockNode)
  const tree = rebindTableIdentities(oldNodes, written)

  const stored = new Map<string, SeedBlock>()
  eachBlock(oldContent.map(hmBlockNodeToBlockNode), (block) => {
    if (block.id && !stored.has(block.id)) stored.set(block.id, block)
  })
  // A mention has two spellings, `<hm://…>` and `[@Name](hm://…)`, which the parser reads slightly
  // differently, so a stored block may read as either.
  const readsAs = new Map<string, Set<string>>()
  const readsAsOwn = new Map<string, Set<string>>()
  for (const mentionLabel of [() => '', undefined]) {
    try {
      const markdown = blocksToMarkdown({metadata: {}, content: oldContent} as unknown as HMDocument, {
        ipfsGateway: false,
        mentionLabel,
      })
      eachBlock(rebindTableIdentities(oldNodes, parseMarkdown(markdown).tree), (block) => {
        if (!stored.has(block.id)) return
        readsAs.set(block.id, (readsAs.get(block.id) || new Set<string>()).add(blockKey(block)))
        readsAsOwn.set(block.id, (readsAsOwn.get(block.id) || new Set<string>()).add(blockKey(block, true)))
      })
    } catch {
      // A document the writer cannot express: the blocks are compared as parsed.
    }
  }

  const present = new Set<string>()
  eachBlock(tree, (block) => present.add(block.id))
  const matchable = (block: SeedBlock) => !TABLE_PARTS.has(block.type) && !!(block.text || block.link)
  const unclaimed = new Map<string, string[]>()
  for (const [id, block] of Array.from(stored)) {
    if (present.has(id) || !matchable(block)) continue
    for (const key of Array.from(readsAsOwn.get(id) || [])) {
      const ids = unclaimed.get(key)
      if (ids) ids.push(id)
      else unclaimed.set(key, [id])
    }
  }
  const claim = (key: string): string | undefined => {
    const ids = unclaimed.get(key) || []
    while (ids.length) {
      const id = ids.shift()!
      if (!present.has(id)) {
        present.add(id)
        return id
      }
    }
    return undefined
  }

  const walk = (nodes: BlockNode[]): BlockNode[] =>
    nodes.map((node) => {
      const key = blockKey(node.block)
      let id = node.block.id
      if (!stored.has(id) && matchable(node.block)) id = claim(blockKey(node.block, true)) ?? id
      const block = readsAs.get(id)?.has(key)
        ? stored.get(id)!
        : id === node.block.id
          ? node.block
          : {...node.block, id}
      return {block, children: walk(node.children)}
    })
  return walk(tree)
}

/** What a content update does to a document, counted in blocks. */
export type ContentChange = {
  /** Blocks the document holds now. */
  blocks: number
  added: number
  rewritten: number
  /** Blocks that keep their id and end up under another parent or in another order. */
  moved: number
  deleted: number
}

/** The length of the longest run of `ids` that is already in the order `rank` gives. */
function longestOrdered(ids: string[], rank: Map<string, number>): number {
  const tails: number[] = []
  for (const id of ids) {
    const value = rank.get(id)!
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (tails[mid]! < value) low = mid + 1
      else high = mid
    }
    tails[low] = value
  }
  return tails.length
}

/** Counts what `ops` (from computeReplaceOps over `newTree`) change in the stored document. */
export function describeContentChange(
  oldNodes: APIBlockNode[],
  newTree: BlockNode[],
  ops: DocumentOperation[],
): ContentChange {
  type Placement = {parent: string; index: number}
  const place = <T extends {block: {id: string}; children?: T[]}>(nodes: T[]) => {
    const placed = new Map<string, Placement>()
    const walk = (list: T[], parent: string) =>
      list.forEach((node, index) => {
        if (!node.block?.id || placed.has(node.block.id)) return
        placed.set(node.block.id, {parent, index})
        walk(node.children || [], node.block.id)
      })
    walk(nodes, '')
    return placed
  }
  const before = place(oldNodes)
  const after = place(newTree)

  let added = 0
  let moved = 0
  const kept = new Map<string, string[]>()
  for (const [id, now] of Array.from(after)) {
    const was = before.get(id)
    if (!was) added++
    else if (was.parent !== now.parent) moved++
    else kept.set(now.parent, [...(kept.get(now.parent) || []), id])
  }
  for (const ids of Array.from(kept.values())) {
    const rank = new Map<string, number>(ids.map((id): [string, number] => [id, before.get(id)!.index]))
    moved += ids.length - longestOrdered(ids, rank)
  }
  let deleted = 0
  for (const id of Array.from(before.keys())) if (!after.has(id)) deleted++
  let rewritten = 0
  for (const op of ops) {
    if (op.type === 'ReplaceBlock' && before.has(String((op.block as {id?: unknown}).id))) rewritten++
  }
  return {blocks: before.size, added, rewritten, moved, deleted}
}
