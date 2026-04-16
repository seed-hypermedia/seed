import {PluginView} from '@tiptap/pm/state'
import {Plugin, PluginKey} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {updateBlockCommand} from '../../api/blockManipulation/commands/updateBlock'
import {BlockNoteEditor} from '../../BlockNoteEditor'
import {BaseUiElementState} from '../../shared/BaseUiElementTypes'
import {EventEmitter} from '../../shared/EventEmitter'
import {Block, BlockSchema} from '../Blocks/api/blockTypes'
import {getBlockInfoFromPos} from '../Blocks/helpers/getBlockInfoFromPos'
import {slashMenuPluginKey} from '../SlashMenu/SlashMenuPlugin'
import {setupDragMonitor, createBlockDragGuardPlugin} from './pragmatic-dnd-bridge'

export type SideMenuState<BSchema extends BlockSchema> = BaseUiElementState & {
  block: Block<BSchema>
  lineHeight: string
}

function getDraggableBlockFromCoords(coords: {left: number; top: number}, view: EditorView) {
  if (!view.dom.isConnected) {
    return undefined
  }

  const pos = view.posAtCoords(coords)

  if (!pos) {
    return undefined
  }

  let node = view.nodeDOM(pos.inside) || (view.domAtPos(pos.pos).node as HTMLElement)

  if (node === view.dom) {
    return undefined
  }

  while (
    node &&
    node.parentNode &&
    node.parentNode !== view.dom &&
    // @ts-expect-error
    !node.hasAttribute?.('data-id')
  ) {
    node = node.parentNode as HTMLElement
  }
  if (!node) {
    return undefined
  }

  // When hovering between grid cells, find the nearest grid child to attach the side menu.
  const gridContainer = (node as HTMLElement).querySelector?.('[data-list-type="Grid"]')
  if (gridContainer) {
    const gridRect = gridContainer.getBoundingClientRect()
    if (
      coords.left >= gridRect.left &&
      coords.left <= gridRect.right &&
      coords.top >= gridRect.top &&
      coords.top <= gridRect.bottom
    ) {
      let closestChild: HTMLElement | null = null
      let closestDist = Infinity
      for (const child of Array.from(gridContainer.children) as HTMLElement[]) {
        if (!child.hasAttribute('data-id')) continue
        const rect = child.getBoundingClientRect()
        const dx = coords.left - (rect.left + rect.width / 2)
        const dy = coords.top - (rect.top + rect.height / 2)
        const dist = dx * dx + dy * dy
        if (dist < closestDist) {
          closestDist = dist
          closestChild = child
        }
      }
      if (closestChild) {
        return {node: closestChild, id: closestChild.getAttribute('data-id')!}
      }
    }
  }

  // @ts-expect-error
  return {node, id: node.getAttribute('data-id')!}
}

export class SideMenuView<BSchema extends BlockSchema> implements PluginView {
  private sideMenuState?: SideMenuState<BSchema>

  private horizontalPosAnchoredAtRoot: boolean
  private horizontalPosAnchor: number

  hoveredBlock: HTMLElement | undefined

  public menuFrozen = false

  private monitorCleanup?: () => void

  constructor(
    private readonly editor: BlockNoteEditor<BSchema>,
    private readonly pmView: EditorView,
    private readonly updateSideMenu: (sideMenuState: SideMenuState<BSchema>) => void,
  ) {
    this.horizontalPosAnchoredAtRoot = true
    this.horizontalPosAnchor = (this.pmView.dom.firstChild! as HTMLElement).getBoundingClientRect().x

    // Shows or updates menu position whenever the cursor moves, if the menu isn't frozen.
    document.body.addEventListener('mousemove', this.onMouseMove, true)

    // Makes menu scroll with the page.
    document.addEventListener('scroll', this.onScroll)

    // Hides and unfreezes the menu whenever the user presses a key.
    document.body.addEventListener('keydown', this.onKeyDown, true)

    // Setup Pragmatic DnD monitor for this editor
    if (this.editor.dragStateManager && this.editor.editorDragId) {
      this.monitorCleanup = setupDragMonitor(
        this.pmView.dom as HTMLElement,
        this.editor,
        this.editor.dragStateManager,
        this.editor.editorDragId,
      )
    }
  }

