// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
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
})
