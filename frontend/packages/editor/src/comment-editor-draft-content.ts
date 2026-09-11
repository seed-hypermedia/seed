import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

/** Block types whose content lives in `text` alone, so an empty text means an empty block. */
const TEXT_ONLY_BLOCK_TYPES = new Set(['Paragraph', 'Heading'])

/**
 * Whether initial draft blocks carry anything worth showing expanded. Text and children count,
 * and so do link-bearing or non-text blocks (Embed, Image, File, Query, …) that have no text of
 * their own — an embed-only draft is content, not an empty editor.
 */
export function blocksHaveDraftContent(blocks: HMBlockNode[] | undefined): boolean {
  if (!blocks || blocks.length === 0) return false
  return blocks.some((node) => {
    const block = node.block as {type: string; text?: unknown; link?: unknown}
    if (typeof block.text === 'string' && block.text.trim().length > 0) return true
    if (node.children && node.children.length > 0) return true
    if (typeof block.link === 'string' && block.link.length > 0) return true
    return !TEXT_ONLY_BLOCK_TYPES.has(block.type)
  })
}
