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

/** Block types to suppress showing hover action buttons in mobile */
const TOUCH_SUPPRESSED_BLOCK_CONTENT_TYPES = new Set(['query', 'button'])

/** True when the device cannot hover (phone/tablet). Cached at module load. */
const isTouchOnlyDevice =
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(hover: none)').matches : false

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
   * Walks up the DOM from `node` until a block content element is found.
   * Returns `null` if the pointer is over a block wrapper or nested children
   * area instead of an actual block content element.
   */
  private findBlockContentElement(node: Node | null): HTMLElement | null {
    let element: HTMLElement | null =
      node?.nodeType === Node.TEXT_NODE ? node.parentElement : node instanceof HTMLElement ? node : null

    while (element && element !== this.pmView.dom) {
      if (element.hasAttribute('data-content-type')) {
        return element
      }
      element = element.parentElement
    }

    return null
  }

  /**
   * Finds the block node that owns a block content element. The direct
   * `data-content-type` target is used first so hovering nested children does
   * not accidentally select the parent block wrapper.
   */
  private findOwningBlockElement(contentElement: HTMLElement): HTMLElement | null {
    let element: HTMLElement | null = contentElement.parentElement

    while (element && element !== this.pmView.dom) {
      if (element.getAttribute('data-node-type') === 'blockNode' && element.hasAttribute('data-id')) {
        return element
      }
      element = element.parentElement
    }

    return null
  }

  private findBlockElementById(blockId: string): HTMLElement | null {
    return this.pmView.dom.querySelector(`[data-node-type="blockNode"][data-id="${blockId}"]`) as HTMLElement | null
  }

  private findBlockContentElementForBlock(blockElement: HTMLElement): HTMLElement | null {
    return Array.from(blockElement.children).find((child) =>
      child.hasAttribute('data-content-type'),
    ) as HTMLElement | null
  }

  private keepHoverInCurrentRightGutter(event: MouseEvent, requireCurrentBlockTarget: boolean): boolean {
    if (!this.currentState.show || !this.currentState.blockId || !this.currentState.referenceRect) {
      return false
    }

    if (requireCurrentBlockTarget) {
      const target = event.target
      if (!(target instanceof Element)) {
        return false
      }

      const currentBlock = this.findBlockElementById(this.currentState.blockId)
      if (!currentBlock?.contains(target)) {
        return false
      }
    }

    const rect = this.currentState.referenceRect
    return event.clientX >= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
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
    if (!this.pmView.dom.isConnected) {
      this.hide()
      return
    }

    // Hide when there is an active text selection (the range selection bubble takes priority).
    if (!this.pmView.state.selection.empty) {
      this.hide()
      return
    }

    const supernumberBadge = event.target instanceof Element ? event.target.closest('.bn-supernumber-badge') : null
    const supernumberBlockId = supernumberBadge instanceof HTMLElement ? supernumberBadge.dataset.blockId : undefined

    if (supernumberBlockId) {
      const blockElement = this.findBlockElementById(supernumberBlockId)
      const contentElement = blockElement ? this.findBlockContentElementForBlock(blockElement) : null

      if (blockElement && contentElement) {
        const referenceRect = contentElement.getBoundingClientRect()
        this.emitState({show: true, blockId: supernumberBlockId, referenceRect})
        return
      }
    }

    const contentElement = this.findBlockContentElement(event.target as Node | null)
    if (!contentElement) {
      if (this.keepHoverInCurrentRightGutter(event, true)) {
        return
      }

      this.hide()
      return
    }

    const blockElement = this.findOwningBlockElement(contentElement)
    if (!blockElement) {
      this.hide()
      return
    }

    const blockId = blockElement.getAttribute('data-id')

    if (!blockId) {
      this.hide()
      return
    }

    // On touch-only devices, suppress for block types whose own click action
    // competes with the hover action buttons.
    if (isTouchOnlyDevice) {
      const contentType = contentElement.getAttribute('data-content-type')
      if (contentType && TOUCH_SUPPRESSED_BLOCK_CONTENT_TYPES.has(contentType)) {
        this.hide()
        return
      }
    }

    // If we are already showing for this exact block, do nothing.
    if (this.currentState.show && this.currentState.blockId === blockId) {
      return
    }

    const referenceRect = contentElement.getBoundingClientRect()

    this.emitState({show: true, blockId, referenceRect})
  }

  onMouseLeave = (event?: MouseEvent) => {
    const relatedTarget = event?.relatedTarget
    if (relatedTarget instanceof Element && relatedTarget.closest('[data-bn-block-hover-actions="true"]')) {
      return
    }

    if (event && this.keepHoverInCurrentRightGutter(event, false)) {
      return
    }

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
 * Active in editable and read-only mode; hidden while a non-empty text
 * selection is active so it does not overlap selection-specific toolbars.
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
