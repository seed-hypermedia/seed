import {useEffect, useRef, type MutableRefObject} from 'react'
import type {BlockNoteEditor} from './blocknote'
import {applyReadOnlyClickSelectionGuard} from './click-edit-mode-guard'
import type {EditCursorPosition} from '@shm/shared/models/document-machine'
import type {HMBlockSchema} from './schema'

const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading', 'code-block'])

function shouldClearBlockHighlightOnMouseDown(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !target.closest(
    '[data-bn-block-hover-actions="true"], .bn-supernumber-badge, button, a[href], input, textarea, select',
  )
}

function getContentTypeFromTarget(el: Element | null, root: Element): string | null {
  let node: Element | null = el
  while (node && node !== root) {
    const ct = node.getAttribute('data-content-type')
    if (ct !== null) return ct
    node = node.parentElement
  }
  return null
}

export function useReadOnlyClickToEdit({
  editor,
  canEditRef,
  onEditStart,
  onTextSelectionRef,
}: {
  editor: BlockNoteEditor<HMBlockSchema>
  canEditRef: MutableRefObject<boolean>
  onEditStart: (cursorPosition?: EditCursorPosition | null) => void
  onTextSelectionRef: MutableRefObject<(() => void) | undefined>
}) {
  const mousedownCoordsRef = useRef<{x: number; y: number} | null>(null)
  const mousedownHadSelectionRef = useRef<boolean>(false)

  useEffect(() => {
    const view = editor._tiptapEditor?.view
    if (!view) return

    const domRoot = view.dom as HTMLElement

    const handleMousedown = (e: MouseEvent) => {
      mousedownCoordsRef.current = {x: e.clientX, y: e.clientY}
      mousedownHadSelectionRef.current = !view.state.selection.empty
      if (shouldClearBlockHighlightOnMouseDown(e.target)) {
        onTextSelectionRef.current?.()
      }
    }

    const handleClick = (e: MouseEvent) => {
      if (view.editable || !canEditRef.current) {
        return
      }

      const down = mousedownCoordsRef.current
      if (down) {
        const dx = e.clientX - down.x
        const dy = e.clientY - down.y
        if (dx * dx + dy * dy > 16) return
      }

      const target = e.target as Element

      if (target.closest?.('.link, a[href]')) return

      if (target.closest?.('[data-citation-fragment="true"]')) return

      const hadSelection = mousedownHadSelectionRef.current
      mousedownHadSelectionRef.current = false
      if (hadSelection) {
        applyReadOnlyClickSelectionGuard(view, true)
        e.preventDefault()
        return
      }

      const contentType = getContentTypeFromTarget(target, domRoot)
      if (contentType !== null) {
        if (!TEXT_BLOCK_TYPES.has(contentType)) return

        const coords = view.posAtCoords({left: e.clientX, top: e.clientY})
        onEditStart(coords ? coords.pos : null)
        e.preventDefault()
        return
      }

      const editorRect = domRoot.getBoundingClientRect()
      if (e.clientX >= editorRect.left && e.clientX <= editorRect.right && e.clientY > editorRect.bottom) {
        onEditStart('end')
        e.preventDefault()
      }
    }

    const handleTableEditRequest = () => {
      if (view.editable || !canEditRef.current) return
      onEditStart(null)
    }

    domRoot.addEventListener('mousedown', handleMousedown)
    domRoot.addEventListener('click', handleClick)
    domRoot.addEventListener('hm-table-request-edit', handleTableEditRequest)

    return () => {
      domRoot.removeEventListener('mousedown', handleMousedown)
      domRoot.removeEventListener('click', handleClick)
      domRoot.removeEventListener('hm-table-request-edit', handleTableEditRequest)
    }
  }, [editor, onEditStart, canEditRef, onTextSelectionRef])
}
