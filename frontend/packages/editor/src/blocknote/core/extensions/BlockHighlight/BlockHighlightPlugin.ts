import {Plugin, PluginKey} from 'prosemirror-state'
import {Decoration, DecorationSet} from 'prosemirror-view'

import './block-highlight.css'

/** Plugin key used to dispatch highlight actions and retrieve plugin state. */
export const blockHighlightPluginKey = new PluginKey<DecorationSet>('blockHighlightPlugin')

/**
 * Discriminated union of all actions accepted by the block highlight plugin.
 *
 * - `focus`     – highlight a single block, typically driven by URL `#blockId` navigation.
 * - `highlight` – highlight one or more blocks for citation ranges.
 * - `clear`     – remove all active highlights.
 */
type BlockHighlightAction = {type: 'focus'; blockId: string} | {type: 'highlight'; blockIds: string[]} | {type: 'clear'}

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
