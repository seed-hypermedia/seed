import {Extension} from '@tiptap/core'
import {Node as PMNode} from 'prosemirror-model'
import {Plugin, PluginKey, Transaction} from 'prosemirror-state'

type SlotFix = {from: number; to: number; kind: 'delete'} | {from: number; to: number; kind: 'replace'; nodes: PMNode[]}

function isSlotWrapper(node: PMNode): boolean {
  return node.type.name === 'blockNode' && node.firstChild?.type.name === 'slot'
}

/** A malformed slot wrapper: orphan or a pointless Group slot. */
function orphanOrGroupFix(
  node: PMNode,
  pos: number,
  parent: PMNode | null,
  schema: PMNode['type']['schema'],
): SlotFix | null {
  const paragraphType = schema.nodes['paragraph']
  const blockNodeType = schema.nodes['blockNode']
  const blockChildren = node.childCount === 2 && node.lastChild?.type.name === 'blockChildren' ? node.lastChild : null

  // Orphaned slot: no list to carry.
  if (!blockChildren || blockChildren.childCount === 0) {
    const isSoleChild = parent?.childCount === 1
    if (isSoleChild && paragraphType && blockNodeType) {
      return {
        from: pos,
        to: pos + node.nodeSize,
        kind: 'replace',
        nodes: [blockNodeType.create(null, paragraphType.create())],
      }
    }
    return {from: pos, to: pos + node.nodeSize, kind: 'delete'}
  }

  // Group slot: the wrapper is pointless, unwrap its items in place.
  if (blockChildren.attrs.listType === 'Group') {
    const items: PMNode[] = []
    blockChildren.forEach((child) => items.push(child))
    return {from: pos, to: pos + node.nodeSize, kind: 'replace', nodes: items}
  }

  return null
}

/**
 * A Slot not directly under the root must be unwrapped: flatten into a same-type
 * list, nest under the previous block, or front the list with an empty paragraph.
 */
function nonRootUnwrapFix(
  node: PMNode,
  pos: number,
  parent: PMNode,
  index: number,
  schema: PMNode['type']['schema'],
): SlotFix | null {
  const blockNodeType = schema.nodes['blockNode']
  const paragraphType = schema.nodes['paragraph']
  const list = node.lastChild
  if (!blockNodeType || !paragraphType || !list || list.type.name !== 'blockChildren') return null

  // Directly inside a same-grouping list so flatten items into that list.
  if (
    parent.type.name === 'blockChildren' &&
    parent.attrs.listType !== 'Group' &&
    parent.attrs.listType === list.attrs.listType
  ) {
    const items: PMNode[] = []
    list.forEach((it) => items.push(it))
    return {from: pos, to: pos + node.nodeSize, kind: 'replace', nodes: items}
  }

  const prev = index > 0 ? parent.child(index - 1) : null
  const prevMergeable =
    !!prev &&
    prev.type.name === 'blockNode' &&
    prev.childCount === 1 &&
    prev.firstChild?.type.spec?.group === 'block' &&
    prev.firstChild?.type.name !== 'table'

  if (prevMergeable) {
    const prevStart = pos - prev!.nodeSize
    return {
      from: prevStart,
      to: pos + node.nodeSize,
      kind: 'replace',
      nodes: [blockNodeType.create(prev!.attrs, [prev!.firstChild!, list])],
    }
  }
  return {
    from: pos,
    to: pos + node.nodeSize,
    kind: 'replace',
    nodes: [blockNodeType.create(node.attrs, [paragraphType.create(), list])],
  }
}

function sameSlotGrouping(a: PMNode, b: PMNode): boolean {
  const ga = a.lastChild
  const gb = b.lastChild
  return (
    ga?.type.name === 'blockChildren' &&
    gb?.type.name === 'blockChildren' &&
    ga.attrs.listType !== 'Group' &&
    ga.attrs.listType === gb.attrs.listType
  )
}

/**
 * If a blockChildren has two directly adjacent slot wrappers with the same
 * grouping, return the range whose deletion merges their item lists into one.
 */
function seamForBlockChildren(node: PMNode, pos: number): {from: number; to: number} | null {
  let childStart = pos + 1
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (i > 0) {
      const prev = node.child(i - 1)
      if (isSlotWrapper(prev) && isSlotWrapper(child) && sameSlotGrouping(prev, child)) {
        const prevStart = childStart - prev.nodeSize
        const items1Size = prev.lastChild!.content.size
        return {from: prevStart + 3 + items1Size, to: childStart + 3}
      }
    }
    childStart += child.nodeSize
  }
  return null
}

/** All orphan / Group slot fixes in the document. */
export function collectSlotFixes(doc: PMNode): SlotFix[] {
  const fixes: SlotFix[] = []
  doc.descendants((node, pos, parent) => {
    if (!isSlotWrapper(node)) return true
    const fix = orphanOrGroupFix(node, pos, parent, doc.type.schema)
    if (fix) {
      fixes.push(fix)
      return false
    }
    return true
  })
  return fixes
}

