import {PluginView} from '@tiptap/pm/state'
import {Node} from 'prosemirror-model'
import {NodeSelection, Plugin, PluginKey, Selection} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {updateBlockCommand} from '../../api/blockManipulation/commands/updateBlock'
import {BlockNoteEditor} from '../../BlockNoteEditor'
import styles from '../../editor.module.css'
import {BaseUiElementState} from '../../shared/BaseUiElementTypes'
import {EventEmitter} from '../../shared/EventEmitter'
import {Block, BlockSchema} from '../Blocks/api/blockTypes'
import {getBlockInfoFromPos} from '../Blocks/helpers/getBlockInfoFromPos'
import {slashMenuPluginKey} from '../SlashMenu/SlashMenuPlugin'
import {MultipleNodeSelection} from './MultipleNodeSelection'

// Deprecated in newer versions of prosemirror
// const serializeForClipboard = (pv as any).__serializeForClipboard
// // code based on https://github.com/ueberdosis/tiptap/issues/323#issuecomment-506637799

let dragImageElement: Element | undefined

export type SideMenuState<BSchema extends BlockSchema> = BaseUiElementState & {
  // The block that the side menu is attached to.
  block: Block<BSchema>
  lineHeight: string
}

function getDraggableBlockFromCoords(
  coords: {left: number; top: number},
  view: EditorView,
) {
  if (!view.dom.isConnected) {
    // view is not connected to the DOM, this can cause posAtCoords to fail
    // (Cannot read properties of null (reading 'nearestDesc'), https://github.com/TypeCellOS/BlockNote/issues/123)
    return undefined
  }

  const pos = view.posAtCoords(coords)

  if (!pos) {
    return undefined
  }

  let node =
    view.nodeDOM(pos.inside) || (view.domAtPos(pos.pos).node as HTMLElement)
  // let atomNode = view.nodeDOM(pos.inside) as HTMLElement

  if (node === view.dom) {
    // mouse over root
    return undefined
  }

  while (
    node &&
    node.parentNode &&
    node.parentNode !== view.dom &&
    !node.hasAttribute?.('data-id')
  ) {
    node = node.parentNode as HTMLElement
  }
  if (!node) {
    return undefined
  }

  return {node, id: node.getAttribute('data-id')!}
}

function blockPositionFromCoords(
  coords: {left: number; top: number},
  view: EditorView,
) {
  const block = getDraggableBlockFromCoords(coords, view)

  console.log('blockPositionFromCoords', block, coords)

  if (block && block.node.nodeType === 1) {
    // TODO: this uses undocumented PM APIs? do we need this / let's add docs?
    const docView = (view as any).docView
    const desc = docView.nearestDesc(block.node, true)
    if (!desc || desc === docView) {
      return null
    }
    return desc.posBefore
  }
  return null
}

function blockPositionsFromSelection(selection: Selection, doc: Node) {
  // Absolute positions just before the first block spanned by the selection, and just after the last block. Having the
  // selection start and end just before and just after the target blocks ensures no whitespace/line breaks are left
  // behind after dragging & dropping them.
  let beforeFirstBlockPos: number
  let afterLastBlockPos: number

  // Even the user starts dragging blocks but drops them in the same place, the selection will still be moved just
  // before & just after the blocks spanned by the selection, and therefore doesn't need to change if they try to drag
  // the same blocks again. If this happens, the anchor & head move out of the block content node they were originally
  // in. If the anchor should update but the head shouldn't and vice versa, it means the user selection is outside a
  // block content node, which should never happen.
  const selectionStartInBlockContent =
    doc.resolve(selection.from).node().type.spec.group === 'blockContent'
  const selectionEndInBlockContent =
    doc.resolve(selection.to).node().type.spec.group === 'blockContent'

  // Ensures that entire outermost nodes are selected if the selection spans multiple nesting levels.
  const minDepth = Math.min(selection.$anchor.depth, selection.$head.depth)

  if (selectionStartInBlockContent && selectionEndInBlockContent) {
    // Absolute positions at the start of the first block in the selection and at the end of the last block. User
    // selections will always start and end in block content nodes, but we want the start and end positions of their
    // parent block nodes, which is why minDepth - 1 is used.
    const startFirstBlockPos = selection.$from.start(minDepth - 1)
    const endLastBlockPos = selection.$to.end(minDepth - 1)

    // Shifting start and end positions by one moves them just outside the first and last selected blocks.
    beforeFirstBlockPos = doc.resolve(startFirstBlockPos - 1).pos
    afterLastBlockPos = doc.resolve(endLastBlockPos + 1).pos
  } else {
    beforeFirstBlockPos = selection.from
    afterLastBlockPos = selection.to
  }

  return {from: beforeFirstBlockPos, to: afterLastBlockPos}
}

