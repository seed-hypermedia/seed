import {BlockNoteEditor} from '../../../BlockNoteEditor'
import {
  Block,
  BlockIdentifier,
  BlockSchema,
} from '../../../extensions/Blocks/api/blockTypes'
import {removeAndInsertBlocks} from './replaceBlocks'

export function newRemoveBlocks<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blocksToRemove: BlockIdentifier[],
): Block<BSchema>[] {
  return removeAndInsertBlocks(editor, blocksToRemove, []).removedBlocks
}
