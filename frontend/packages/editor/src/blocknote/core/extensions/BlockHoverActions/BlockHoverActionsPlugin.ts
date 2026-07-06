import {PluginView} from '@tiptap/pm/state'
import {NodeSelection, Plugin, PluginKey} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {BlockNoteEditor} from '../../BlockNoteEditor'
import {EventEmitter} from '../../shared/EventEmitter'
import {BlockSchema} from '../Blocks/api/blockTypes'

/**
 * The state emitted to React subscribers whenever the hovered block changes.
 * `show` is false when the cursor has left the editor or no block was found.
 */
export type BlockHoverActionsState = {
  show: boolean
  /** The `data-id` attribute of the currently hovered blockNode, or null. */
  blockId: string | null
  /** The bounding rect used by the React positioner to place the floating action card. */
  referenceRect: DOMRect | null
}

/** Callbacks supplied by the consuming app. */
export type BlockHoverActionsCallbacks = {
  /** Called when the user clicks "Copy block link" for the given blockId. */
  onCopyBlockLink?: (blockId: string) => void
  /** Called when the user clicks "Start comment" for the given blockId. */
  onStartComment?: (blockId: string) => void
}

type BlockHoverActionsEvents = {
  update: [BlockHoverActionsState]
}

const SUPPRESSED_BLOCK_CONTENT_TYPES = new Set(['query'])

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
    this.pmView.dom.addEventListener('focus', this.onFocus)
    this.pmView.dom.addEventListener('blur', this.onBlur)
  }

  private isEditable(): boolean {
    return (this.editor as any)._tiptapEditor ? this.editor.isEditable : this.pmView.editable
  }

  private findBlockElementById(blockId: string): HTMLElement | null {
    const blocks = this.pmView.dom.querySelectorAll('[data-node-type="blockNode"][data-id]')
    return Array.from(blocks).find((block) => block.getAttribute('data-id') === blockId) as HTMLElement | null
  }

  private findDirectContentElement(blockElement: HTMLElement): HTMLElement | null {
    for (const child of Array.from(blockElement.children)) {
      if (child.hasAttribute('data-content-type')) {
        return child as HTMLElement
      }

      if (child.getAttribute('data-node-type') === 'blockChildren') {
        continue
      }

      const wrappedContent = Array.from(child.children).find((grandchild) =>
        grandchild.hasAttribute('data-content-type'),
      ) as HTMLElement | undefined
      if (wrappedContent) {
        return wrappedContent
      }
    }

    return null
  }

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

  private findOwningBlockElement(contentElement: HTMLElement): HTMLElement | null {
    const blockElement = contentElement.closest('[data-node-type="blockNode"][data-id]')
    return blockElement instanceof HTMLElement && this.pmView.dom.contains(blockElement) ? blockElement : null
  }

  private blockStateFromElement(blockElement: HTMLElement): BlockHoverActionsState | null {
    const blockId = blockElement.getAttribute('data-id')
    const contentElement = this.findDirectContentElement(blockElement)
    const contentType = contentElement?.getAttribute('data-content-type')

    if (!blockId || !contentElement || !contentType || SUPPRESSED_BLOCK_CONTENT_TYPES.has(contentType)) {
      return null
    }

    return {show: true, blockId, referenceRect: contentElement.getBoundingClientRect()}
  }

  private blockStateFromBlockId(blockId: string): BlockHoverActionsState | null {
    const blockElement = this.findBlockElementById(blockId)
    return blockElement ? this.blockStateFromElement(blockElement) : null
  }

  private selectionBlockState(): BlockHoverActionsState | null {
    const {selection} = this.pmView.state

    if (!this.isEditable() || !this.pmView.hasFocus()) {
      return null
    }

    if (!selection.empty && !(selection instanceof NodeSelection)) {
      return null
    }

    for (let depth = selection.$from.depth; depth >= 0; depth--) {
      const node = selection.$from.node(depth)
      if (node.type.name === 'blockNode' && node.attrs?.id) {
        return this.blockStateFromBlockId(node.attrs.id)
      }
    }

    return null
  }

  private keepHoverInCurrentRightGutter(event: MouseEvent, requireCurrentBlockTarget: boolean): boolean {
    if (
      this.isEditable() ||
      !this.currentState.show ||
      !this.currentState.blockId ||
      !this.currentState.referenceRect
    ) {
      return false
    }

    if (requireCurrentBlockTarget) {
      const target = event.target
      if (!(target instanceof Element)) {
        return false
      }

      const currentBlock = this.findBlockElementById(this.currentState.blockId)
      if (!currentBlock?.contains(target) && !target.contains(currentBlock)) {
        return false
      }
    }

    const rect = this.currentState.referenceRect
    return event.clientX >= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
  }

  private emitState(state: BlockHoverActionsState) {
    const sameVisibleBlock = this.currentState.show && state.show && this.currentState.blockId === state.blockId
    const sameHidden = !this.currentState.show && !state.show

    if (sameVisibleBlock || sameHidden) {
      this.currentState = state
      return
    }

    this.currentState = state
    this.onUpdate(state)
  }

  private hide() {
    if (this.currentState.show) {
      this.emitState({show: false, blockId: null, referenceRect: null})
    }
  }

  private showState(state: BlockHoverActionsState | null) {
    if (!state) {
      this.hide()
      return
    }

    this.emitState(state)
  }

  onMouseMove = (event: MouseEvent) => {
    this.handleMouseMove(event)
  }

  private handleMouseMove(event: MouseEvent) {
    if (!this.pmView.dom.isConnected) {
      this.hide()
      return
    }

    if (this.isEditable()) {
      this.showState(this.selectionBlockState())
      return
    }

    const {selection} = this.pmView.state
    if (!selection.empty && !(selection instanceof NodeSelection)) {
      this.hide()
      return
    }

    const supernumberBadge = event.target instanceof Element ? event.target.closest('.bn-supernumber-badge') : null
    const supernumberBlockId = supernumberBadge instanceof HTMLElement ? supernumberBadge.dataset.blockId : undefined

    if (supernumberBlockId) {
      this.showState(this.blockStateFromBlockId(supernumberBlockId))
      return
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
    this.showState(blockElement ? this.blockStateFromElement(blockElement) : null)
  }

  onMouseLeave = (event?: MouseEvent) => {
    if (this.isEditable()) {
      return
    }

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

  onFocus = () => {
    if (this.isEditable()) {
      this.showState(this.selectionBlockState())
    }
  }

  onBlur = (event: FocusEvent) => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Element && relatedTarget.closest('[data-bn-block-hover-actions="true"]')) {
      return
    }

    if (!this.frozen) {
      this.hide()
    }
  }

  update() {
    if (this.isEditable()) {
      this.showState(this.selectionBlockState())
      return
    }

    const {selection} = this.pmView.state
    if (!selection.empty && !(selection instanceof NodeSelection) && this.currentState.show) {
      this.hide()
    }
  }

  destroy() {
    this.pmView.dom.removeEventListener('mousemove', this.onMouseMove)
    this.pmView.dom.removeEventListener('mouseleave', this.onMouseLeave)
    this.pmView.dom.removeEventListener('focus', this.onFocus)
    this.pmView.dom.removeEventListener('blur', this.onBlur)

    if (this.currentState.show) {
      this.emitState({show: false, blockId: null, referenceRect: null})
    }
  }
}

export const blockHoverActionsPluginKey = new PluginKey('BlockHoverActionsPlugin')

/**
 * ProseMirror plugin that tracks the block that should show copy/comment hover actions.
 * In reading mode it follows mouse hover; in editing mode it follows the focused collapsed selection.
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
      this.view.onMouseLeave()
    }
  }

  /** Subscribes to hover state updates. Returns an unsubscribe function. */
  public onUpdate(callback: (state: BlockHoverActionsState) => void): () => void {
    return this.on('update', callback)
  }
}
