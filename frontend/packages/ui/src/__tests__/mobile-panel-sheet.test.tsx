// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {MobilePanelSheet, resolveSheetSnap} from '../mobile-panel-sheet'

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

describe('resizable MobilePanelSheet', () => {
  function renderResizable() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <MobilePanelSheet isOpen title="Activity" onClose={vi.fn()} resizable>
          <div>Updates</div>
        </MobilePanelSheet>,
      )
    })
    return document.body.querySelector<HTMLElement>('[data-slot="mobile-panel-sheet"]')!
  }

  it('opens at about 60% of the screen', () => {
    const sheet = renderResizable()
    expect(sheet.dataset.snap).toBe('partial')
    expect(sheet.style.height).toBe('60dvh')
  })

  it('toggles between 60% and full height when the handle is tapped', () => {
    const sheet = renderResizable()
    const handle = document.body.querySelector('[data-slot="mobile-panel-drag-handle"]')!
    act(() => handle.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(sheet.dataset.snap).toBe('full')
    expect(handle.getAttribute('aria-label')).toBe('Shrink panel')
    act(() => handle.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(sheet.dataset.snap).toBe('partial')
  })

  it('leaves sheets that are not resizable at their fixed height', () => {
    renderSheet()
    const sheet = document.body.querySelector<HTMLElement>('[data-slot="mobile-panel-sheet"]')!
    expect(sheet.dataset.snap).toBeUndefined()
    expect(sheet.style.height).toBe('')
  })
})

describe('resolveSheetSnap', () => {
  // A 1000px-tall screen: rests at 600px or 960px, and closes 160px below the partial height.
  const base = {partialHeight: 600, fullHeight: 960, closeDistance: 160}

  it('settles on the nearer resting height after a slow drag', () => {
    expect(resolveSheetSnap({...base, height: 700, velocity: 0, startSnap: 'partial'})).toBe('partial')
    expect(resolveSheetSnap({...base, height: 850, velocity: 0, startSnap: 'partial'})).toBe('full')
    expect(resolveSheetSnap({...base, height: 700, velocity: 0, startSnap: 'full'})).toBe('partial')
  })

  it('follows a flick even when the drag was short', () => {
    expect(resolveSheetSnap({...base, height: 620, velocity: 1, startSnap: 'partial'})).toBe('full')
    expect(resolveSheetSnap({...base, height: 940, velocity: -1, startSnap: 'full'})).toBe('partial')
  })

  it('closes when flicked down from the partial height', () => {
    expect(resolveSheetSnap({...base, height: 580, velocity: -1, startSnap: 'partial'})).toBe('close')
  })

  it('closes when dragged well below the partial height, and springs back otherwise', () => {
    expect(resolveSheetSnap({...base, height: 400, velocity: 0, startSnap: 'partial'})).toBe('close')
    expect(resolveSheetSnap({...base, height: 500, velocity: 0, startSnap: 'partial'})).toBe('partial')
  })
})
