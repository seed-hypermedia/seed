import {BlockNoteEditor, BlockSchema} from './blocknote/core'
import {Block, PartialBlock} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {InlineContent} from './blocknote/core/extensions/Blocks/api/inlineContentTypes'

/**
 * Returns the blocks currently covered by the editor's selection. A ranged
 * selection that touches a block at any position counts the whole block.
 */
export function getSelectedFullBlocks<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
): Block<BSchema>[] | null {
  const ranged = editor.getSelection()
  if (ranged && ranged.blocks.length > 0) return ranged.blocks as Block<BSchema>[]

  const cursor = editor.getTextCursorPosition()
  if (cursor?.block) return [cursor.block as Block<BSchema>]
  return null
}

/** Flattens a block's inline content to its plain text. Skips inline embeds. */
export function blockToPlainText<BSchema extends BlockSchema>(block: Block<BSchema>): string {
  const content = (block as unknown as {content?: InlineContent[]}).content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const node of content) {
    if (node.type === 'text') out += node.text
    else if (node.type === 'link') out += node.content.map((c) => c.text).join('')
  }
  return out
}

/**
 * Picks a draft name from the first content-bearing block.
 * Used when "Turn into doc" creates a new draft from selected blocks
 */
export function deriveDraftNameFromBlocks<BSchema extends BlockSchema>(blocks: Block<BSchema>[], maxLen = 60): string {
  for (const block of blocks) {
    const text = blockToPlainText(block).trim()
    if (!text) continue
    return text.length > maxLen ? text.slice(0, maxLen).trimEnd() : text
  }
  return ''
}

/**
 * Mutates the editor to replace the given blocks with a single draft-embed
 * placeholder.
 */
export function replaceBlocksWithDraftEmbed<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blocks: Block<BSchema>[],
  draftId: string,
): void {
  const firstBlock = blocks[0]
  if (!firstBlock) return
  const firstId = firstBlock.id
  const ids = blocks.map((b) => b.id)
  const embed: PartialBlock<BSchema> = {
    type: 'embed',
    props: {draftId, url: '', view: 'Card'},
  } as unknown as PartialBlock<BSchema>
  editor.insertBlocks([embed], firstId, 'before')
  editor.removeBlocks(ids)
}
