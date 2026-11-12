import {BlockNoteEditor} from '../../BlockNoteEditor'
import {SuggestionItem} from '../../shared/plugins/suggestion/SuggestionItem'
import {BlockSchema} from '../Blocks/api/blockTypes'
import {DefaultBlockSchema} from '../Blocks/api/defaultBlocks'

/** A slash menu command. */
export type BaseSlashMenuItem<BSchema extends BlockSchema = DefaultBlockSchema> = SuggestionItem & {
  execute: (editor: BlockNoteEditor<BSchema>) => void
  aliases?: string[]
  /** Hides the item when it returns false for the current editor state. */
  isAvailable?: (editor: BlockNoteEditor<BSchema>) => boolean
}

/** Returns whether a slash menu item can be offered at the current cursor position. */
export function isSlashMenuItemAvailable<BSchema extends BlockSchema>(
  item: Pick<BaseSlashMenuItem<BSchema>, 'isAvailable'>,
  editor: BlockNoteEditor<BSchema>,
) {
  return !item.isAvailable || item.isAvailable(editor)
}