  onKeyDown = (_event: KeyboardEvent) => {
    if (this.sideMenuState?.show) {
      this.sideMenuState.show = false
      this.updateSideMenu(this.sideMenuState)
    }
    this.menuFrozen = false
  }

  onMouseMove = (event: MouseEvent) => {
    if (this.menuFrozen) {
      return
    }

    const editorBoundingBox = (this.pmView.dom.firstChild! as HTMLElement).getBoundingClientRect()
    const editorOuterBoundingBox = this.pmView.dom.getBoundingClientRect()
    const cursorWithinEditor =
      event.clientX >= editorOuterBoundingBox.left &&
      event.clientX <= editorOuterBoundingBox.right &&
      event.clientY >= editorOuterBoundingBox.top &&
      event.clientY <= editorOuterBoundingBox.bottom

    const editorWrapper = this.pmView.dom.parentElement!

    if (
      cursorWithinEditor &&
      event &&
      event.target &&
      !(editorWrapper === event.target || editorWrapper?.contains(event.target as HTMLElement))
    ) {
      if (this.sideMenuState?.show) {
        this.sideMenuState.show = false
        this.updateSideMenu(this.sideMenuState)
      }

      return
    }

    this.horizontalPosAnchor = editorBoundingBox.x

    const coords = {
      left: event.clientX,
      top: event.clientY,
    }
    let block = getDraggableBlockFromCoords(coords, this.pmView)
    if (!block) {
      coords.left = editorBoundingBox.left + editorBoundingBox.width / 2
      block = getDraggableBlockFromCoords(coords, this.pmView)
    }

    if (!block || !this.editor.isEditable) {
      if (this.sideMenuState?.show) {
        this.sideMenuState.show = false
        this.updateSideMenu(this.sideMenuState)
      }

      return
    }

    if (
      this.sideMenuState?.show &&
      this.hoveredBlock?.hasAttribute('data-id') &&
      this.hoveredBlock?.getAttribute('data-id') === block.id
    ) {
      return
    }

    // When the side menu is showing for a grid child and the cursor is slightly
    // to the left of that block, keep the menu on the current block so the user
    // can click the drag handle.
    if (this.sideMenuState?.show && this.hoveredBlock) {
      const parentEl = this.hoveredBlock.parentElement
      if (parentEl?.getAttribute('data-list-type') === 'Grid') {
        const hoveredRect = this.hoveredBlock.getBoundingClientRect()
        const distLeft = hoveredRect.left - event.clientX
        const isSlightlyLeft = distLeft > 0 && distLeft < 60
        const isVerticallyAligned = event.clientY >= hoveredRect.top && event.clientY <= hoveredRect.bottom
        if (isSlightlyLeft && isVerticallyAligned) {
          return
        }
      }
    }

    if (
      // @ts-expect-error
      !block.node?.hasAttribute('data-node-type') &&
      // @ts-expect-error
      !block.node?.getAttribute('data-node-type') == 'blockNode'
    ) {
      return
    }

    // @ts-expect-error
    this.hoveredBlock = block.node
    const blockContent = block.node.firstChild as HTMLElement

    if (!blockContent) {
      return
    }

    if (this.editor.isEditable) {
      const blockContentBoundingBox = blockContent.getBoundingClientRect()

      this.sideMenuState = {
        show: true,
        referencePos: new DOMRect(
          blockContentBoundingBox.x,
          blockContentBoundingBox.y,
          blockContentBoundingBox.width,
          blockContentBoundingBox.height,
        ),
        block: this.editor.getBlock(this.hoveredBlock!.getAttribute('data-id')!)!,
        lineHeight: window.getComputedStyle(blockContent).lineHeight,
      }

      this.updateSideMenu(this.sideMenuState)
    }
  }

