// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AUTO_LOAD_PAGE_LIMIT, useExploreAutoLoad} from '../explore-page'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let observers: MockIntersectionObserver[] = []

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  disconnected = false
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    observers.push(this)
  }
  observe() {}
  disconnect() {
    this.disconnected = true
  }
  unobserve() {}
  takeRecords() {
    return []
  }
  trigger() {
    this.callback([{isIntersecting: true} as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

beforeEach(() => {
  observers = []
  ;(globalThis as typeof globalThis & {IntersectionObserver?: typeof IntersectionObserver}).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Harness(props: {enabled: boolean; busy: boolean; resetKey: string; onLoadMore: () => void}) {
  const {sentinelRef} = useExploreAutoLoad(props)
  return <div ref={sentinelRef} />
}

function render(props: {enabled?: boolean; busy?: boolean; resetKey?: string; onLoadMore: () => void}) {
  const full = {enabled: true, busy: false, resetKey: 'query', ...props}
  act(() => root.render(<Harness {...full} />))
  return (next: Partial<typeof full> = {}) => act(() => root.render(<Harness {...full} {...next} />))
}

/** Latest observer, since each re-subscription builds a new one. */
function live() {
  return observers.filter((observer) => !observer.disconnected).at(-1)
}

describe('Explore auto load', () => {
  it('fetches the next page when the sentinel comes into view', () => {
    const onLoadMore = vi.fn()
    render({onLoadMore})
    act(() => live()!.trigger())
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not observe while a page is already in flight', () => {
    const onLoadMore = vi.fn()
    render({busy: true, onLoadMore})
    expect(live()).toBeUndefined()
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does not observe once there are no more pages', () => {
    const onLoadMore = vi.fn()
    render({enabled: false, onLoadMore})
    expect(live()).toBeUndefined()
  })

  it('stops after the page budget so a parked sentinel cannot walk the corpus', () => {
    const onLoadMore = vi.fn()
    const rerender = render({onLoadMore})
    for (let page = 0; page < AUTO_LOAD_PAGE_LIMIT + 3; page++) {
      const observer = live()
      if (!observer) break
      act(() => observer.trigger())
      // Each fetch settles before the next, the way a real page load does.
      rerender({busy: true})
      rerender({busy: false})
    }
    expect(onLoadMore).toHaveBeenCalledTimes(AUTO_LOAD_PAGE_LIMIT)
    expect(live()).toBeUndefined()
  })

  it('gives a new search its own budget', () => {
    const onLoadMore = vi.fn()
    const rerender = render({onLoadMore})
    for (let page = 0; page < AUTO_LOAD_PAGE_LIMIT; page++) {
      const observer = live()
      if (!observer) break
      act(() => observer.trigger())
      rerender({busy: true})
      rerender({busy: false})
    }
    expect(live()).toBeUndefined()
    rerender({resetKey: 'another query'})
    expect(live()).toBeDefined()
    act(() => live()!.trigger())
    expect(onLoadMore).toHaveBeenCalledTimes(AUTO_LOAD_PAGE_LIMIT + 1)
  })
})