/** The edit for the first Slot that isn't a direct child of root. */
export function firstNonRootSlotUnwrap(doc: PMNode): SlotFix | null {
  const root = doc.firstChild
  let fix: SlotFix | null = null
  doc.descendants((node, pos, parent, index) => {
    if (fix) return false
    if (!isSlotWrapper(node)) return true
    if (parent === root) return true
    fix = nonRootUnwrapFix(node, pos, parent!, index, doc.type.schema)
    return false
  })
  return fix
}

/** The seam range for the first pair of adjacent same grouping slots. */
export function firstSlotMergeSeam(doc: PMNode): {from: number; to: number} | null {
  let seam: {from: number; to: number} | null = null
  doc.descendants((node, pos) => {
    if (seam) return false
    if (node.type.name !== 'blockChildren') return true
    seam = seamForBlockChildren(node, pos)
    return !seam
  })
  return seam
}

/** Apply the collected fixes to a transaction (back-to-front to keep positions valid). */
export function applySlotFixes(tr: Transaction, fixes: SlotFix[]): boolean {
  if (!fixes.length) return false
  fixes.sort((a, b) => b.from - a.from)
  for (const fix of fixes) {
    if (fix.kind === 'delete') tr.delete(fix.from, fix.to)
    else tr.replaceWith(fix.from, fix.to, fix.nodes)
  }
  return true
}

type SlotAction = {fix: SlotFix} | {seam: {from: number; to: number}}

function nextSlotAction(doc: PMNode): SlotAction | null {
  const root = doc.firstChild
  let fix: SlotFix | null = null
  let seam: {from: number; to: number} | null = null

  doc.descendants((node, pos, parent, index) => {
    if (fix) return false

    // Remember the first merge seam, but keep scanning for a higher-priority fix.
    if (!seam && node.type.name === 'blockChildren') {
      seam = seamForBlockChildren(node, pos)
      return true
    }

    if (isSlotWrapper(node)) {
      fix = orphanOrGroupFix(node, pos, parent, doc.type.schema)
      if (fix) return false
      if (parent !== root) {
        fix = nonRootUnwrapFix(node, pos, parent!, index, doc.type.schema)
        return false // non root slot handled, don't descend
      }
      return true // valid root slot, descend to catch nested slots
    }
    return true
  })

  if (fix) return {fix}
  if (seam) return {seam}
  return null
}

function nodeContainsSlot(node: PMNode): boolean {
  let found = false
  node.descendants((n) => {
    if (found) return false
    if (n.type.name === 'slot') {
      found = true
      return false
    }
    return true
  })
  return found
}

function transactionAddsSlot(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const slice = (step as {slice?: {content: PMNode}}).slice
    return !!slice && nodeContainsSlot(slice.content as unknown as PMNode)
  })
}

export const slotNormalizationPluginKey = new PluginKey<boolean>('slotNormalization')

/**
 * @param isSuppressed Optional guard returning true while the document is being
 *   loaded or rebased programmatically. Normalization must not run then, as it
 *   would rewrite and/or delete block IDs from the content.
 */
export function createSlotNormalizationPlugin(isSuppressed?: () => boolean): Plugin<boolean> {
  return new Plugin<boolean>({
    key: slotNormalizationPluginKey,
    // Track whether the document contains any slot, which triggers the plugin loop.
    state: {
      init: (_config, editorState) => nodeContainsSlot(editorState.doc),
      apply: (tr, hasSlot: boolean) => {
        if (hasSlot || !tr.docChanged) return hasSlot
        return transactionAddsSlot(tr)
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (isSuppressed?.()) return null
      if (!transactions.some((tr) => tr.docChanged)) return null
      if (!slotNormalizationPluginKey.getState(newState)) return null

      const tr = newState.tr
      let changed = false
      for (let guard = 0; guard < 1000; guard++) {
        const action = nextSlotAction(tr.doc)
        if (!action) break
        if ('fix' in action) applySlotFixes(tr, [action.fix])
        else tr.delete(action.seam.from, action.seam.to)
        changed = true
      }

      if (!changed) return null
      return tr.docChanged ? tr : null
    },
  })
}

// Keeps the document free of malformed slot wrappers, and merges adjacent
// same-grouping slots, after any user editing operation. Skips programmatic
// load/rebase transactions so it never rewrites content.
export const SlotNormalizationExtension = Extension.create<{editor?: {_suppressChangeRef?: {current: boolean}}}>({
  name: 'slotNormalization',
  addProseMirrorPlugins() {
    const editor = this.options.editor
    return [createSlotNormalizationPlugin(() => !!editor?._suppressChangeRef?.current)]
  },
})
