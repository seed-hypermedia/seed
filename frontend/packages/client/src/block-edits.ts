/**
 * Edits that name the blocks they change.
 *
 * Replacing a document's whole body to change one sentence costs the whole document, and every
 * block left out of the new body is deleted. An edit list changes blocks by id instead and leaves
 * the rest of the tree as it is stored:
 *
 *   {replace: ID, content}             one block's own content; its children stay
 *   {after | before | into: ID, content}   new blocks beside a block, or as its last children
 *   {move: ID, after | before | into: ID}  a block with its children, somewhere else
 *   {delete: ID | [ID, …]}             a block with its children
 *
 * `content` is markdown in the dialect of `markdown-to-blocks.ts`. Edits apply in order, each to
 * the result of the one before, and all or none: the first edit that cannot apply throws
 * {@link BlockEditError} and the input tree is untouched.
 */
import type {BlockNode} from './markdown-to-blocks'

/** An edit that cannot apply. `index` is its position in the list. */
export class BlockEditError extends Error {
  constructor(
    public index: number,
    message: string,
  ) {
    super(`Edit ${index + 1}: ${message}`)
    this.name = 'BlockEditError'
  }
}

export type BlockEditResult = {
  /** The edited tree. Blocks no edit named are the same objects as in the input. */
  tree: BlockNode[]
  /** Every block an edit wrote: the replacements and the new blocks, with their children. */
  written: BlockNode[]
}

type Position = 'after' | 'before' | 'into'
const POSITIONS: Position[] = ['after', 'before', 'into']
const LIST_TYPES = new Set(['Unordered', 'Ordered', 'Blockquote'])
const FORMS =
  '{replace: ID, content}, {after | before | into: ID, content}, {move: ID, after | before | into: ID} or {delete: ID}'

type Located = {node: BlockNode; siblings: BlockNode[]; index: number; parent?: BlockNode}

function locate(nodes: BlockNode[], id: string, parent?: BlockNode): Located | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    if (node.block.id === id) return {node, siblings: nodes, index, parent}
    const found = locate(node.children, id, node)
    if (found) return found
  }
  return undefined
}

/** A copy whose child lists can be changed without touching the input. Blocks are shared. */
function copyTree(nodes: BlockNode[]): BlockNode[] {
  return nodes.map((node) => ({block: node.block, children: copyTree(node.children)}))
}

/** A list written at the top of a fragment is wrapped by the parser in a block with no text. */
function isBareList(node: BlockNode): boolean {
  return (
    node.block.type === 'Paragraph' &&
    !node.block.text &&
    !node.block.link &&
    node.children.length > 0 &&
    LIST_TYPES.has(node.block.childrenType || '')
  )
}

/**
 * The blocks a fragment adds under `parent`. A fragment that is only a list (`- item`) written
 * into a list of the same kind adds items to that list, not a list inside it.
 */
function fragmentUnder(parent: BlockNode | undefined, nodes: BlockNode[]): BlockNode[] {
  const only = nodes.length === 1 ? nodes[0]! : undefined
  if (only && parent && isBareList(only) && parent.block.childrenType === only.block.childrenType) return only.children
  return nodes
}

function idOf(index: number, value: unknown, what: string): string {
  if (typeof value !== 'string' || !value)
    throw new BlockEditError(index, `${what} must be a block id (the X of an \`<!-- id:X -->\` comment).`)
  return value
}

function contentOf(index: number, edit: Record<string, unknown>): string {
  if (typeof edit.content !== 'string') throw new BlockEditError(index, '`content` must be a markdown string.')
  return edit.content
}

/**
 * Applies `edits` to `tree`. `parse` turns an edit's markdown into blocks (the caller decides what
 * else that involves, such as resolving links).
 */
