// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {MobilePanelSheet} from '../mobile-panel-sheet'

let root: Root | null = null
let container: HTMLDivElement | null = null

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

function dispatchPointerEvent(element: Element, type: string, clientY: number) {
  const event = new Event(type, {bubbles: true}) as Event & {clientY: number; pointerId: number}
  event.clientY = clientY
  event.pointerId = 1
  element.dispatchEvent(event)
}

function renderSheet(onClose = vi.fn()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root!.render(
      <MobilePanelSheet isOpen title="Comments" onClose={onClose}>
        <div>Thread content</div>
      </MobilePanelSheet>,
    )
  })

  return {onClose}
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  container?.remove()
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.width = ''
  vi.restoreAllMocks()
  root = null
  container = null
})

describe('MobilePanelSheet', () => {
  it('renders as a polished bottom sheet instead of a flat full-screen panel', () => {
    renderSheet()

    const overlay = document.body.querySelector('[data-slot="mobile-panel-overlay"]')
    const dialog = document.body.querySelector('[role="dialog"]')
    const dragHandle = document.body.querySelector('[aria-hidden="true"]')

    expect(overlay?.className).toContain('items-end')
    expect(dialog?.className).toContain('rounded-t-3xl')
    expect(dialog?.className).toContain('h-[90dvh]')
    expect(dragHandle).not.toBeNull()
  })

  it('locks document and body scroll while open', () => {
    renderSheet()

    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.width).toBe('100%')
  })

  it('keeps the overlay interactive while the opening animation settles', () => {
    renderSheet()

    const overlay = document.body.querySelector('[data-slot="mobile-panel-overlay"]')

    expect(overlay?.className).toContain('pointer-events-auto')
    expect(overlay?.className).not.toContain('pointer-events-none')
  })

  it('exposes a drag handle for touch resizing gestures', () => {
    renderSheet()

    const dragHandle = document.body.querySelector('[data-slot="mobile-panel-drag-handle"]')

    expect(dragHandle).not.toBeNull()
    expect(dragHandle?.getAttribute('aria-label')).toBe('Drag panel')
  })

  it('closes when the drag handle is pulled down past the snap threshold', () => {
    const {onClose} = renderSheet()
    const dragHandle = document.body.querySelector('[data-slot="mobile-panel-drag-handle"]')

    act(() => {
      dispatchPointerEvent(dragHandle!, 'pointerdown', 100)
    })
    act(() => {
      dispatchPointerEvent(dragHandle!, 'pointermove', 320)
    })
    act(() => {
      dispatchPointerEvent(dragHandle!, 'pointerup', 320)
    })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape', () => {
    const {onClose} = renderSheet()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))
    })

    expect(onClose).toHaveBeenCalledOnce()
  })
})
