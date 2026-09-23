// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {useDocumentLayout} from '../layout'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../use-media', () => ({useMedia: () => ({gtSm: true})}))

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function LayoutHarness() {
  const layout = useDocumentLayout({contentWidth: 'M', showSidebars: true})

  return (
    <div ref={layout.elementRef}>
      <div data-testid="document-wrapper" {...layout.wrapperProps} />
    </div>
  )
}

describe('useDocumentLayout', () => {
  it('centers the document column when the viewport has no room for sidebars', () => {
    act(() => root.render(<LayoutHarness />))

    expect(container.querySelector('[data-testid="document-wrapper"]')?.className).toContain('justify-center')
  })
})
