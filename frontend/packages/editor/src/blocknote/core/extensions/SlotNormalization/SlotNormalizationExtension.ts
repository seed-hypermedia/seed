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

export function createSlotNormalizationPlugin(): Plugin {
  return new Plugin({
    key: slotNormalizationPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const fixes = collectSlotFixes(newState.doc)
      if (!fixes.length) return null
      const tr = newState.tr
      applySlotFixes(tr, fixes)
      // Don't push this onto the undo stack as its own step.
      tr.setMeta('addToHistory', false)
      return tr.docChanged ? tr : null
    },
  })
}

// Keeps the document free of malformed slot wrappers after any editing
// operation.
export const SlotNormalizationExtension = Extension.create({
  name: 'slotNormalization',
  addProseMirrorPlugins() {
    return [createSlotNormalizationPlugin()]
  },
})
