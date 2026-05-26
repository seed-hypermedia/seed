// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {LazyViewportMount} from '../lazy-viewport-mount'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let observers: MockIntersectionObserver[] = []

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    observers.push(this)
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return []
  }
  trigger(isIntersecting: boolean) {
    this.callback([{isIntersecting} as IntersectionObserverEntry], this as unknown as IntersectionObserver)
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
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('LazyViewportMount', () => {
  it('mounts children immediately when active', () => {
    act(() => {
      root.render(
        <LazyViewportMount active>
          <div>Mounted</div>
        </LazyViewportMount>,
      )
    })

    expect(container.textContent).toContain('Mounted')
    expect(observers).toHaveLength(0)
  })

  it('mounts children after entering the viewport', () => {
    act(() => {
      root.render(
        <LazyViewportMount>
          <div>Mounted</div>
        </LazyViewportMount>,
      )
    })

    expect(container.textContent).not.toContain('Mounted')
    expect(observers).toHaveLength(1)

    act(() => {
      observers[0]?.trigger(true)
    })

    expect(container.textContent).toContain('Mounted')
  })
})
