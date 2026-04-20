import {getBlockInfoFromPos, slashMenuPluginKey} from './blocknote/core'
import type {HyperMediaEditor} from './types'

/**
 * Append an empty block at the end of the document and open the slash menu on it.
 * Reused by both the "+" button and programmatic entry points (e.g. read-only
 * → edit transition).
 */
export function addBlockAtEnd(editor: HyperMediaEditor) {
  const ttEditor = editor._tiptapEditor
  const view = ttEditor.view
  const state = view.state
  const doc = state.doc

  // The TrailingNode extension always keeps an empty block at the end.
  // After a previous click + dismiss, the doc may look like:
  //   [...blocks, block with "/", empty trailing block]
  // We delete the leftover "/" block so the normal flow reuses the trailing one.
  const topGroup = doc.firstChild
  if (topGroup && topGroup.childCount >= 2) {
    const lastInfo = getBlockInfoFromPos(state, doc.content.size - 2)
    const prevPos = lastInfo.block.beforePos - 1
    if (prevPos > 0) {
      const prevInfo = getBlockInfoFromPos(state, prevPos)
      if (
        prevInfo.block.node !== lastInfo.block.node &&
        prevInfo.blockContent.node.textContent === '/' &&
        lastInfo.blockContent.node.textContent.length === 0
      ) {
        view.dispatch(state.tr.delete(prevInfo.block.beforePos, prevInfo.block.afterPos))
      }
    }
  }

  const currentState = view.state
  const currentDoc = currentState.doc
  const lastBlockPos = currentDoc.content.size - 2
  const blockInfo = getBlockInfoFromPos(currentState, lastBlockPos)

  const {blockContent: contentNode, block} = blockInfo

  if (contentNode.node.textContent.length !== 0) {
    const newBlockInsertionPos = block.afterPos
    const newBlockContentPos = newBlockInsertionPos + 2
    ttEditor.chain().BNCreateBlock(newBlockInsertionPos).setTextSelection(newBlockContentPos).run()
  } else {
    ttEditor.commands.setTextSelection(block.afterPos - 1)
  }

  view.focus()
  view.dispatch(
    view.state.tr.insertText('/').scrollIntoView().setMeta(slashMenuPluginKey, {
      activate: true,
      triggerCharacter: '/',
    }),
  )
}
