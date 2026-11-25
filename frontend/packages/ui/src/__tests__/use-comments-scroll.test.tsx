// @vitest-environment jsdom
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, expect, test, vi} from 'vitest'
import {useCommentsScroll} from '../use-comments-scroll'

globalThis.React = React
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
let resize: () => void
let height = 1000
let result: ReturnType<typeof useCommentsScroll>
function List({id, own, ids = ['a', 'b']}: {id: string; own?: string; ids?: string[]}) {
  result = useCommentsScroll(id, ids, true, own)
  return (
    <div ref={result.listRef}>
      {ids.map((id) => (
        <div key={id} data-comment-id={id} />
      ))}
    </div>
  )
}
function setup() {
  height = 1000
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  container = document.createElement('div')
  container.style.overflowY = 'auto'
  Object.defineProperties(container, {
    scrollHeight: {get: () => height},
    clientHeight: {configurable: true, value: 200},
  })
  document.body.append(container)
  root = createRoot(container)
}
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
test('starts at the bottom and follows content growth', () => {
  setup()
  act(() => root.render(<List id="initial" />))
  expect(container.scrollTop).toBe(800)
  height = 1200
  act(() => resize())
  expect(container.scrollTop).toBe(1000)
})
test('preserves a reader position and reports new roots until they jump to bottom', () => {
  setup()
  act(() => root.render(<List id="reading" />))
  act(() => {
    container.scrollTop = 150
    container.dispatchEvent(new Event('scroll'))
  })
  height = 1300
  act(() => root.render(<List id="reading" ids={['a', 'b', 'c']} />))
  act(() => resize())
  expect(container.scrollTop).toBe(150)
  expect(result.hasNewComments).toBe(true)
  act(() => result.scrollToBottom())
  expect(container.scrollTop).toBe(1100)
  expect(result.hasNewComments).toBe(false)
})
test('restores the root position after unmount even when new comments arrived', () => {
  setup()
  act(() => root.render(<List id="return" />))
  act(() => {
    container.scrollTop = 240
    container.dispatchEvent(new Event('scroll'))
  })
  act(() => root.render(null))
  container.scrollTop = 0
  height = 1400
  act(() => root.render(<List id="return" ids={['a', 'b', 'c']} />))
  expect(container.scrollTop).toBe(240)
  expect(result.hasNewComments).toBe(true)
})
test('scrolls to the users own submitted root even when reading older roots', () => {
  setup()
  act(() => root.render(<List id="own" />))
  act(() => {
    container.scrollTop = 100
    container.dispatchEvent(new Event('scroll'))
  })
  height = 1200
  act(() => root.render(<List id="own" own="c" ids={['a', 'b', 'c']} />))
  expect(container.scrollTop).toBe(1000)
})
test('uses the panel viewport before Radix enables scrolling', () => {
  setup()
  container.style.overflowY = 'hidden'
  container.setAttribute('data-radix-scroll-area-viewport', '')
  act(() => root.render(<List id="radix" />))
  expect(container.scrollTop).toBe(800)
})
test('continues following new comments after returning to a list that fits the viewport', () => {
  setup()
  height = 150
  act(() => root.render(<List id="short-list" />))
  act(() => root.render(null))
  act(() => root.render(<List id="short-list" />))
  height = 400
  act(() => root.render(<List id="short-list" ids={['a', 'b', 'c']} />))
  expect(container.scrollTop).toBe(200)
  expect(result.hasNewComments).toBe(false)
})
test('restores the same visible root when an earlier row changes height', () => {
  setup()
  let firstHeight = 100
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const id = this.dataset.commentId
    const top = id === 'a' ? -container.scrollTop : id === 'b' ? firstHeight - container.scrollTop : 0
    return {top, bottom: top + (id === 'a' ? firstHeight : id === 'b' ? 300 : 0)} as DOMRect
  })
  act(() => root.render(<List id="anchor" />))
  act(() => {
    container.scrollTop = 120
    container.dispatchEvent(new Event('scroll'))
  })
  act(() => root.render(null))
  container.scrollTop = 0
  firstHeight = 180
  act(() => root.render(<List id="anchor" />))
  expect(container.scrollTop).toBe(200)
  expect(container.querySelector('[data-comment-id="b"]')!.getBoundingClientRect().top).toBe(-20)
  geometry.mockRestore()
})
test('restores native document scrolling used by expanded mobile comments', () => {
  setup()
  container.style.overflowY = 'visible'
  Object.defineProperty(document, 'scrollingElement', {configurable: true, value: document.documentElement})
  Object.defineProperties(document.documentElement, {
    scrollHeight: {configurable: true, get: () => height},
    clientHeight: {configurable: true, value: 200},
  })
  act(() => root.render(<List id="native" />))
  expect(document.documentElement.scrollTop).toBe(800)
  act(() => {
    document.documentElement.scrollTop = 120
    document.dispatchEvent(new Event('scroll'))
  })
  act(() => root.render(null))
  document.documentElement.scrollTop = 0
  act(() => root.render(<List id="native" />))
  expect(document.documentElement.scrollTop).toBe(120)
})
test('keeps following when the composer shrinks the viewport before the initial scroll event', () => {
  setup()
  let viewportHeight = 200
  // The footer portal mounts after the first layout pass in expanded comments.
  Object.defineProperty(container, 'clientHeight', {configurable: true, get: () => viewportHeight})
  act(() => root.render(<List id="footer-resize" />))
  expect(container.scrollTop).toBe(800)
  viewportHeight = 100
  act(() => container.dispatchEvent(new Event('scroll')))
  height = 1200
  act(() => resize())
  expect(container.scrollTop).toBe(1100)
  expect(result.hasNewComments).toBe(false)
})
