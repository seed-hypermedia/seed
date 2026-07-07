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

/**
 * Debug state emitted for the prediction cone visualization.
 * Contains the triangle vertices used to draw the cone overlay.
 */
export type PredictionConeDebugState = {
  origin: {x: number; y: number}
  cardTop: {x: number; y: number}
  cardBottom: {x: number; y: number}
}

type BlockHoverActionsEvents = {
  update: [BlockHoverActionsState]
  coneDebug: [PredictionConeDebugState | null]
}

const SUPPRESSED_BLOCK_CONTENT_TYPES = new Set(['query'])

/**
 * Point-in-triangle test using barycentric coordinates.
 *
 * Given a point (px, py) and triangle vertices (ax,ay), (bx,by), (cx,cy),
 * returns true if the point lies inside the triangle (including edges).
 *
 * This is the core geometric predicate behind the prediction cone:
 * while the pointer stays within the triangle formed by the cone origin
 * and the two near corners of the hover card, we suppress block switching.
 */
function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const v0x = cx - ax
  const v0y = cy - ay
  const v1x = bx - ax
  const v1y = by - ay
  const v2x = px - ax
  const v2y = py - ay

  const dot00 = v0x * v0x + v0y * v0y
  const dot01 = v0x * v1x + v0y * v1y
  const dot02 = v0x * v2x + v0y * v2y
  const dot11 = v1x * v1x + v1y * v1y
  const dot12 = v1x * v2x + v1y * v2y

  const denom = dot00 * dot11 - dot01 * dot01
  if (denom === 0) return false

  const invDenom = 1 / denom
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom

  return u >= 0 && v >= 0 && u + v <= 1
}

class BlockHoverActionsView<BSchema extends BlockSchema> implements PluginView {
  private currentState: BlockHoverActionsState = {
    show: false,
    blockId: null,
    referenceRect: null,
  }

  /** When true the plugin will not emit hide events (the floating card is being hovered). */
  public frozen = false

  /**
   * Prediction cone origin: the pointer position captured when the hover card
   * opened for the current block. While the pointer stays inside the triangle
   * from this origin to the hover card's near edge, we suppress block switching.
   */
  private coneOrigin: {x: number; y: number} | null = null

  /** Last known mouse position in viewport coordinates (clientX/clientY). */
  private lastMousePosition: {x: number; y: number} | null = null

  constructor(
    private readonly editor: BlockNoteEditor<BSchema>,
    private readonly pmView: EditorView,
    private readonly onUpdate: (state: BlockHoverActionsState) => void,
    private readonly onConeDebug: (state: PredictionConeDebugState | null) => void,
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

  /**
   * Checks whether the pointer (px, py) lies within the prediction cone
   * from `coneOrigin` to the near edge of the currently rendered hover card.
   *
   * Returns null if the hover card element hasn't been rendered yet (caller
   * should keep the cone pending but not suppress normal hover processing).
   * Returns the boolean point-in-triangle result when the card is available.
   */
  private isInsidePredictionCone(px: number, py: number): boolean | null {
    if (!this.currentState.blockId) return false

    const doc = this.pmView.dom.ownerDocument
    const cardEl = doc.querySelector('[data-bn-block-hover-actions="true"]')
    if (!cardEl) return null // card not yet rendered — keep cone pending

    const cardRect = cardEl.getBoundingClientRect()
    const blockEl = this.findBlockElementById(this.currentState.blockId)
    if (!blockEl) return false

    const blockRect = blockEl.getBoundingClientRect()

    // Determine which vertical edge of the card faces the block.
    const cardOnRight = cardRect.left > blockRect.right - 10
    const edgeX = cardOnRight ? cardRect.left : cardRect.right

    return pointInTriangle(px, py, this.coneOrigin!.x, this.coneOrigin!.y, edgeX, cardRect.top, edgeX, cardRect.bottom)
  }

  /** Returns debug info for the prediction cone visualization, or null if inactive. */
  public getConeDebugState(): PredictionConeDebugState | null {
    if (!this.coneOrigin || !this.currentState.show || !this.currentState.blockId) return null

    const doc = this.pmView.dom.ownerDocument
    const cardEl = doc.querySelector('[data-bn-block-hover-actions="true"]')
    if (!cardEl) return null

    const cardRect = cardEl.getBoundingClientRect()
    const blockEl = this.findBlockElementById(this.currentState.blockId)
    if (!blockEl) return null

    const blockRect = blockEl.getBoundingClientRect()
    const cardOnRight = cardRect.left > blockRect.right - 10
    const edgeX = cardOnRight ? cardRect.left : cardRect.right

    return {
      origin: this.coneOrigin,
      cardTop: {x: edgeX, y: cardRect.top},
      cardBottom: {x: edgeX, y: cardRect.bottom},
    }
  }

  private emitConeDebug() {
    this.onConeDebug(this.getConeDebugState())
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
      this.coneOrigin = null
      this.emitConeDebug()
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
    this.lastMousePosition = {x: event.clientX, y: event.clientY}
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

    // Prediction cone: if a hover card is open and the pointer is inside the
    // cone from the origin to the card's near edge, don't switch blocks.
    // This makes diagonal movement from a block to its hover action card
    // forgiving — the cursor can pass over neighboring blocks without
    // accidentally triggering their hover states.
    if (this.currentState.show && this.currentState.blockId && this.coneOrigin) {
      const insideCone = this.isInsidePredictionCone(event.clientX, event.clientY)
      this.emitConeDebug()

      if (insideCone === true) {
        return
      }

      if (insideCone === false) {
        // Pointer left the cone — resume normal hover behavior.
        this.coneOrigin = null
        this.emitConeDebug()
      }
      // If insideCone is null (card not rendered yet), keep cone pending
      // but fall through to normal hover processing.
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

    // When about to show a NEW block (different from current), capture the
    // pointer position as the prediction cone origin.
    const newState = blockElement ? this.blockStateFromElement(blockElement) : null
    if (newState?.show && newState.blockId !== this.currentState.blockId) {
      this.coneOrigin = {x: event.clientX, y: event.clientY}
    }

    this.showState(newState)

    if (this.coneOrigin) {
      this.emitConeDebug()
    }
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
        this.view = new BlockHoverActionsView(
          editor,
          editorView,
          (state) => {
            this.emit('update', state)
          },
          (coneState) => {
            this.emit('coneDebug', coneState)
          },
        )
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

  /** Returns the current prediction cone debug state, or null if inactive. */
  public getConeDebugState(): PredictionConeDebugState | null {
    return this.view?.getConeDebugState() ?? null
  }

  /** Subscribes to hover state updates. Returns an unsubscribe function. */
  public onUpdate(callback: (state: BlockHoverActionsState) => void): () => void {
    return this.on('update', callback)
  }

  /** Subscribes to cone debug state updates. Returns an unsubscribe function. */
  public onConeDebug(callback: (state: PredictionConeDebugState | null) => void): () => void {
    return this.on('coneDebug', callback)
  }
}
