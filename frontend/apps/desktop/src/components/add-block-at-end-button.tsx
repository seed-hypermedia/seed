import {getBlockInfoFromPos, slashMenuPluginKey} from '@shm/editor/blocknote/core'
import type {HyperMediaEditor} from '@shm/editor/types'
import {Button} from '@shm/ui/button'
import {Plus} from 'lucide-react'

export function AddBlockAtEndButton({editor}: {editor: HyperMediaEditor}) {
  return (
    <Button
      size="icon"
      variant="outline"
      className="text-muted-foreground hover:bg-primary mt-2 flex size-6 h-7 w-7 min-w-6 scale-95 items-center justify-center rounded-full transition-all hover:scale-110 hover:text-white active:scale-95"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        addBlockAtEnd(editor)
      }}
      title="Add a block"
      aria-label="Add a block at the end of the document"
    >
      <Plus className="size-4" />
    </Button>
  )
}

function addBlockAtEnd(editor: HyperMediaEditor) {
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
        // Delete the entire "/" block
        view.dispatch(state.tr.delete(prevInfo.block.beforePos, prevInfo.block.afterPos))
      }
    }
  }

  // Re-read state after potential cleanup above
  const currentState = view.state
  const currentDoc = currentState.doc

  // Position at the end of the document to find the last block.
  // doc.content.size - 2 resolves inside the last blockChildren, near the last blockNode.
  const lastBlockPos = currentDoc.content.size - 2
  const blockInfo = getBlockInfoFromPos(currentState, lastBlockPos)

  const {blockContent: contentNode, block} = blockInfo

  if (contentNode.node.textContent.length !== 0) {
    // Last block has content — create a new empty paragraph block after it
    const newBlockInsertionPos = block.afterPos
    const newBlockContentPos = newBlockInsertionPos + 2
    ttEditor.chain().BNCreateBlock(newBlockInsertionPos).setTextSelection(newBlockContentPos).run()
  } else {
    // Last block is already empty — just move cursor there
    ttEditor.commands.setTextSelection(block.afterPos - 1)
  }

  // Focus and insert "/" to trigger the slash menu with an inline decoration.
  // Using insertText + triggerCharacter creates a tight inline decoration at the
  // cursor position, so the menu appears left-aligned near the "+" button.
  // The programmatic {activate: true} path creates a node-level decoration that
  // spans the full block width, causing the menu to appear centered.
  view.focus()
  view.dispatch(
    view.state.tr.insertText('/').scrollIntoView().setMeta(slashMenuPluginKey, {
      activate: true,
      triggerCharacter: '/',
    }),
  )
}
