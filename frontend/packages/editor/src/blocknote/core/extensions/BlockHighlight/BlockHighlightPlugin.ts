import {Node as ProseMirrorNode} from 'prosemirror-model'
import {Plugin, PluginKey, TextSelection} from 'prosemirror-state'
import {Decoration, DecorationSet} from 'prosemirror-view'

import './block-highlight.css'

/** Plugin key used to dispatch highlight actions and retrieve plugin state. */
export const blockHighlightPluginKey = new PluginKey<DecorationSet>('blockHighlightPlugin')

/**
 * Discriminated union of all actions accepted by the block highlight plugin.
 *
 * - `focus`      – highlight a single block, typically driven by URL `#blockId` navigation.
 * - `rangeFocus` – highlight a specific text fragment (codepoint range) inside a single block.
 * - `highlight`  – highlight one or more blocks for citation ranges.
 * - `clear`      – remove all active highlights.
 */
type BlockHighlightAction =
  | {type: 'focus'; blockId: string}
  | {type: 'rangeFocus'; blockId: string; start: number; end: number}
  | {type: 'highlight'; blockIds: string[]}
  | {type: 'clear'}

/**
 * Build a `DecorationSet` that applies `className` to every `blockNode` whose
 * `id` attribute is present in `blockIds`.
 */
function buildDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  blockIds: string[],
  className: string,
): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (node.type.name === 'blockNode' && blockIds.includes(node.attrs['id'] as string)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {class: className}))
    }
  })

  return DecorationSet.create(doc, decorations)
}

/**
 * Locate the `blockContent` child of the `blockNode` with `blockId`, returning
 * the ProseMirror position *before* that content node (so `pos + 1` is the
 * first position inside the block's text) and the content node itself.
 */
function findBlockContent(
  doc: ProseMirrorNode,
  blockId: string,
): {content: ProseMirrorNode; contentBeforePos: number} | null {
  let result: {content: ProseMirrorNode; contentBeforePos: number} | null = null

  doc.descendants((node, pos) => {
    if (result) return false
    if (node.type.name === 'blockNode' && node.attrs['id'] === blockId) {
      const blockBeforePos = pos
      let contentBeforePos = blockBeforePos
      node.forEach((child, offset) => {
        if (child.type.spec.group === 'block') {
          contentBeforePos = blockBeforePos + offset + 1
          result = {content: child, contentBeforePos}
        }
      })
      return false
    }
    return undefined
  })

  return result
}

/**
 * Convert a codepoint offset within a `blockContent` node into a ProseMirror
 * document position. The walker uses each inline child's absolute parent
 * offset (`nodeOffset`) rather than a running counter, so it stays correct
 * when paragraphs split into multiple text children (e.g. when a Bold /
 * Range / Link mark splits the run).
 */
export function codepointOffsetToPos(
  content: ProseMirrorNode,
  contentBeforePos: number,
  codepointOffset: number,
): number {
  const contentStart = contentBeforePos + 1
  if (codepointOffset <= 0) return contentStart

  let codepointsSeen = 0
  let pos = contentStart
  let done = false

  content.forEach((node, nodeOffset) => {
    if (done) return
    // Absolute ProseMirror position of the start of this inline child.
    const nodeAbsStart = contentStart + nodeOffset

    if (node.isText && node.text) {
      const codepoints = Array.from(node.text)
      const remaining = codepointOffset - codepointsSeen
      if (remaining <= codepoints.length) {
        // Target codepoint lands inside this text node — walk codepoints
        // and translate back into a UTF-16 offset.
        const slice = codepoints.slice(0, remaining).join('')
        pos = nodeAbsStart + slice.length
        codepointsSeen = codepointOffset
        done = true
      } else {
        codepointsSeen += codepoints.length
        pos = nodeAbsStart + node.nodeSize
      }
    } else {
      // Non-text inline node (atom, e.g. inline-embed): counts as 1 codepoint.
      const remaining = codepointOffset - codepointsSeen
      if (remaining <= 0) {
        pos = nodeAbsStart
        done = true
      } else if (remaining <= 1) {
        pos = nodeAbsStart + node.nodeSize
        codepointsSeen = codepointOffset
        done = true
      } else {
        codepointsSeen += 1
        pos = nodeAbsStart + node.nodeSize
      }
    }
  })

  return pos
}

/**
 * Creates a ProseMirror plugin that renders CSS-class decorations on
 * `blockNode` elements to implement block focusing and citation highlighting.
 *
 * Dispatch actions via `tr.setMeta(blockHighlightPluginKey, action)`.
 *
 * @example
 * ```ts
 * // Focus a single block (e.g. scrolled-to anchor)
 * view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'focus', blockId: 'abc123'}))
 *
 * // Focus a specific text fragment inside a block
 * view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'rangeFocus', blockId: 'abc123', start: 5, end: 20}))
 *
 * // Highlight a citation range
 * view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'highlight', blockIds: ['abc123', 'def456']}))
 *
 * // Clear all highlights
 * view.dispatch(view.state.tr.setMeta(blockHighlightPluginKey, {type: 'clear'}))
 * ```
 */
export function createBlockHighlightPlugin(): Plugin {
  return new Plugin<DecorationSet>({
    key: blockHighlightPluginKey,

    state: {
      init() {
        return DecorationSet.empty
      },

      apply(tr, oldDecos) {
        const action: BlockHighlightAction | undefined = tr.getMeta(blockHighlightPluginKey)

        if (action) {
          switch (action.type) {
            case 'focus':
              return buildDecorations(tr.doc, [action.blockId], 'bn-block-highlight-focus')

            case 'rangeFocus': {
              const found = findBlockContent(tr.doc, action.blockId)
              if (!found) return DecorationSet.empty
              const from = codepointOffsetToPos(found.content, found.contentBeforePos, action.start)
              const to = codepointOffsetToPos(found.content, found.contentBeforePos, action.end)
              if (to <= from) return DecorationSet.empty
              return DecorationSet.create(tr.doc, [Decoration.inline(from, to, {class: 'bn-range-highlight-focus'})])
            }

            case 'highlight':
              return buildDecorations(tr.doc, action.blockIds, 'bn-block-highlight-citation')

            case 'clear':
              return DecorationSet.empty
          }
        }

        if (tr.selectionSet && tr.selection instanceof TextSelection && !tr.selection.empty) {
          return DecorationSet.empty
        }

        // Keep existing decorations mapped through any document changes.
        return oldDecos.map(tr.mapping, tr.doc)
      },
    },

    props: {
      decorations(state) {
        return blockHighlightPluginKey.getState(state)
      },
    },
  })
}
