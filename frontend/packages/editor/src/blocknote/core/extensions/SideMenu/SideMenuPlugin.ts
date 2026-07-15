import {Plugin, PluginKey, PluginView} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import type {BlockNoteEditor} from '../../BlockNoteEditor'
import {BaseUiElementState} from '../../shared/BaseUiElementTypes'
import type {Block, BlockSchema} from '../Blocks/api/blockTypes'
import {createBlockDragGuardPlugin, setupDragMonitor} from './pragmatic-dnd-bridge'

export type SideMenuState<BSchema extends BlockSchema> = BaseUiElementState & {
  block: Block<BSchema>
  lineHeight: string
}

/**
 * PluginView that wires up the pragmatic drag-and-drop monitor for the editor.
 *
 * Selection state is NOT mirrored here: the side menu (block tools) derives its
 * visibility directly from the FullBlockSelection plugin in SideMenuPositioner,
 * the same single source that drives the selection outline — so the two can
 * never disagree.
 */
class SideMenuDragView<BSchema extends BlockSchema> implements PluginView {
  private monitorCleanup?: () => void

  constructor(editor: BlockNoteEditor<BSchema>, pmView: EditorView) {
    if (editor.dragStateManager && editor.editorDragId) {
      this.monitorCleanup = setupDragMonitor(
        pmView.dom as HTMLElement,
        editor,
        editor.dragStateManager,
        editor.editorDragId,
      )
    }
  }

  destroy() {
    this.monitorCleanup?.()
  }
}

export const sideMenuPluginKey = new PluginKey('SideMenuPlugin')

export class SideMenuProsemirrorPlugin<BSchema extends BlockSchema> {
  public readonly plugin: Plugin
  public readonly blockDragGuardPlugin: Plugin

  constructor(editor: BlockNoteEditor<BSchema>) {
    this.plugin = new Plugin({
      key: sideMenuPluginKey,
      view: (editorView) => new SideMenuDragView(editor, editorView),
    })
    this.blockDragGuardPlugin = createBlockDragGuardPlugin()
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
