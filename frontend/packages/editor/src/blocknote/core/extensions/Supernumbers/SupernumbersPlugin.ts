import {Plugin, PluginKey} from 'prosemirror-state'
import {Decoration, DecorationSet} from 'prosemirror-view'

import './supernumbers.css'

/** Plugin key used to dispatch supernumbers actions and retrieve plugin state. */
export const supernumbersPluginKey = new PluginKey<SupernumbersPluginState>('supernumbersPlugin')

/** Citation and comment counts for a single block. */
export type BlockInteractionCounts = {
  citations: number
  comments: number
}

/** Map of blockId to interaction counts. */
export type SupernumbersData = Record<string, BlockInteractionCounts>

/**
 * Discriminated union of all actions accepted by the supernumbers plugin.
 *
 * - `setData` – replace the full counts map (called when citation/comment data loads or updates).
 * - `clear`   – remove all badges.
 */
type SupernumbersAction = {type: 'setData'; data: SupernumbersData} | {type: 'clear'}

/** Internal plugin state holding both the data map and the computed decoration set. */
type SupernumbersPluginState = {
  data: SupernumbersData
  decorations: DecorationSet
}

/**
 * Build a `DecorationSet` that renders a badge widget inside every `blockNode`
 * whose id has a non-zero citation or comment count.
 *
 * Badges are DOM `<button>` elements positioned via CSS (absolute, top-right of
 * the containing block). A `data-block-id` attribute is set on each so that
 * click listeners can identify which block was activated.
 */
function buildDecorations(doc: Parameters<typeof DecorationSet.create>[0], data: SupernumbersData): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockNode') return

    const blockId = node.attrs['id'] as string | undefined
    if (!blockId) return

    const counts = data[blockId]
    if (!counts) return

    const total = counts.citations + counts.comments
    if (total <= 0) return

    const widget = document.createElement('button')
    widget.className = 'bn-supernumber-badge'
    widget.textContent = String(total)
    widget.dataset.blockId = blockId

    // Place the widget at the end of the blockNode (just before its closing
    // tag) so it is the *last* child of the block's DOM element.  Placing it
    // at pos + 1 would make it the first child, which breaks the SideMenu
    // plugin that relies on `blockNode.firstChild` being the blockContent.
    decorations.push(Decoration.widget(pos + node.nodeSize - 1, widget, {side: -1, key: blockId}))
  })

  return DecorationSet.create(doc, decorations)
}

/**
 * Creates a ProseMirror plugin that renders citation/comment count badges on
 * blocks that have interaction data.
 *
 * Dispatch actions via `tr.setMeta(supernumbersPluginKey, action)`:
 *
 * @example
 * ```ts
 * // Load or update counts
 * view.dispatch(
 *   view.state.tr.setMeta(supernumbersPluginKey, {
 *     type: 'setData',
 *     data: {'block-abc': {citations: 3, comments: 1}},
 *   })
 * )
 *
 * // Clear all badges
 * view.dispatch(view.state.tr.setMeta(supernumbersPluginKey, {type: 'clear'}))
 * ```
 */
export function createSupernumbersPlugin(): Plugin<SupernumbersPluginState> {
  return new Plugin<SupernumbersPluginState>({
    key: supernumbersPluginKey,

    state: {
      init(_config, state) {
        return {data: {}, decorations: buildDecorations(state.doc, {})}
      },

      apply(tr, pluginState) {
        const action: SupernumbersAction | undefined = tr.getMeta(supernumbersPluginKey)

        if (action) {
          switch (action.type) {
            case 'setData': {
              const data = action.data
              return {data, decorations: buildDecorations(tr.doc, data)}
            }
            case 'clear':
              return {data: {}, decorations: DecorationSet.empty}
          }
        }

        // When the document changes but no action was dispatched, map existing
        // decorations through the change so positions stay valid. Rebuild from
        // scratch only when the doc itself changed so block IDs may have shifted.
        if (tr.docChanged) {
          return {
            data: pluginState.data,
            decorations: buildDecorations(tr.doc, pluginState.data),
          }
        }

        return {
          data: pluginState.data,
          decorations: pluginState.decorations.map(tr.mapping, tr.doc),
        }
      },
    },

    props: {
      decorations(state) {
        return supernumbersPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
  })
}
