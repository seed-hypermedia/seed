// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {MobileBackToTop} from '../resource-page-common'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function scrollWindowTo(scrollY: number) {
  Object.defineProperty(window, 'scrollY', {value: scrollY, configurable: true})
  act(() => {
    window.dispatchEvent(new Event('scroll'))
  })
}

describe('MobileBackToTop', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', {value: 800, configurable: true})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  function button() {
    const found = container.querySelector('button')
    if (!found) throw new Error('back to top button not rendered')
    return found
  }

  it('stays hidden and unclickable until the reader is deep in the document', () => {
    scrollWindowTo(0)
    act(() => root.render(<MobileBackToTop />))

    expect(button().className).toContain('pointer-events-none')
    expect(button().className).toContain('opacity-0')
    // Hidden from assistive tech must also mean out of the tab order
    expect(button().getAttribute('aria-hidden')).toBe('true')
    expect(button().tabIndex).toBe(-1)

    // Just under 1.5 viewport heights: still hidden.
    scrollWindowTo(1100)
    expect(button().className).toContain('opacity-0')

    scrollWindowTo(1300)
    expect(button().className).toContain('opacity-100')
    expect(button().className).not.toContain('pointer-events-none')
    expect(button().getAttribute('aria-hidden')).toBe(null)
    expect(button().tabIndex).toBe(0)
  })

  it('scrolls the window back to the top, honoring reduced motion', () => {
    const scrollTo = vi.fn()
    Object.defineProperty(window, 'scrollTo', {value: scrollTo, configurable: true})
    const prefersReducedMotion = vi.fn(() => false)
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({matches: prefersReducedMotion()}),
      configurable: true,
    })

    scrollWindowTo(2000)
    act(() => root.render(<MobileBackToTop />))

    act(() => button().dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(scrollTo).toHaveBeenLastCalledWith({top: 0, behavior: 'smooth'})

    prefersReducedMotion.mockReturnValue(true)
    act(() => button().dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(scrollTo).toHaveBeenLastCalledWith({top: 0, behavior: 'auto'})
  })
})
