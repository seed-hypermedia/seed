import {isTextSelection, posToDOMRect} from '@tiptap/core'
import {PluginView} from '@tiptap/pm/state'
import {Plugin, PluginKey} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {BlockNoteEditor} from '../../BlockNoteEditor'
import {EventEmitter} from '../../shared/EventEmitter'
import {BlockSchema} from '../Blocks/api/blockTypes'
import {getNearestBlockPos} from '../Blocks/helpers/getBlockInfoFromPos'

/**
 * The state emitted to React subscribers whenever the text selection changes in
 * read-only mode.  `show` is false when nothing is selected or the editor is
 * editable (edit mode has its own formatting toolbar).
 */
export type RangeSelectionState = {
  show: boolean
  /** The `data-id` of the blockNode that contains the selection start. */
  blockId: string | null
  /** Unicode codepoint offset of the selection start within the block's text content. */
  rangeStart: number | null
  /** Unicode codepoint offset of the selection end within the block's text content. */
  rangeEnd: number | null
  /** Bounding rect of the selection, used by the positioner to place the bubble. */
  referenceRect: DOMRect | null
}

/** Internal EventEmitter event map for the range-selection plugin. */
type RangeSelectionEvents = {
  update: [RangeSelectionState]
}

const SETTLE_DELAY_MS = 10

/**
 * Internal ProseMirror PluginView that watches selection changes and emits
 * {@link RangeSelectionState} to React whenever there is a non-empty text
 * selection while the editor is read-only.
 *
 * @internal
 */
class RangeSelectionView<BSchema extends BlockSchema> implements PluginView {
  private currentState: RangeSelectionState = {
    show: false,
    blockId: null,
    rangeStart: null,
    rangeEnd: null,
    referenceRect: null,
  }

