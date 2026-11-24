import {Node as PMNode} from 'prosemirror-model'
import {EditorState, Selection, TextSelection, Transaction} from 'prosemirror-state'
import {selectableNodeTypes} from '../../../extensions/Blocks/api/selectable-node-types'
import {getNearestBlockPos} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'
import {fullBlockSelectionPluginKey} from '../../../extensions/FullBlockSelection/FullBlockSelectionPlugin'
import {getNodeById} from '../../util/nodeUtil'

/** Whether the block's own content is empty and only holds its nested blocks, like the paragraph holding a grid. */
function isEmptyHolder(block: PMNode): boolean {
  const content = block.firstChild
  return !!content && !selectableNodeTypes.includes(content.type.name) && content.content.size === 0
}

/**
 * Deletes a selection of whole blocks, such as a shift-click range of cards, by removing exactly those blocks. Deleting
 * it as text would leave empty blocks where the range started.
 */
export function deleteSelectedBlocks(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const {selection} = state
  if (!(selection instanceof TextSelection)) return false
  const {$from, $to} = selection
  if ($from.parent.inlineContent && $to.parent.inlineContent) return false
  const selectedIds = new Set(fullBlockSelectionPluginKey.getState(state)?.blockIds ?? [])
  if (selectedIds.size === 0) return false
  if (!dispatch) return true

  const tr = state.tr
  // Text selected in a block at either end that isn't removed as a whole. The later end goes first, so the earlier
  // end's positions still hold.
  const isTextOutsideSelectedBlocks = (pos: number) =>
    !selectedIds.has(getNearestBlockPos(state.doc, pos).node.attrs.id)
  const fromInText = $from.parent.inlineContent && isTextOutsideSelectedBlocks($from.pos)
  if ($to.parent.inlineContent && isTextOutsideSelectedBlocks($to.pos)) tr.delete($to.start(), $to.pos)
  if (fromInText) tr.delete($from.pos, $from.end())

  const ids: string[] = []
  state.doc.descendants((node) => {
    if (node.type.name === 'blockNode' && selectedIds.has(node.attrs.id)) ids.push(node.attrs.id)
  })
  // Latest first: a block's selected nested blocks come after it, so they are gone before the block itself.
  for (const id of ids.reverse()) {
    const {node, posBeforeNode: pos} = getNodeById(id, tr.doc)
    const nested = node.childCount > 1 ? node.lastChild! : null

    if (nested && nested.childCount > 0) {
      if (!isEmptyHolder(node)) tr.replaceWith(pos, pos + node.nodeSize, nested.content)
      continue
    }

    const $pos = tr.doc.resolve(pos)
    if ($pos.parent.childCount > 1) {
      tr.delete(pos, pos + node.nodeSize)
    } else if ($pos.depth > 1) {
      // The block is its list's only one, so remove the whole list from the block that holds it.
      tr.delete($pos.before($pos.depth), $pos.after($pos.depth))
    } else {
      // The document always keeps a block.
      tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes['blockNode']!.createAndFill()!)
    }
  }

  // Keep a text cursor where it was. Otherwise move to the end of what came before the removed blocks.
  const from = Math.min(tr.mapping.map($from.pos, -1), tr.doc.content.size)
  tr.setSelection(fromInText ? TextSelection.create(tr.doc, from) : Selection.near(tr.doc.resolve(from), -1))
  dispatch(tr.scrollIntoView())
  return true
}
