import {PluginView} from '@tiptap/pm/state'
import {Plugin, PluginKey} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {BlockNoteEditor} from '../../BlockNoteEditor'
import {EventEmitter} from '../../shared/EventEmitter'
import {BlockSchema} from '../Blocks/api/blockTypes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The state emitted to React subscribers whenever the hovered block changes.
 * `show` is false when the cursor has left the editor or no block was found.
 */
export type BlockHoverActionsState = {
  show: boolean
  /** The `data-id` attribute of the currently hovered blockNode, or null. */
  blockId: string | null
  /**
   * The bounding rect of the hovered block element, used by the React
   * positioner to place the floating action card.
   */
  referenceRect: DOMRect | null
}

/**
 * Callbacks supplied by the consuming app.  All are optional; only the
 * ones provided will appear as active buttons in the floating card.
 */
export type BlockHoverActionsCallbacks = {
  /** Called when the user clicks "Copy block link" for the given blockId. */
  onCopyBlockLink?: (blockId: string) => void
  /** Called when the user clicks "Start comment" for the given blockId. */
  onStartComment?: (blockId: string) => void
}

/** Internal EventEmitter event map used by the plugin. */
type BlockHoverActionsEvents = {
  update: [BlockHoverActionsState]
}

// ---------------------------------------------------------------------------
// ProseMirror PluginView
// ---------------------------------------------------------------------------

/**
 * Internal ProseMirror PluginView that attaches mouse listeners to the editor
 * DOM and emits state updates via a callback whenever the hovered block changes.
 *
 * @internal
 */
class BlockHoverActionsView<BSchema extends BlockSchema> implements PluginView {
  private currentState: BlockHoverActionsState = {
    show: false,
    blockId: null,
    referenceRect: null,
  }

  /** When true the plugin will not emit hide events (the floating card is being hovered). */
  public frozen = false

  constructor(
    private readonly editor: BlockNoteEditor<BSchema>,
    private readonly pmView: EditorView,
    private readonly onUpdate: (state: BlockHoverActionsState) => void,
  ) {
    this.pmView.dom.addEventListener('mousemove', this.onMouseMove)
    this.pmView.dom.addEventListener('mouseleave', this.onMouseLeave)
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Walks up the DOM from `element` until a node that carries `data-id` is
   * found.  Returns `null` if none is found before reaching the editor root.
   */
  private findBlockElement(element: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = element

    while (node && node !== this.pmView.dom) {
      if (node.hasAttribute('data-id')) {
        return node
      }
      node = node.parentElement
    }

    return null
  }

  private emitState(state: BlockHoverActionsState) {
    this.currentState = state
    this.onUpdate(state)
  }

  private hide() {
    if (this.currentState.show) {
      this.emitState({show: false, blockId: null, referenceRect: null})
    }
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  onMouseMove = (event: MouseEvent) => {
    this.handleMouseMove(event)
  }

  private handleMouseMove(event: MouseEvent) {
    // Only show hover actions in read-only mode.
    if (this.pmView.editable) {
      this.hide()
      return
    }

    if (!this.pmView.dom.isConnected) {
      this.hide()
      return
    }

    // Hide when there is an active text selection (the range selection bubble takes priority).
    if (!this.pmView.state.selection.empty) {
      this.hide()
      return
    }

    // Use posAtCoords to find the ProseMirror position under the cursor.
    const coords = {left: event.clientX, top: event.clientY}
    const posResult = this.pmView.posAtCoords(coords)

    if (!posResult) {
      this.hide()
      return
    }

    // Walk up from the DOM node returned by posAtCoords to find the block element.
    let domNode: Node | null = null

    // posResult.inside can be -1 (outside any node), so use pos as fallback.
    if (posResult.inside >= 0) {
      domNode = this.pmView.nodeDOM(posResult.inside) as Node | null
    }

    if (!domNode) {
      const domAtResult = this.pmView.domAtPos(posResult.pos)
      domNode = domAtResult.node
    }

    if (!domNode) {
      this.hide()
      return
    }

    // Normalise text nodes to their parent element.
    const element: HTMLElement = (domNode.nodeType === Node.TEXT_NODE ? domNode.parentElement : domNode) as HTMLElement

    if (!element) {
      this.hide()
      return
    }

    const blockElement = this.findBlockElement(element)

    if (!blockElement) {
      this.hide()
      return
    }

    const blockId = blockElement.getAttribute('data-id')

    if (!blockId) {
      this.hide()
      return
    }

    // If we are already showing for this exact block, do nothing.
    if (this.currentState.show && this.currentState.blockId === blockId) {
      return
    }

    const referenceRect = blockElement.getBoundingClientRect()

    this.emitState({show: true, blockId, referenceRect})
  }

  onMouseLeave = () => {
    if (!this.frozen) {
      this.hide()
    }
  }

  // -------------------------------------------------------------------------
  // PluginView lifecycle
  // -------------------------------------------------------------------------

  /** Called by ProseMirror on every transaction (selection change, doc change, etc.). */
  update() {
    // If a text selection appeared, hide the hover card so it doesn't overlap the range selection bubble.
    if (!this.pmView.state.selection.empty && this.currentState.show) {
      this.hide()
    }
  }

  destroy() {
    this.pmView.dom.removeEventListener('mousemove', this.onMouseMove)
    this.pmView.dom.removeEventListener('mouseleave', this.onMouseLeave)

    if (this.currentState.show) {
      this.emitState({show: false, blockId: null, referenceRect: null})
    }
  }
}

// ---------------------------------------------------------------------------
// Public plugin class
// ---------------------------------------------------------------------------

export const blockHoverActionsPluginKey = new PluginKey('BlockHoverActionsPlugin')

/**
 * ProseMirror plugin that tracks which block the cursor is hovering over and
 * exposes that information to React via an {@link EventEmitter}.
 *
 * Only active in **read-only** mode (`!view.editable`).
 *
 * @example
 * ```ts
 * const plugin = new BlockHoverActionsProsemirrorPlugin(editor)
 * // Receive state updates:
 * plugin.onUpdate((state) => {
 *   if (state.show) console.log('hovering', state.blockId)
 * })
 * ```
 */
export class BlockHoverActionsProsemirrorPlugin<
  BSchema extends BlockSchema,
> extends EventEmitter<BlockHoverActionsEvents> {
  /** The raw ProseMirror plugin to register in the editor's plugin list. */
  public readonly plugin: Plugin

  private view: BlockHoverActionsView<BSchema> | null = null

  constructor(private readonly editor: BlockNoteEditor<BSchema>) {
    super()

    this.plugin = new Plugin({
      key: blockHoverActionsPluginKey,
      view: (editorView) => {
        this.view = new BlockHoverActionsView(editor, editorView, (state) => {
          this.emit('update', state)
        })
        return this.view
      },
    })
  }

  /** Prevent the plugin from hiding the hover card (e.g. while the card itself is hovered). */
  public freeze() {
    if (this.view) this.view.frozen = true
  }

  /** Allow the plugin to hide the hover card again, and immediately hide if the cursor left the editor. */
  public unfreeze() {
    if (this.view) {
      this.view.frozen = false
      // The cursor may have already left the editor while frozen — emit hide.
      this.view.onMouseLeave()
    }
  }

  /**
   * Subscribes to hover state updates.  Returns an unsubscribe function that
   * should be called on cleanup (e.g. in a React `useEffect` return).
   */
  public onUpdate(callback: (state: BlockHoverActionsState) => void): () => void {
    return this.on('update', callback)
  }
}
