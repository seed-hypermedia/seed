import {Extension} from '@tiptap/core'
import {Node as PMNode} from 'prosemirror-model'
import {Plugin, PluginKey, Transaction} from 'prosemirror-state'

type SlotFix = {from: number; to: number; kind: 'delete'} | {from: number; to: number; kind: 'replace'; nodes: PMNode[]}

function isSlotWrapper(node: PMNode): boolean {
  return node.type.name === 'blockNode' && node.firstChild?.type.name === 'slot'
}

/**
 * Scan the document for invalid slot wrappers and return the edits that fix
 * them.
 */
export function collectSlotFixes(doc: PMNode): SlotFix[] {
  const fixes: SlotFix[] = []
  const paragraphType = doc.type.schema.nodes['paragraph']
  const blockNodeType = doc.type.schema.nodes['blockNode']

  doc.descendants((node, pos, parent) => {
    if (!isSlotWrapper(node)) return true

    const blockChildren = node.childCount === 2 && node.lastChild?.type.name === 'blockChildren' ? node.lastChild : null

    // Orphaned slot: no list to carry.
    if (!blockChildren || blockChildren.childCount === 0) {
      const isSoleChild = parent?.childCount === 1
      if (isSoleChild && paragraphType && blockNodeType) {
        fixes.push({
          from: pos,
          to: pos + node.nodeSize,
          kind: 'replace',
          nodes: [blockNodeType.create(null, paragraphType.create())],
        })
      } else {
        fixes.push({from: pos, to: pos + node.nodeSize, kind: 'delete'})
      }
      return false
    }

    // Group slot: the wrapper is pointless, unwrap its items in place.
    if (blockChildren.attrs.listType === 'Group') {
      const items: PMNode[] = []
      blockChildren.forEach((child) => items.push(child))
      fixes.push({from: pos, to: pos + node.nodeSize, kind: 'replace', nodes: items})
      return false
    }

    return true
  })

  return fixes
}

// Check if two slots have the same group type.
function sameSlotGrouping(a: PMNode, b: PMNode): boolean {
  const ga = a.lastChild
  const gb = b.lastChild
  return (
    ga?.type.name === 'blockChildren' &&
    gb?.type.name === 'blockChildren' &&
    ga.attrs.listType !== 'Group' &&
    ga.attrs.listType === gb.attrs.listType &&
    ga.attrs.listLevel === gb.attrs.listLevel
  )
}

/**
 * Find the first pair of adjacent slot wrappers with the same grouping
 * and return the range between them for deletion that merges them.
 */
export function firstSlotMergeSeam(doc: PMNode): {from: number; to: number} | null {
  let seam: {from: number; to: number} | null = null
  doc.descendants((node, pos) => {
    if (seam) return false
    if (node.type.name !== 'blockChildren') return true
    let childStart = pos + 1
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (i > 0) {
        const prev = node.child(i - 1)
        if (isSlotWrapper(prev) && isSlotWrapper(child) && sameSlotGrouping(prev, child)) {
          const prevStart = childStart - prev.nodeSize
          const items1Size = prev.lastChild!.content.size
          // seamStart: just after the first slot's items.
          // seamEnd: just before the second slot's items.
          seam = {from: prevStart + 3 + items1Size, to: childStart + 3}
          return false
        }
      }
      childStart += child.nodeSize
    }
    return true
  })
  return seam
}

/**
 * A Slot that is not in the root group is unnecessary and must be unwrapped
 * into a normal nested list. Returns the edit for the first such Slot, or null.
 */
export function firstNonRootSlotUnwrap(doc: PMNode): SlotFix | null {
  const root = doc.firstChild // the root blockChildren
  const blockNodeType = doc.type.schema.nodes['blockNode']
  const paragraphType = doc.type.schema.nodes['paragraph']
  if (!blockNodeType || !paragraphType) return null

  let fix: SlotFix | null = null
  doc.descendants((node, pos, parent, index) => {
    if (fix) return false
    if (!isSlotWrapper(node)) return true
    if (parent === root) return true

    const list = node.lastChild
    if (!list || list.type.name !== 'blockChildren') return false // orphan; handled elsewhere

    // If the Slot sits directly inside a list of the same grouping,
    // flatten its items into that list.
    if (
      parent!.type.name === 'blockChildren' &&
      parent!.attrs.listType !== 'Group' &&
      parent!.attrs.listType === list.attrs.listType
    ) {
      const items: PMNode[] = []
      list.forEach((it) => items.push(it))
      fix = {from: pos, to: pos + node.nodeSize, kind: 'replace', nodes: items}
      return false
    }

    const prev = index > 0 ? parent!.child(index - 1) : null
    const prevMergeable =
      !!prev &&
      prev.type.name === 'blockNode' &&
      prev.childCount === 1 &&
      prev.firstChild?.type.spec?.group === 'block' &&
      // A table can't carry a nested list.
      prev.firstChild?.type.name !== 'table'

    if (prevMergeable) {
      const prevStart = pos - prev!.nodeSize
      fix = {
        from: prevStart,
        to: pos + node.nodeSize,
        kind: 'replace',
        nodes: [blockNodeType.create(prev!.attrs, [prev!.firstChild!, list])],
      }
    } else {
      fix = {
        from: pos,
        to: pos + node.nodeSize,
        kind: 'replace',
        nodes: [blockNodeType.create(node.attrs, [paragraphType.create(), list])],
      }
    }
    return false
  })
  return fix
}

/** Apply the collected fixes to a transaction. */
export function applySlotFixes(tr: Transaction, fixes: SlotFix[]): boolean {
  if (!fixes.length) return false
  fixes.sort((a, b) => b.from - a.from)
  for (const fix of fixes) {
    if (fix.kind === 'delete') tr.delete(fix.from, fix.to)
    else tr.replaceWith(fix.from, fix.to, fix.nodes)
  }
  return true
}

export const slotNormalizationPluginKey = new PluginKey('slotNormalization')

/**
 * @param isSuppressed Optional guard returning true while the document is being
 *   loaded or rebased programmatically. Normalization must not run then, as it
 *   would rewrite and/or delete block IDs from the content.
 */
export function createSlotNormalizationPlugin(isSuppressed?: () => boolean): Plugin {
  return new Plugin({
    key: slotNormalizationPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (isSuppressed?.()) return null
      if (!transactions.some((tr) => tr.docChanged)) return null
      const tr = newState.tr
      let changed = false
      for (let guard = 0; guard < 1000; guard++) {
        // Repair malformed slots.
        const fixes = collectSlotFixes(tr.doc)
        if (fixes.length) {
          applySlotFixes(tr, fixes)
          changed = true
          continue
        }
        // Unwrap any Slot that isn't a direct child of root.
        const unwrap = firstNonRootSlotUnwrap(tr.doc)
        if (unwrap) {
          applySlotFixes(tr, [unwrap])
          changed = true
          continue
        }
        // Merge one pair of adjacent same group root slots, then re-scan.
        const seam = firstSlotMergeSeam(tr.doc)
        if (seam) {
          tr.delete(seam.from, seam.to)
          changed = true
          continue
        }
        break
      }

      if (!changed) return null
      return tr.docChanged ? tr : null
    },
  })
}

// Keeps the document free of malformed slot wrappers, and merges adjacent
// same-grouping slots, after any user editing operation.
export const SlotNormalizationExtension = Extension.create<{editor?: {_suppressChangeRef?: {current: boolean}}}>({
  name: 'slotNormalization',
  addProseMirrorPlugins() {
    const editor = this.options.editor
    return [createSlotNormalizationPlugin(() => !!editor?._suppressChangeRef?.current)]
  },
})
