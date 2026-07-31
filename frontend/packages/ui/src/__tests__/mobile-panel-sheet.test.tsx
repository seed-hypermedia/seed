// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {MobilePanelSheet} from '../mobile-panel-sheet'

let root: Root | null = null
let container: HTMLDivElement | null = null

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

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
    expect(dialog?.className).toContain('max-h-[92dvh]')
    expect(dragHandle).not.toBeNull()
  })

  it('locks document and body scroll while open', () => {
    renderSheet()

    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('closes on Escape', () => {
    const {onClose} = renderSheet()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))
    })

    expect(onClose).toHaveBeenCalledOnce()
  })
})
