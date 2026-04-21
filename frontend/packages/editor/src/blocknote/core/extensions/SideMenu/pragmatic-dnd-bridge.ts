/**
 * Bridge between Pragmatic Drag and Drop and the editor.
 *
 * Provides setup functions that wire Pragmatic DnD's draggable(),
 * dropTargetForElements(), and monitorForElements() to the
 * DragStateManager and block-move-executor.
 */
import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {draggable, dropTargetForElements, monitorForElements} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {setCustomNativeDragPreview} from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview'
import {autoScrollForElements} from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import {unsafeOverflowAutoScrollForElements} from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/unsafe-overflow/element'
import {Plugin, PluginKey} from 'prosemirror-state'
import type {BlockNoteEditor} from '../../BlockNoteEditor'
import type {BlockSchema} from '../../extensions/Blocks/api/blockTypes'
import {executeBlockMove} from './block-move-executor'
import type {DragStateManager} from './drag-state'
import {fullBlockSelectionPluginKey} from '../FullBlockSelection/FullBlockSelectionPlugin'
import {attachHitboxData, extractDropInstruction, getBlockLevel, getContainerType, getItemMode} from './hitbox-strategy'
import {MultipleNodeSelection} from './MultipleNodeSelection'

type CleanupFn = () => void

const EDITOR_BLOCK_TYPE = 'editor-block'

// Unique editor ID counter for scoping drops to a single editor instance
let editorIdCounter = 0

/**
 * Creates a unique ID for an editor instance, used to scope
 * drag-and-drop to a single editor.
 */
export function createEditorDragId(): string {
  return `editor-${++editorIdCounter}`
}

// ---------------------------------------------------------------------------
// Setup: make a drag handle draggable
// ---------------------------------------------------------------------------

export function setupBlockDraggable<BSchema extends BlockSchema>(
  element: HTMLElement,
  dragHandleEl: HTMLElement,
  getBlockId: () => string | undefined,
  editor: BlockNoteEditor<BSchema>,
  stateManager: DragStateManager,
  editorDragId: string,
): CleanupFn {
  return draggable({
    element,
    dragHandle: dragHandleEl,
    getInitialData() {
      const blockId = getBlockId()
      if (!blockId) return {type: EDITOR_BLOCK_TYPE, blockIds: [], editorId: editorDragId}

      const selection = editor.prosemirrorView.state.selection
      let blockIds: string[] = [blockId]

      if (selection instanceof MultipleNodeSelection) {
        const selectedIds: string[] = []
        selection.content().content.forEach((node) => {
          if (node.type.name === 'blockNode' && node.attrs.id) {
            selectedIds.push(node.attrs.id)
          }
        })
        if (selectedIds.length > 0 && selectedIds.includes(blockId)) {
          blockIds = selectedIds
        }
      } else {
        const fullBlockState = fullBlockSelectionPluginKey.getState(editor.prosemirrorView.state)
        if (fullBlockState && fullBlockState.blockIds.length > 0 && fullBlockState.blockIds.includes(blockId)) {
          blockIds = fullBlockState.blockIds
        }
      }

      return {type: EDITOR_BLOCK_TYPE, blockIds, editorId: editorDragId}
    },
    onGenerateDragPreview({source, nativeSetDragImage}) {
      const blockIds = (source.data.blockIds as string[]) || []
      stateManager.dispatch({type: 'PREVIEW', sourceBlockIds: blockIds})

      // Create a simple drag preview by cloning the block element
      setCustomNativeDragPreview({
        nativeSetDragImage,
        render({container}) {
          const blockId = blockIds[0]
          if (!blockId) return

          const blockEl = editor.prosemirrorView.dom.querySelector(`[data-id="${blockId}"]`)
          if (!blockEl) return

          const clone = blockEl.cloneNode(true) as HTMLElement
          clone.style.width = `${blockEl.getBoundingClientRect().width}px`
          clone.style.opacity = '0.7'
          clone.style.transform = 'rotate(1deg)'
          container.appendChild(clone)
        },
      })
    },
    onDragStart() {
      stateManager.dispatch({type: 'START'})
    },
    onDrop({source, location}) {
      const state = stateManager.getState()
      if (state.type === 'dragging' && state.instruction) {
        const blockIds = (source.data.blockIds as string[]) || []
        executeBlockMove(editor, blockIds, state.instruction)
      }
      stateManager.dispatch({type: 'DROP'})
    },
  })
}

// ---------------------------------------------------------------------------
// Setup: make a block element a drop target
// ---------------------------------------------------------------------------

export function setupBlockDropTarget<BSchema extends BlockSchema>(
  element: HTMLElement,
  getBlockId: () => string,
  _editor: BlockNoteEditor<BSchema>,
  stateManager: DragStateManager,
  editorDragId: string,
): CleanupFn {
  return dropTargetForElements({
    element,
    canDrop({source}) {
      // Only accept drags from our editor
      if (source.data.type !== EDITOR_BLOCK_TYPE) return false
      if (source.data.editorId !== editorDragId) return false

      // Don't allow dropping on self
      const blockIds = (source.data.blockIds as string[]) || []
      const myId = getBlockId()
      return !blockIds.includes(myId)
    },
    getData({input, element}) {
      const myId = getBlockId()
      const containerType = getContainerType(element as HTMLElement)
      const level = getBlockLevel(element as HTMLElement)
      const mode = getItemMode(element as HTMLElement)

      const data: Record<string | symbol, unknown> = {
        blockId: myId,
        containerType,
      }

      return attachHitboxData(data, element, input, containerType, level, mode)
    },
  })
}