  onScroll = () => {
    if (this.sideMenuState?.show) {
      const blockContent = this.hoveredBlock!.firstChild as HTMLElement
      const blockContentBoundingBox = blockContent.getBoundingClientRect()

      this.sideMenuState.referencePos = new DOMRect(
        blockContentBoundingBox.x,
        blockContentBoundingBox.y,
        blockContentBoundingBox.width,
        blockContentBoundingBox.height,
      )
      this.updateSideMenu(this.sideMenuState)
    }
  }

  destroy() {
    if (this.sideMenuState?.show) {
      this.sideMenuState.show = false
      this.updateSideMenu(this.sideMenuState)
    }
    document.body.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('scroll', this.onScroll)
    document.body.removeEventListener('keydown', this.onKeyDown, true)
    this.monitorCleanup?.()
  }

  addBlock() {
    if (this.sideMenuState?.show) {
      this.sideMenuState.show = false
      this.updateSideMenu(this.sideMenuState)
    }

    this.menuFrozen = true

    const blockContent = this.hoveredBlock!.firstChild! as HTMLElement
    const blockContentBoundingBox = blockContent.getBoundingClientRect()

    const pos = this.pmView.posAtCoords({
      left: blockContentBoundingBox.left + blockContentBoundingBox.width / 2,
      top: blockContentBoundingBox.top + blockContentBoundingBox.height / 2,
    })
    if (!pos) {
      return
    }

    const blockInfo = getBlockInfoFromPos(this.editor._tiptapEditor.state, pos.pos)
    if (blockInfo === undefined) {
      return
    }

    const {blockContent: contentNode, block} = blockInfo

    if (contentNode.node.textContent.length !== 0) {
      const newBlockInsertionPos = block.afterPos
      const newBlockContentPos = newBlockInsertionPos + 2
      this.editor._tiptapEditor
        .chain()
        .BNCreateBlock(newBlockInsertionPos)
        .command(
          updateBlockCommand(newBlockInsertionPos, {
            type: 'paragraph',
            props: {},
          }),
        )
        .setTextSelection(newBlockContentPos)
        .run()
    } else {
      this.editor._tiptapEditor.commands.setTextSelection(block.afterPos - 1)
    }

    this.pmView.focus()
    this.pmView.dispatch(
      this.pmView.state.tr.scrollIntoView().setMeta(slashMenuPluginKey, {
        activate: true,
        type: 'drag',
      }),
    )
  }
}

export const sideMenuPluginKey = new PluginKey('SideMenuPlugin')

export class SideMenuProsemirrorPlugin<BSchema extends BlockSchema> extends EventEmitter<any> {
  private sideMenuView: SideMenuView<BSchema> | undefined
  public readonly plugin: Plugin
  public readonly blockDragGuardPlugin: Plugin

  constructor(private readonly editor: BlockNoteEditor<BSchema>) {
    super()
    this.plugin = new Plugin({
      key: sideMenuPluginKey,
      view: (editorView) => {
        this.sideMenuView = new SideMenuView(editor, editorView, (sideMenuState) => {
          this.emit('update', sideMenuState)
        })
        return this.sideMenuView
      },
    })
    this.blockDragGuardPlugin = createBlockDragGuardPlugin()
  }

  public onUpdate(callback: (state: SideMenuState<BSchema>) => void) {
    return this.on('update', callback)
  }

  addBlock = () => this.sideMenuView!.addBlock()

  /**
   * Legacy no-op — kept for backward compatibility with media-container.tsx.
   * Pragmatic DnD now handles block drags via the drag handle.
   */
  blockDragStart = (_event: {dataTransfer: DataTransfer | null; clientX?: number; clientY: number}) => {
    // No-op: Pragmatic DnD manages block drags
  }

  blockDragEnd = () => {
    // No-op: Pragmatic DnD manages block drags
  }

  freezeMenu = () => (this.sideMenuView!.menuFrozen = true)
  unfreezeMenu = () => (this.sideMenuView!.menuFrozen = false)
}