export function applyBlockEdits(
  tree: BlockNode[],
  edits: unknown,
  parse: (markdown: string) => BlockNode[],
): BlockEditResult {
  if (!Array.isArray(edits) || edits.length === 0) throw new BlockEditError(0, `edits must be a list of ${FORMS}.`)
  const root = copyTree(tree)
  const written: BlockNode[] = []

  const find = (index: number, id: string): Located => {
    const found = locate(root, id)
    if (!found)
      throw new BlockEditError(
        index,
        `the document has no block with id "${id}". Read the document for its current block ids; an earlier edit in this list may have deleted it.`,
      )
    return found
  }

  /** Where `position` relative to block `id` puts new blocks: a sibling list, an index, the parent. */
  const slot = (index: number, position: Position, id: string) => {
    const target = find(index, id)
    if (position === 'into') {
      return {siblings: target.node.children, at: target.node.children.length, parent: target.node, target}
    }
    return {
      siblings: target.siblings,
      at: position === 'after' ? target.index + 1 : target.index,
      parent: target.parent,
      target,
    }
  }

  /** A block that gains its first children says how they are arranged, as the parser would. */
  const adopt = (parent: BlockNode | undefined, nodes: BlockNode[]): BlockNode[] => {
    if (!parent || parent.children.length > 0) return fragmentUnder(parent, nodes)
    const only = nodes.length === 1 ? nodes[0]! : undefined
    const nests = only && isBareList(only) && parent.block.type === 'Paragraph' && !!parent.block.text
    const childrenType = nests ? only.block.childrenType : parent.block.childrenType || 'Group'
    if (parent.block.childrenType !== childrenType) parent.block = {...parent.block, childrenType}
    return nests ? only.children : fragmentUnder(parent, nodes)
  }

  edits.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new BlockEditError(index, `an edit is one of ${FORMS}.`)
    const edit = raw as Record<string, unknown>
    const positions = POSITIONS.filter((key) => edit[key] !== undefined)
    const verbs = ['replace', 'move', 'delete'].filter((key) => edit[key] !== undefined)
    const known = new Set(['replace', 'move', 'delete', 'content', ...POSITIONS])
    const unknown = Object.keys(edit).filter((key) => !known.has(key))
    if (unknown.length || verbs.length > 1 || positions.length > 1)
      throw new BlockEditError(index, `an edit is one of ${FORMS}.`)

    if (edit.delete !== undefined) {
      if (positions.length || edit.content !== undefined)
        throw new BlockEditError(index, 'a delete takes only the id, or a list of ids, to delete.')
      const ids = Array.isArray(edit.delete) ? edit.delete : [edit.delete]
      for (const id of ids) {
        const target = find(index, idOf(index, id, '`delete`'))
        target.siblings.splice(target.index, 1)
      }
      return
    }

    if (edit.move !== undefined) {
      if (positions.length !== 1 || edit.content !== undefined)
        throw new BlockEditError(index, 'a move names where the block goes: one of after, before or into.')
      const moved = find(index, idOf(index, edit.move, '`move`'))
      const position = positions[0]!
      const anchor = idOf(index, edit[position], `\`${position}\``)
      if (locate([moved.node], anchor))
        throw new BlockEditError(
          index,
          `block "${moved.node.block.id}" cannot move ${position} itself or its children.`,
        )
      moved.siblings.splice(moved.index, 1)
      const to = slot(index, position, anchor)
      // Moved, not written: among other children it takes their arrangement, alone it starts a Group.
      if (to.parent && !to.parent.children.length && !to.parent.block.childrenType)
        to.parent.block = {...to.parent.block, childrenType: 'Group'}
      to.siblings.splice(to.at, 0, moved.node)
      return
    }

    if (edit.replace !== undefined) {
      if (positions.length)
        throw new BlockEditError(index, 'a replace takes the id and `content`. Add blocks with a separate edit.')
      const target = find(index, idOf(index, edit.replace, '`replace`'))
      const nodes = fragmentUnder(target.parent, parse(contentOf(index, edit)))
      const first = nodes[0]
      if (!first) throw new BlockEditError(index, 'the replacement is empty. To remove the block, use {delete: ID}.')
      // A table's columns and rows are part of the table, not children that could stay.
      const kept = target.node.block.type === 'Table' ? [] : target.node.children
      if (first.block.type === 'Table' ? kept.length > 0 : first.children.length > 0 && kept.length > 0)
        throw new BlockEditError(
          index,
          `block "${target.node.block.id}" has children, which a replace keeps, so the replacement cannot bring children of its own. Write only the block itself, and change its children by their ids or add to them with {into: "${target.node.block.id}", content}.`,
        )
      const children = first.block.type === 'Table' || !kept.length ? first.children : kept
      const childrenType = kept.length ? target.node.block.childrenType : first.block.childrenType
      const {childrenType: _written, ...own} = first.block
      const replacement: BlockNode = {
        block: {...own, id: target.node.block.id, ...(childrenType ? {childrenType} : {})},
        children,
      }
      target.siblings.splice(target.index, 1, replacement, ...nodes.slice(1))
      written.push(replacement, ...nodes.slice(1))
      return
    }

    if (positions.length !== 1) throw new BlockEditError(index, `an edit is one of ${FORMS}.`)
    const position = positions[0]!
    const to = slot(index, position, idOf(index, edit[position], `\`${position}\``))
    const nodes = adopt(to.parent, parse(contentOf(index, edit)))
    if (!nodes.length) throw new BlockEditError(index, '`content` holds no blocks to add.')
    to.siblings.splice(to.at, 0, ...nodes)
    written.push(...nodes)
  })

  const seen = new Set<string>()
  const check = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      if (seen.has(node.block.id))
        throw new BlockEditError(
          edits.length - 1,
          `block id "${node.block.id}" would be in the document twice. Leave id comments off new blocks; an id is only for the block that already has it.`,
        )
      seen.add(node.block.id)
      check(node.children)
    }
  }
  check(root)
  return {tree: root, written}
}
