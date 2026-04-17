import {EditorState, NodeSelection, Plugin, PluginKey, PluginView, TextSelection} from 'prosemirror-state'
import {Decoration, DecorationSet, EditorView} from 'prosemirror-view'
import {Node} from 'prosemirror-model'

import {BlockNoteEditor} from '../../BlockNoteEditor'
import {EventEmitter} from '../../shared/EventEmitter'
import {BlockSchema} from '../Blocks/api/blockTypes'
import {getBlockInfoWithManualOffset} from '../Blocks/helpers/getBlockInfoFromPos'
import {MultipleNodeSelection} from '../SideMenu/MultipleNodeSelection'

import './full-block-selection.css'

/**
 * The state emitted to React subscribers whenever the set of fully-selected
 * blocks changes.
 */
export type FullBlockSelectionState = {
  /** IDs of blocks whose content is fully covered by the current selection. */
  blockIds: string[]
}

/** Internal EventEmitter event map. */
type FullBlockSelectionEvents = {
  update: [FullBlockSelectionState]
}

/** Combined plugin state: block IDs for the callback + decorations for the CSS class. */
type PluginState = {
  blockIds: string[]
  decorations: DecorationSet
}

/** ProseMirror plugin key for the FullBlockSelection plugin. */
export const fullBlockSelectionPluginKey = new PluginKey<PluginState>('FullBlockSelectionPlugin')

const DECORATION_CLASS = 'bn-full-block-selected'

/**
 * Detect which blocks have their entire text content covered by the current
 * selection. Returns an array of block IDs.
 */
function detectFullySelectedBlocks(state: EditorState): string[] {
  const {selection} = state
  const fullySelected: string[] = []

  if (selection.empty) return fullySelected

  // MultipleNodeSelection: each node in the selection is a fully-selected block.
  if (selection instanceof MultipleNodeSelection) {
    for (const node of selection.nodes) {
      if (node.type.name === 'blockNode' || node.type.isInGroup('blockNodeChild')) {
        const id = node.attrs['id'] as string | undefined
        if (id) fullySelected.push(id)
      }
    }
    return fullySelected
  }

  // NodeSelection: the selected node itself (or its parent block) is fully selected.
  if (selection instanceof NodeSelection) {
    const node = selection.node
    if (node.type.name === 'blockNode' || node.type.isInGroup('blockNodeChild')) {
      const id = node.attrs['id'] as string | undefined
      if (id) fullySelected.push(id)
    } else if (node.type.spec.group === 'block') {
      // Selected node is a blockContent — find the parent blockNode.
      const $pos = state.doc.resolve(selection.from)
      for (let depth = $pos.depth; depth > 0; depth--) {
        const ancestor = $pos.node(depth)
        if (ancestor.type.name === 'blockNode' || ancestor.type.isInGroup('blockNodeChild')) {
          const id = ancestor.attrs['id'] as string | undefined
          if (id) fullySelected.push(id)
          break
        }
      }
    }
    return fullySelected
  }

  // TextSelection: check each block in the selection range.
  if (selection instanceof TextSelection) {
    const {from, to} = selection

    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== 'blockNode') return true // keep descending

      try {
        const blockInfo = getBlockInfoWithManualOffset(node, pos)
        const contentStart = blockInfo.blockContent.beforePos + 1
        const contentEnd = blockInfo.blockContent.afterPos - 1

        if (from <= contentStart && to >= contentEnd) {
          const id = node.attrs['id'] as string | undefined
          if (id) fullySelected.push(id)
        }
      } catch {
        // Not a valid block structure — skip.
      }

      // Continue descending to check nested blocks independently.
      return true
    })

    return fullySelected
  }

  // AllSelection or unknown: walk the entire doc.
  state.doc.descendants((node) => {
    if (node.type.name === 'blockNode') {
      const id = node.attrs['id'] as string | undefined
      if (id) fullySelected.push(id)
      return false // don't collect nested blocks inside this blockNode
    }
    return true
  })

  return fullySelected
}

/**
 * Build a DecorationSet applying the full-block-selected CSS class to every
 * blockNode whose ID is in the given set.
 */
function buildDecorations(doc: Node, blockIds: string[]): DecorationSet {
  if (blockIds.length === 0) return DecorationSet.empty

  const idSet = new Set(blockIds)
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (node.type.name === 'blockNode' && idSet.has(node.attrs['id'] as string)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {class: DECORATION_CLASS}))
    }
  })

  return DecorationSet.create(doc, decorations)
}

/** Shallow equality check for string arrays. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * PluginView that watches for changes in the plugin state and emits events to
 * React subscribers via the EventEmitter.
 *
 * @internal
 */
class FullBlockSelectionView implements PluginView {
  private prevBlockIds: string[] = []

  constructor(
    private readonly pmView: EditorView,
    private readonly onUpdate: (state: FullBlockSelectionState) => void,
  ) {}

  update(view: EditorView) {
    const pluginState = fullBlockSelectionPluginKey.getState(view.state)
    if (!pluginState) return

    const {blockIds} = pluginState
    if (!arraysEqual(this.prevBlockIds, blockIds)) {
      this.prevBlockIds = blockIds
      this.onUpdate({blockIds})
    }
  }

  destroy() {
    // Emit empty state on teardown so subscribers can clean up.
    if (this.prevBlockIds.length > 0) {
      this.onUpdate({blockIds: []})
    }
  }
}

/**
 * ProseMirror plugin that detects when the user's selection fully covers a
 * block's text content, applies a CSS decoration, and emits events for React
 * consumption.
 *
 * @example
 * ```ts
 * const plugin = new FullBlockSelectionProsemirrorPlugin(editor)
 * plugin.onUpdate((state) => {
 *   console.log('fully selected blocks:', state.blockIds)
 * })
 * ```
 */
export class FullBlockSelectionProsemirrorPlugin<
  BSchema extends BlockSchema,
> extends EventEmitter<FullBlockSelectionEvents> {
  /** The raw ProseMirror plugin to register in the editor's plugin list. */
  public readonly plugin: Plugin

  constructor(_editor: BlockNoteEditor<BSchema>) {
    super()

    this.plugin = new Plugin<PluginState>({
      key: fullBlockSelectionPluginKey,

      state: {
        init(_, state) {
          const blockIds = detectFullySelectedBlocks(state)
          return {
            blockIds,
            decorations: buildDecorations(state.doc, blockIds),
          }
        },

        apply(tr, prev, _oldState, newState) {
          // Only recompute when the selection or document changed.
          if (!tr.selectionSet && !tr.docChanged) return prev

          const blockIds = detectFullySelectedBlocks(newState)

          if (arraysEqual(blockIds, prev.blockIds)) {
            // Block IDs unchanged — just map decorations through doc changes.
            return {
              blockIds: prev.blockIds,
              decorations: tr.docChanged ? prev.decorations.map(tr.mapping, tr.doc) : prev.decorations,
            }
          }

          return {
            blockIds,
            decorations: buildDecorations(newState.doc, blockIds),
          }
        },
      },

      props: {
        decorations(state) {
          return fullBlockSelectionPluginKey.getState(state)?.decorations ?? DecorationSet.empty
        },
      },

      view: (editorView) => {
        return new FullBlockSelectionView(editorView, (state) => {
          this.emit('update', state)
        })
      },
    })
  }

  /**
   * Subscribes to full-block-selection state updates. Returns an unsubscribe
   * function that should be called on cleanup (e.g. in a React useEffect return).
   */
  public onUpdate(callback: (state: FullBlockSelectionState) => void): () => void {
    return this.on('update', callback)
  }
}