  /**
   * While the user is pressing the mouse button to drag a new selection we
   * suppress the bubble so it does not flicker into view mid-drag.
   */
  private suppressWhileSelecting = false
  private settleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly editor: BlockNoteEditor<BSchema>,
    private readonly pmView: EditorView,
    private readonly onUpdate: (state: RangeSelectionState) => void,
  ) {
    this.pmView.dom.addEventListener('mousedown', this.onMouseDown)
    this.pmView.dom.addEventListener('mouseup', this.onMouseUp)
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private emitState(next: RangeSelectionState) {
    this.currentState = next
    this.onUpdate(next)
  }

  private hide() {
    if (this.currentState.show) {
      this.emitState({
        show: false,
        blockId: null,
        rangeStart: null,
        rangeEnd: null,
        referenceRect: null,
      })
    }
  }

  /**
   * Converts a ProseMirror document position into a zero-based Unicode
   * codepoint offset relative to the start of the containing block's text
   * content.
   *
   * The implementation walks through each inline node in the blockContent node
   * and accumulates codepoint counts until the target offset is reached.  For
   * non-text inline nodes (e.g. inline embeds) a single codepoint of width 1 is
   * assumed per node.
   */
  private posToBlockTextOffset(docPos: number, blockContentBeforePos: number): number {
    const state = this.pmView.state
    const blockContentNode = state.doc.resolve(blockContentBeforePos + 1).parent

    // docPos is an absolute position.  The start of blockContent's first child
    // sits at blockContentBeforePos + 1 (the opening token of blockContent).
    const offsetWithinContent = docPos - (blockContentBeforePos + 1)

    let codepoints = 0
    let remaining = offsetWithinContent

    blockContentNode.forEach((node, nodeOffset) => {
      if (remaining <= 0) return

      if (node.isText && node.text) {
        const nodeEnd = nodeOffset + node.nodeSize
        if (nodeOffset < remaining && remaining <= nodeEnd) {
          // Target position falls inside this text node.
          const slice = node.text.slice(0, remaining - nodeOffset)
          codepoints += Array.from(slice).length
          remaining = 0
        } else if (nodeOffset < remaining) {
          codepoints += Array.from(node.text).length
          remaining -= node.nodeSize
        }
      } else {
        // Non-text inline node (atom): count as 1 codepoint.
        if (nodeOffset < remaining) {
          codepoints += 1
          remaining -= node.nodeSize
        }
      }
    })

    return codepoints
  }

  // ---------------------------------------------------------------------------
  // ProseMirror PluginView lifecycle
  // ---------------------------------------------------------------------------

  update(view: EditorView) {
    if (this.suppressWhileSelecting) return

    const {state} = view

    // Only activate in read-only mode; edit mode uses the FormattingToolbar.
    if (view.editable) {
      this.hide()
      return
    }

    const {selection} = state

    if (selection.empty || !isTextSelection(selection)) {
      this.hide()
      return
    }

    const {$from, $to} = selection
    const from = $from.pos
    const to = $to.pos

    // Locate the blockNode that contains the selection start.
    let blockNode: import('prosemirror-model').Node | null = null
    let blockBeforePos = 0

    try {
      const posInfo = getNearestBlockPos(state.doc, from)
      blockNode = posInfo.node
      blockBeforePos = posInfo.posBeforeNode
    } catch {
      this.hide()
      return
    }

    // Only show the bubble when the entire selection is within a single block.
    try {
      const endBlockInfo = getNearestBlockPos(state.doc, to)
      if (endBlockInfo.posBeforeNode !== blockBeforePos) {
        this.hide()
        return
      }
    } catch {
      this.hide()
      return
    }

    const blockId: string | null = blockNode?.attrs?.id ?? null

    // Find the blockContent node start position (first child of blockNode).
    let blockContentBeforePos = blockBeforePos
    blockNode.forEach((child, offset) => {
      if (child.type.spec.group === 'block') {
        blockContentBeforePos = blockBeforePos + offset + 1
      }
    })

    const rangeStart = this.posToBlockTextOffset(from, blockContentBeforePos)
    const rangeEnd = this.posToBlockTextOffset(to, blockContentBeforePos)

    const referenceRect = posToDOMRect(view, from, to)

    this.emitState({
      show: true,
      blockId,
      rangeStart,
      rangeEnd,
      referenceRect,
    })
  }

  destroy() {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer)
    }
    this.pmView.dom.removeEventListener('mousedown', this.onMouseDown)
    this.pmView.dom.removeEventListener('mouseup', this.onMouseUp)

    if (this.currentState.show) {
      this.emitState({
        show: false,
        blockId: null,
        rangeStart: null,
        rangeEnd: null,
        referenceRect: null,
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Mouse handlers
  // ---------------------------------------------------------------------------

  onMouseDown = () => {
    // Suppress the bubble while the user is dragging a new selection.
    this.suppressWhileSelecting = true
    if (this.currentState.show) {
      this.emitState({
        show: false,
        blockId: null,
        rangeStart: null,
        rangeEnd: null,
        referenceRect: null,
      })
    }
  }

  onMouseUp = () => {
    // Give ProseMirror a tick to settle the selection before we evaluate it.
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer)
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.suppressWhileSelecting = false
      this.update(this.pmView)
    }, SETTLE_DELAY_MS)
  }
}

// ---------------------------------------------------------------------------
// Public plugin class
// ---------------------------------------------------------------------------

/** ProseMirror plugin key for the RangeSelection plugin. */
export const rangeSelectionPluginKey = new PluginKey('RangeSelectionPlugin')

/**
 * ProseMirror plugin that shows a citation/comment bubble whenever the user
 * makes a non-empty text selection in **read-only** mode.
 *
 * In edit mode the standard FormattingToolbar is responsible for selection
 * actions, so this plugin stays dormant to avoid conflicts.
 *
 * @example
 * ```ts
 * const plugin = new RangeSelectionProsemirrorPlugin(editor)
 * plugin.onUpdate((state) => {
 *   if (state.show) {
 *     console.log('selected', state.blockId, state.rangeStart, state.rangeEnd)
 *   }
 * })
 * ```
 */
export class RangeSelectionProsemirrorPlugin<BSchema extends BlockSchema> extends EventEmitter<RangeSelectionEvents> {
  /** The raw ProseMirror plugin to register in the editor's plugin list. */
  public readonly plugin: Plugin

  constructor(private readonly editor: BlockNoteEditor<BSchema>) {
    super()

    this.plugin = new Plugin({
      key: rangeSelectionPluginKey,
      view: (editorView) => {
        return new RangeSelectionView(editor, editorView, (state) => {
          this.emit('update', state)
        })
      },
    })
  }

  /**
   * Subscribes to selection state updates.  Returns an unsubscribe function
   * that should be called on cleanup (e.g. in a React `useEffect` return).
   */
  public onUpdate(callback: (state: RangeSelectionState) => void): () => void {
    return this.on('update', callback)
  }
}
