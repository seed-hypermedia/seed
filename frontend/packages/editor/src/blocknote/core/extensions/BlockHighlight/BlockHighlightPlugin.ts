import {Node as ProseMirrorNode} from 'prosemirror-model'
import {Plugin, PluginKey} from 'prosemirror-state'
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
 * document position. Inverse of `posToBlockTextOffset` used in the range
 * selection / formatting toolbar code paths.
 */
function codepointOffsetToPos(content: ProseMirrorNode, contentBeforePos: number, codepointOffset: number): number {
  const contentStart = contentBeforePos + 1
  if (codepointOffset <= 0) return contentStart

  let remaining = codepointOffset
  let pos = contentStart

  content.forEach((node) => {
    if (remaining <= 0) return
    if (node.isText && node.text) {
      const codepoints = Array.from(node.text)
      if (remaining >= codepoints.length) {
        pos += node.nodeSize
        remaining -= codepoints.length
      } else {
        // Convert codepoints back to UTF-16 length for ProseMirror's text offset.
        const slice = codepoints.slice(0, remaining).join('')
        pos += slice.length
        remaining = 0
      }
    } else {
      pos += node.nodeSize
      remaining -= 1
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
              return DecorationSet.create(tr.doc, [
                Decoration.inline(from, to, {class: 'bn-range-highlight-focus'}),
              ])
            }

            case 'highlight':
              return buildDecorations(tr.doc, action.blockIds, 'bn-block-highlight-citation')

            case 'clear':
              return DecorationSet.empty
          }
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