function setDragImage(view: EditorView, from: number, to = from) {
  if (from === to) {
    // Moves to position to be just after the first (and only) selected block.
    to += view.state.doc.resolve(from + 1).node().nodeSize
  }

  // Parent element is cloned to remove all unselected children without affecting the editor content.
  const parentClone = view.domAtPos(from).node.cloneNode(true) as Element
  const parent = view.domAtPos(from).node as Element

  const getElementIndex = (parentElement: Element, targetElement: Element) =>
    Array.prototype.indexOf.call(parentElement.children, targetElement)

  const firstSelectedBlockIndex = getElementIndex(
    parent,
    // Expects from position to be just before the first selected block.
    view.domAtPos(from + 1).node.parentElement!,
  )
  const lastSelectedBlockIndex = getElementIndex(
    parent,
    // Expects to position to be just after the last selected block.
    view.domAtPos(to - 1).node.parentElement!,
  )

  for (let i = parent.childElementCount - 1; i >= 0; i--) {
    if (i > lastSelectedBlockIndex || i < firstSelectedBlockIndex) {
      parentClone.removeChild(parentClone.children[i])
    }
  }

  // dataTransfer.setDragImage(element) only works if element is attached to the DOM.
  unsetDragImage(view.root)
  dragImageElement = parentClone

  // TODO: This is hacky, need a better way of assigning classes to the editor so that they can also be applied to the
  //  drag preview.
  const classes = view.dom.className.split(' ')
  const inheritedClasses = classes
    .filter(
      (className) =>
        !className.includes('bn') &&
        !className.includes('ProseMirror') &&
        !className.includes('editor'),
    )
    .join(' ')

  dragImageElement.className =
    dragImageElement.className +
    ' ' +
    styles.dragPreview +
    ' ' +
    inheritedClasses

  if (view.root instanceof ShadowRoot) {
    view.root.appendChild(dragImageElement)
  } else {
    view.root.body.appendChild(dragImageElement)
  }
}

export function unsetDragImage(rootEl?: Document | ShadowRoot) {
  if (dragImageElement !== undefined) {
    if (rootEl) {
      if (rootEl instanceof ShadowRoot) {
        rootEl.removeChild(dragImageElement)
      } else {
        rootEl.body.removeChild(dragImageElement)
      }
    } else document.body.removeChild(dragImageElement)

    dragImageElement = undefined
  }
}

function dragStart(
  e: {dataTransfer: DataTransfer | null; clientY: number},
  view: EditorView,
) {
  if (!e.dataTransfer) {
    return
  }

  const editorBoundingBox = view.dom.getBoundingClientRect()

  const coords = {
    left: editorBoundingBox.left + editorBoundingBox.width / 2, // take middle of editor
    top: e.clientY,
  }

  const pos = blockPositionFromCoords(coords, view)
  if (pos != null) {
    const selection = view.state.selection
    const doc = view.state.doc

    const {from, to} = blockPositionsFromSelection(selection, doc)

    const draggedBlockInSelection = from <= pos && pos < to
    const multipleBlocksSelected =
      selection.$anchor.node() !== selection.$head.node() ||
      selection instanceof MultipleNodeSelection

    if (draggedBlockInSelection && multipleBlocksSelected) {
      view.dispatch(
        view.state.tr.setSelection(MultipleNodeSelection.create(doc, from, to)),
      )
      setDragImage(view, from, to)
    } else {
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
      )
      setDragImage(view, pos)
    }

    const slice = view.state.selection.content()
    const clipboardHTML = view.serializeForClipboard(slice).dom.innerHTML
    const plainText = htmlToPlainText(clipboardHTML)

    e.dataTransfer.clearData()
    e.dataTransfer.setData('text/html', clipboardHTML)
    e.dataTransfer.setData('text/plain', plainText)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setDragImage(dragImageElement!, 0, 0)
    view.dragging = {slice, move: true}
  }
}

function htmlToPlainText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.innerText.trim()
}

export class SideMenuView<BSchema extends BlockSchema> implements PluginView {
  private sideMenuState?: SideMenuState<BSchema>

  // When true, the drag handle with be anchored at the same level as root elements
  // When false, the drag handle with be just to the left of the element
  // TODO: Is there any case where we want this to be false?
  private horizontalPosAnchoredAtRoot: boolean
  private horizontalPosAnchor: number

  private hoveredBlock: HTMLElement | undefined

  // Used to check if currently dragged content comes from this editor instance.
  public isDragging = false

  public menuFrozen = false

