import {Plugin, PluginKey, PluginView} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {BlockNoteEditor} from '../../BlockNoteEditor'
import {BaseUiElementState} from '../../shared/BaseUiElementTypes'
import {EventEmitter} from '../../shared/EventEmitter'
import {Block, BlockSchema} from '../Blocks/api/blockTypes'
import {fullBlockSelectionPluginKey} from '../FullBlockSelection/FullBlockSelectionPlugin'
import {createBlockDragGuardPlugin, setupDragMonitor} from './pragmatic-dnd-bridge'

export type SideMenuState<BSchema extends BlockSchema> = BaseUiElementState & {
  block: Block<BSchema>
  lineHeight: string
}

/**
 * PluginView that mirrors the FullBlockSelectionPlugin state into a SideMenu
 * visibility signal. The SideMenu is only shown when at least one block is
 * fully selected; in the multi-block case it anchors to the first block in
 * document order.
 */
class SideMenuView<BSchema extends BlockSchema> implements PluginView {
  private sideMenuState?: SideMenuState<BSchema>
  private fullBlockUnsubscribe?: () => void
  private monitorCleanup?: () => void

  constructor(
    private readonly editor: BlockNoteEditor<BSchema>,
    private readonly pmView: EditorView,
    private readonly updateSideMenu: (sideMenuState: SideMenuState<BSchema>) => void,
  ) {
    if (this.editor.fullBlockSelection) {
      this.fullBlockUnsubscribe = this.editor.fullBlockSelection.onUpdate(({blockIds}) => {
        this.syncFromSelection(blockIds)
      })
    }

    if (this.editor.dragStateManager && this.editor.editorDragId) {
      this.monitorCleanup = setupDragMonitor(
        this.pmView.dom as HTMLElement,
        this.editor,
        this.editor.dragStateManager,
        this.editor.editorDragId,
      )
    }
  }

  private syncFromSelection(blockIds: string[]) {
    if (!this.editor.isEditable) {
      this.emitHide()
      return
    }
    if (blockIds.length === 0) {
      this.emitHide()
      return
    }

    const firstId = this.findFirstBlockIdInDocOrder(blockIds)
    if (!firstId) {
      this.emitHide()
      return
    }

    const blockEl = this.pmView.dom.querySelector(`[data-id="${firstId}"]`) as HTMLElement | null
    if (!blockEl) {
      this.emitHide()
      return
    }
    const blockContent = blockEl.firstChild as HTMLElement | null
    if (!blockContent) {
      this.emitHide()
      return
    }

    const block = this.editor.getBlock(firstId)
    if (!block) {
      this.emitHide()
      return
    }

    const rect = blockContent.getBoundingClientRect()
    this.sideMenuState = {
      show: true,
      referencePos: new DOMRect(rect.x, rect.y, rect.width, rect.height),
      block,
      lineHeight: window.getComputedStyle(blockContent).lineHeight,
    }
    this.updateSideMenu(this.sideMenuState)
  }

  private emitHide() {
    if (!this.sideMenuState?.show) return
    this.sideMenuState.show = false
    this.updateSideMenu(this.sideMenuState)
  }

  private findFirstBlockIdInDocOrder(blockIds: string[]): string | undefined {
    if (blockIds.length === 1) return blockIds[0]
    const idSet = new Set(blockIds)
    let firstId: string | undefined
    this.pmView.state.doc.descendants((node) => {
      if (firstId) return false
      if (node.type.name !== 'blockNode') return true
      const id = node.attrs.id as string | undefined
      if (id && idSet.has(id)) {
        firstId = id
        return false
      }
      return true
    })
    return firstId
  }

  destroy() {
    this.emitHide()
    this.fullBlockUnsubscribe?.()
    this.monitorCleanup?.()
  }
}

export const sideMenuPluginKey = new PluginKey('SideMenuPlugin')

export class SideMenuProsemirrorPlugin<BSchema extends BlockSchema> extends EventEmitter<any> {
  public readonly plugin: Plugin
  public readonly blockDragGuardPlugin: Plugin

  constructor(private readonly editor: BlockNoteEditor<BSchema>) {
    super()
    this.plugin = new Plugin({
      key: sideMenuPluginKey,
      view: (editorView) => {
        return new SideMenuView(editor, editorView, (sideMenuState) => {
          this.emit('update', sideMenuState)
        })
      },
    })
    this.blockDragGuardPlugin = createBlockDragGuardPlugin()
  }

  public onUpdate(callback: (state: SideMenuState<BSchema>) => void) {
    return this.on('update', callback)
  }

  /**
   * Legacy no-ops retained for callers that still reference them
   * (media-container.tsx, AddBlockButton, legacy DragHandle props).
   * Pragmatic DnD manages drags via setupBlockDraggable directly.
   */
  addBlock = () => {}
  blockDragStart = (_event: {dataTransfer: DataTransfer | null; clientX?: number; clientY: number}) => {}
  blockDragEnd = () => {}
  freezeMenu = () => {}
  unfreezeMenu = () => {}
}