// ---------------------------------------------------------------------------
// Setup: global monitor + auto-scroll
// ---------------------------------------------------------------------------

export function setupDragMonitor<BSchema extends BlockSchema>(
  editorElement: HTMLElement,
  _editor: BlockNoteEditor<BSchema>,
  stateManager: DragStateManager,
  editorDragId: string,
): CleanupFn {
  const monitorCleanup = monitorForElements({
    canMonitor({source}) {
      return source.data.type === EDITOR_BLOCK_TYPE && source.data.editorId === editorDragId
    },
    onDrag({location}) {
      updateInstruction(location, stateManager)
    },
    onDropTargetChange({location}) {
      updateInstruction(location, stateManager)
    },
    onDrop() {
      const state = stateManager.getState()
      if (state.type !== 'idle') {
        stateManager.dispatch({type: 'DROP'})
      }
    },
  })

  // Auto-scroll setup is deferred because the editor DOM isn't fully
  // mounted to the document tree when the ProseMirror plugin view is created.
  // We retry until the scroll container is found (max ~5s).
  let autoScrollCleanup: CleanupFn | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  const MAX_RETRIES = 10

  function trySetupAutoScroll() {
    const scrollContainer = findScrollContainer(editorElement)
    if (scrollContainer) {
      autoScrollCleanup = combine(
        autoScrollForElements({
          element: scrollContainer,
          getConfiguration: () => ({maxScrollSpeed: 'fast'}),
        }),
        unsafeOverflowAutoScrollForElements({
          element: scrollContainer,
          getConfiguration: () => ({maxScrollSpeed: 'fast'}),
          getOverflow: () => ({
            forTopEdge: {top: 60},
            forBottomEdge: {bottom: 60},
          }),
        }),
      )
      return
    }
    retries++
    if (retries < MAX_RETRIES) {
      retryTimer = setTimeout(trySetupAutoScroll, 500)
    }
  }

  trySetupAutoScroll()

  return () => {
    monitorCleanup()
    autoScrollCleanup?.()
    if (retryTimer) clearTimeout(retryTimer)
  }
}

// ---------------------------------------------------------------------------
// ProseMirror plugin to prevent native block drag handling
// ---------------------------------------------------------------------------

export const pragmaticDndPluginKey = new PluginKey('pragmatic-dnd-block-drag')

/**
 * Creates a ProseMirror plugin that prevents PM's default drag handling
 * for block-level drags (initiated from the drag handle).
 * Inline text selection drags are left untouched.
 */
export function createBlockDragGuardPlugin(): Plugin {
  return new Plugin({
    key: pragmaticDndPluginKey,
    props: {
      handleDOMEvents: {
        dragstart(_view, event) {
          const rawTarget = event.target as Node | null
          const targetEl: HTMLElement | null =
            rawTarget && rawTarget.nodeType === 1 ? (rawTarget as HTMLElement) : rawTarget?.parentElement ?? null
          if (!targetEl) return false

          if (targetEl.closest('[data-drag-handle]')) {
            // Drag originated from the SideMenu — let Pragmatic DnD own it.
            return true
          }

          return false
        },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateInstruction(
  location: {current: {dropTargets: Array<{data: Record<string | symbol, unknown>}>}},
  stateManager: DragStateManager,
) {
  const innerTarget = location.current.dropTargets[0]
  if (!innerTarget) {
    stateManager.dispatch({type: 'UPDATE_INSTRUCTION', instruction: null})
    return
  }

  const containerType = (innerTarget.data.containerType as 'tree' | 'grid') || 'tree'
  const targetBlockId = innerTarget.data.blockId as string
  if (!targetBlockId) {
    stateManager.dispatch({type: 'UPDATE_INSTRUCTION', instruction: null})
    return
  }

  const instruction = extractDropInstruction(innerTarget.data, containerType, targetBlockId)
  stateManager.dispatch({type: 'UPDATE_INSTRUCTION', instruction})
}

/**
 * Finds the nearest scrollable ancestor of the editor element.
 * Handles Radix ScrollArea viewports (data-slot="scroll-area-viewport")
 * and native overflow containers.
 */
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  // Walk up the DOM looking for scrollable containers
  let current: HTMLElement | null = el.parentElement
  while (current) {
    // Radix ScrollArea viewport: always the correct scroll target
    if (
      current.hasAttribute('data-radix-scroll-area-viewport') ||
      current.getAttribute('data-slot') === 'scroll-area-viewport'
    ) {
      return current
    }

    if (isScrollable(current)) return current
    current = current.parentElement
  }

  return null
}

function isScrollable(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  const overflow = style.overflow + style.overflowY
  return overflow.includes('auto') || overflow.includes('scroll')
}
