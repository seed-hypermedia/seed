import {useEffect} from 'react'
import type {BlockNoteEditor} from '../../core/BlockNoteEditor'
import type {BlockSchema} from '../../core/extensions/Blocks/api/blockTypes'

/**
 * Headless React component that subscribes to the FullBlockSelection plugin
 * and calls the `onBlocksFullSelected` callback whenever the set of
 * fully-selected blocks changes.
 *
 * Renders no DOM — consumers use this state for actions like fragment links
 * and block dragging.
 */
export function FullBlockSelectionObserver<BSchema extends BlockSchema>({
  editor,
  onBlocksFullSelected,
}: {
  editor: BlockNoteEditor<BSchema>
  onBlocksFullSelected?: (blockIds: string[]) => void
}) {
  useEffect(() => {
    const plugin = editor.fullBlockSelection
    if (!plugin || !onBlocksFullSelected) return

    return plugin.onUpdate((state) => {
      onBlocksFullSelected(state.blockIds)
    })
  }, [editor, onBlocksFullSelected])

  return null
}
