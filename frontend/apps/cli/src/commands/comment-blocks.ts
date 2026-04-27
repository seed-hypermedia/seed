/**
 * Comment block parsing helpers.
 *
 * Kept in a side-effect-free module so it can be imported by unit tests
 * without pulling in the CLI program (which is registered as a side effect
 * of importing `../index`).
 */

import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

/**
 * Parse comment text as Markdown into Seed block nodes, reusing the same
 * parser that `document create` uses. Inline formatting (bold, italic,
 * code, `[label](url)` links, `<autolinks>`) becomes annotations on
 * Paragraph blocks; block-level structures (headings, lists, code fences)
 * become their respective block types. Empty input collapses to a single
 * empty Paragraph so the comment still has at least one block.
 */
export function textToBlocks(text: string, idFactory: () => string): HMBlockNode[] {
  if (!text.trim()) {
    return [emptyParagraph(idFactory())]
  }

  const {tree} = parseMarkdown(text)
  const blocks = markdownBlockNodesToHMBlockNodes(tree)

  if (blocks.length === 0) {
    return [emptyParagraph(idFactory())]
  }

  return blocks
}

function emptyParagraph(id: string): HMBlockNode {
  return {
    block: {
      id,
      type: 'Paragraph',
      text: '',
      attributes: {},
      annotations: [],
    },
    children: [],
  }
}
