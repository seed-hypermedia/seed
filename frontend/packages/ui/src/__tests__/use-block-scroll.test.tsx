// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {useBlockScroll} from '../use-block-scroll'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * jsdom performs no layout, so the geometry the hook reads has to be provided
 * explicitly. Everything else (container lookup, scroll math) is the real code.
 */
function stubRect(element: HTMLElement, top: number) {
  element.getBoundingClientRect = () => ({top, bottom: top, left: 0, right: 0, width: 0, height: 0}) as DOMRect
}

describe('useBlockScroll', () => {
  let host: HTMLDivElement
  let root: Root
  let scrollContainer: HTMLDivElement
  let block: HTMLDivElement
  let scrollCalls: ScrollToOptions[]

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)

    scrollContainer = document.createElement('div')
    scrollContainer.style.overflowY = 'auto'
    Object.defineProperty(scrollContainer, 'scrollHeight', {value: 5000, configurable: true})
    Object.defineProperty(scrollContainer, 'clientHeight', {value: 800, configurable: true})
    scrollContainer.scrollTop = 1000
    scrollCalls = []
    scrollContainer.scrollTo = ((options: ScrollToOptions) => {
      scrollCalls.push(options)
    }) as HTMLElement['scrollTo']
    stubRect(scrollContainer, 100)

    block = document.createElement('div')
    block.id = 'block-1'
    stubRect(block, 400)
    scrollContainer.appendChild(block)
    document.body.appendChild(scrollContainer)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    scrollContainer.remove()
  })

  it('waits for the two-frame editor handoff before scrolling on initial load', () => {
    vi.useFakeTimers()
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame
    const originalWindowScrollTo = window.scrollTo
    const animationFrames: FrameRequestCallback[] = []
    const windowScrollCalls: ScrollToOptions[] = []
    window.requestAnimationFrame = (callback) => {
      animationFrames.push(callback)
      return animationFrames.length
    }
    window.cancelAnimationFrame = () => {}
    window.scrollTo = ((options: ScrollToOptions) => windowScrollCalls.push(options)) as typeof window.scrollTo
    Object.defineProperty(scrollContainer, 'scrollHeight', {value: 800, configurable: true})

    function Harness() {
      useBlockScroll('block-1')
      return null
    }

    try {
      act(() => root.render(<Harness />))
      act(() => animationFrames.shift()?.(0))
      act(() => vi.advanceTimersByTime(0))
      expect(scrollCalls).toEqual([])
      expect(windowScrollCalls).toEqual([])

      Object.defineProperty(scrollContainer, 'scrollHeight', {value: 5000, configurable: true})
      act(() => animationFrames.shift()?.(16))
      act(() => vi.advanceTimersByTime(0))

      expect(scrollCalls).toEqual([{top: 1284, behavior: 'smooth'}])
      expect(windowScrollCalls).toEqual([])
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
      window.scrollTo = originalWindowScrollTo
      vi.useRealTimers()
    }
  })

  it('leaves only a small margin above the target block', () => {
    let scrollToBlock: ((blockId: string) => void) | undefined

    function Harness() {
      scrollToBlock = useBlockScroll(null).scrollToBlock
      return null
    }

    act(() => root.render(<Harness />))
    act(() => scrollToBlock?.('block-1'))

    // scrollTop (1000) + element top (400) - container top (100) - 16px margin
    expect(scrollCalls).toEqual([{top: 1284, behavior: 'smooth'}])
  })

  it('clears the pinned document top bar when the document itself scrolls', () => {
    // Mobile web: no scrolling ancestor, and the top bar is pinned over the page.
    const looseBlock = document.createElement('div')
    looseBlock.id = 'block-2'
    stubRect(looseBlock, 500)
    document.body.appendChild(looseBlock)

    const bar = document.createElement('div')
    bar.setAttribute('data-document-top-bar', '')
    bar.style.position = 'sticky'
    bar.getBoundingClientRect = () => ({top: 0, bottom: 48, left: 0, right: 0, width: 0, height: 48}) as DOMRect
    document.body.appendChild(bar)

    const windowScrollCalls: ScrollToOptions[] = []
    window.scrollTo = ((options: ScrollToOptions) => {
      windowScrollCalls.push(options)
    }) as typeof window.scrollTo
    Object.defineProperty(window, 'scrollY', {value: 200, configurable: true})

    let scrollToBlock: ((blockId: string) => void) | undefined
    function Harness() {
      scrollToBlock = useBlockScroll(null).scrollToBlock
      return null
    }

    act(() => root.render(<Harness />))
    act(() => scrollToBlock?.('block-2'))

    // element top (500) + scrollY (200) - 16px margin - 48px bar
    expect(windowScrollCalls).toEqual([{top: 636, behavior: 'smooth'}])

    looseBlock.remove()
    bar.remove()
  })
})