  constructor(
    private readonly editor: BlockNoteEditor<BSchema>,
    private readonly pmView: EditorView,
    private readonly updateSideMenu: (
      sideMenuState: SideMenuState<BSchema>,
    ) => void,
  ) {
    this.horizontalPosAnchoredAtRoot = true
    this.horizontalPosAnchor = (
      this.pmView.dom.firstChild! as HTMLElement
    ).getBoundingClientRect().x

    document.body.addEventListener('drop', this.onDrop, true)
    document.body.addEventListener('dragover', this.onDragOver)
    this.pmView.dom.addEventListener('dragstart', this.onDragStart)

    // Shows or updates menu position whenever the cursor moves, if the menu isn't frozen.
    document.body.addEventListener('mousemove', this.onMouseMove, true)

    // Makes menu scroll with the page.
    document.addEventListener('scroll', this.onScroll)

    // Hides and unfreezes the menu whenever the user presses a key.
    document.body.addEventListener('keydown', this.onKeyDown, true)
  }

  /**
   * Sets isDragging when dragging text.
   */
  onDragStart = () => {
    this.isDragging = true
  }

  /**
   * If the event is outside the editor contents,
   * we dispatch a fake event, so that we can still drop the content
   * when dragging / dropping to the side of the editor
   */
  onDrop = (event: DragEvent) => {
    this.editor._tiptapEditor.commands.blur()

    if (
      (event as any).synthetic ||
      (!this.isDragging &&
        (!event.dataTransfer?.types ||
          event.dataTransfer?.types[0] !== 'Files'))
    ) {
      return
    }

    const pos = this.pmView.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    })

    this.isDragging = false

    if (!pos || pos.inside === -1) {
      const evt = new Event('drop', event) as any
      const editorBoundingBox = (
        this.pmView.dom.firstChild! as HTMLElement
      ).getBoundingClientRect()
      evt.clientX = editorBoundingBox.left + editorBoundingBox.width / 2
      evt.clientY = event.clientY
      evt.dataTransfer = event.dataTransfer
      evt.preventDefault = () => event.preventDefault()
      evt.synthetic = true // prevent recursion
      console.log('dispatch fake drop', evt)
      this.pmView.dom.dispatchEvent(evt)
    }
  }

  /**
   * If the event is outside the editor contents,
   * we dispatch a fake event, so that we can still drop the content
   * when dragging / dropping to the side of the editor
   */
  onDragOver = (event: DragEvent) => {
    if (
      (event as any).synthetic ||
      (!this.isDragging &&
        (!event.dataTransfer?.types ||
          event.dataTransfer?.types[0] !== 'Files'))
    ) {
      return
    }
    const pos = this.pmView.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    })

    if (!pos || pos.inside === -1) {
      const evt = new Event('dragover', event) as any
      const editorBoundingBox = (
        this.pmView.dom.firstChild! as HTMLElement
      ).getBoundingClientRect()
      evt.clientX = editorBoundingBox.left + editorBoundingBox.width / 2
      evt.clientY = event.clientY
      evt.dataTransfer = event.dataTransfer
      evt.preventDefault = () => event.preventDefault()
      evt.synthetic = true // prevent recursion
      // console.log("dispatch fake dragover");
      this.pmView.dom.dispatchEvent(evt)
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

    // Editor itself may have padding or other styling which affects
    // size/position, so we get the boundingRect of the first child (i.e. the
    // blockGroup that wraps all blocks in the editor) for more accurate side
    // menu placement.
    const editorBoundingBox = (
      this.pmView.dom.firstChild! as HTMLElement
    ).getBoundingClientRect()
    // We want the full area of the editor to check if the cursor is hovering
    // above it though.
    const editorOuterBoundingBox = this.pmView.dom.getBoundingClientRect()
    const cursorWithinEditor =
      event.clientX >= editorOuterBoundingBox.left &&
      event.clientX <= editorOuterBoundingBox.right &&
      event.clientY >= editorOuterBoundingBox.top &&
      event.clientY <= editorOuterBoundingBox.bottom

    const editorWrapper = this.pmView.dom.parentElement!

    // Doesn't update if the mouse hovers an element that's over the editor but
    // isn't a part of it or the side menu.
    if (
      // Cursor is within the editor area
      cursorWithinEditor &&
      // An element is hovered
      event &&
      event.target &&
      // Element is outside the editor
      !(
        editorWrapper === event.target ||
        editorWrapper?.contains(event.target as HTMLElement)
      )
    ) {
      if (this.sideMenuState?.show) {
        this.sideMenuState.show = false
        this.updateSideMenu(this.sideMenuState)
      }

      return
    }

    this.horizontalPosAnchor = editorBoundingBox.x

    // Gets block at mouse cursor's vertical position.
    const coords = {
      left: editorBoundingBox.left + editorBoundingBox.width / 2, // take middle of editor
      top: event.clientY,
    }
    const block = getDraggableBlockFromCoords(coords, this.pmView)

    // Closes the menu if the mouse cursor is beyond the editor vertically.
    if (!block || !this.editor.isEditable) {
      if (this.sideMenuState?.show) {
        this.sideMenuState.show = false
        this.updateSideMenu(this.sideMenuState)
      }

      return
    }

    // Doesn't update if the menu is already open and the mouse cursor is still hovering the same block.
    if (
      this.sideMenuState?.show &&
      this.hoveredBlock?.hasAttribute('data-id') &&
      this.hoveredBlock?.getAttribute('data-id') === block.id
    ) {
      return
    }

    if (
      !block.node?.hasAttribute('data-node-type') &&
      !block.node?.getAttribute('data-node-type') == 'blockContainer'
    ) {
      return
    }

    this.hoveredBlock = block.node
    // Gets the block's content node, which lets to ignore child blocks when determining the block menu's position.
    const blockContent = block.node.firstChild as HTMLElement

    if (!blockContent) {
      return
    }

    // Shows or updates elements.
    if (this.editor.isEditable) {
      const blockContentBoundingBox = blockContent.getBoundingClientRect()

      this.sideMenuState = {
        show: true,
        referencePos: new DOMRect(
          // this.horizontalPosAnchoredAtRoot
          //   ? this.horizontalPosAnchor
          //   : blockContentBoundingBox.x,
          blockContentBoundingBox.x,
          blockContentBoundingBox.y,
          blockContentBoundingBox.width,
          blockContentBoundingBox.height,
        ),
        block: this.editor.getBlock(
          this.hoveredBlock!.getAttribute('data-id')!,
        )!,
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
    document.body.removeEventListener('dragover', this.onDragOver)
    this.pmView.dom.removeEventListener('dragstart', this.onDragStart)
    document.body.removeEventListener('drop', this.onDrop, true)
    document.removeEventListener('scroll', this.onScroll)
    document.body.removeEventListener('keydown', this.onKeyDown, true)
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

    const blockInfo = getBlockInfoFromPos(
      this.editor._tiptapEditor.state,
      pos.pos,
    )
    if (blockInfo === undefined) {
      return
    }

    const {blockContent: contentNode, block} = blockInfo

    // Creates a new block if current one is not empty for the suggestion menu to open in.
    if (contentNode.node.textContent.length !== 0) {
      const newBlockInsertionPos = block.afterPos
      const newBlockContentPos = newBlockInsertionPos + 2
      console.log('here????')
      this.editor._tiptapEditor
        .chain()
        .BNCreateBlock(newBlockInsertionPos)
        // .BNUpdateBlock(newBlockContentPos, {type: 'paragraph', props: {}})
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

    // Focuses and activates the suggestion menu.
    this.pmView.focus()
    this.pmView.dispatch(
      this.pmView.state.tr.scrollIntoView().setMeta(slashMenuPluginKey, {
        // TODO import suggestion plugin key
        activate: true,
        type: 'drag',
      }),
    )
  }
}

export const sideMenuPluginKey = new PluginKey('SideMenuPlugin')

export class SideMenuProsemirrorPlugin<
  BSchema extends BlockSchema,
> extends EventEmitter<any> {
  private sideMenuView: SideMenuView<BSchema> | undefined
  public readonly plugin: Plugin

  constructor(private readonly editor: BlockNoteEditor<BSchema>) {
    super()
    this.plugin = new Plugin({
      key: sideMenuPluginKey,
      view: (editorView) => {
        this.sideMenuView = new SideMenuView(
          editor,
          editorView,
          (sideMenuState) => {
            this.emit('update', sideMenuState)
          },
        )
        return this.sideMenuView
      },
    })
  }

  public onUpdate(callback: (state: SideMenuState<BSchema>) => void) {
    return this.on('update', callback)
  }

  /**
   * If the block is empty, opens the slash menu. If the block has content,
   * creates a new block below and opens the slash menu in it.
   */
  addBlock = () => this.sideMenuView!.addBlock()

  /**
   * Handles drag & drop events for blocks.
   */
  blockDragStart = (event: {
    dataTransfer: DataTransfer | null
    clientY: number
  }) => {
    this.sideMenuView!.isDragging = true
    dragStart(event, this.editor.prosemirrorView)
  }

  /**
   * Handles drag & drop events for blocks.
   */
  blockDragEnd = () => unsetDragImage()
  /**
   * Freezes the side menu. When frozen, the side menu will stay
   * attached to the same block regardless of which block is hovered by the
   * mouse cursor.
   */
  freezeMenu = () => (this.sideMenuView!.menuFrozen = true)
  /**
   * Unfreezes the side menu. When frozen, the side menu will stay
   * attached to the same block regardless of which block is hovered by the
   * mouse cursor.
   */
  unfreezeMenu = () => (this.sideMenuView!.menuFrozen = false)
}
