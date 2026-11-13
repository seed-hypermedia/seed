import {TextSelection} from 'prosemirror-state'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {getNodeById} from './blocknote/core/api/util/nodeUtil'
import {BlockSchema, PartialBlock} from './blocknote/core/extensions/Blocks/api/blockTypes'

/**
 * Replaces the whole editor content while preserving the caret inside the same
 * block at the same offset when that block still exists after the replacement.
 *
 * Callers that batch programmatic edits should wrap this in their own
 * change-suppression; this helper does none.
 */
export function replaceEditorContent<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blocks: PartialBlock<BSchema>[],
): void {
  const state = editor._tiptapEditor.view.state
  const $head = state.selection.$head

  let blockId: string | undefined
  let offset = 0
  for (let depth = $head.depth; depth >= 0; depth--) {
    if ($head.node(depth).type.name === 'blockNode') {
      blockId = $head.node(depth).attrs.id
      offset = $head.pos - $head.before(depth)
      break
    }
  }

  editor.replaceBlocks(editor.topLevelBlocks, blocks.length ? blocks : [{type: 'paragraph'}])

  if (blockId === undefined) return

  try {
    const {node, posBeforeNode} = getNodeById(blockId, editor._tiptapEditor.state.doc)
    const clamped = Math.min(Math.max(posBeforeNode + offset, posBeforeNode + 1), posBeforeNode + node.nodeSize - 1)
    const newState = editor._tiptapEditor.view.state
    editor._tiptapEditor.view.dispatch(newState.tr.setSelection(TextSelection.near(newState.doc.resolve(clamped))))
  } catch {
    // The block no longer exists; keep ProseMirror's mapped selection.
  }
}
