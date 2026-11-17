// @vitest-environment jsdom
import React, {StrictMode} from 'react'
import {renderToString} from 'react-dom/server'
import {createRoot, hydrateRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentContentHandoff} from '../document-content-handoff'
;(globalThis as any).React = React
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root | undefined
let frames: Map<number, FrameRequestCallback>
let frameId = 0

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  frames = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  container.remove()
  vi.unstubAllGlobals()
})

function frame() {
  act(() => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(0))
  })
}

function page(html?: string | null, mounted = false) {
  return (
    <StrictMode>
      <DocumentContentHandoff ssrContentHTML={html} editorMounted={mounted}>
        {mounted ? <p>Live editor</p> : null}
      </DocumentContentHandoff>
    </StrictMode>
  )
}

describe('DocumentContentHandoff', () => {
  it('hydrates the existing DOM without loader HTML and retains it for two editor frames', async () => {
    container.innerHTML = renderToString(page('<p>SSR content</p>'))
    const placeholder = container.querySelector('[id]')!
    Object.defineProperty(placeholder, 'offsetHeight', {value: 240})
    const onRecoverableError = vi.fn()
    await act(async () => {
      root = hydrateRoot(container, page(), {onRecoverableError})
    })
    expect(container.querySelector('[id]')).toBe(placeholder)
    expect(placeholder.innerHTML).toBe('<p>SSR content</p>')
    expect(onRecoverableError).not.toHaveBeenCalled()

    act(() => root!.render(page(undefined, true)))
    expect(container.firstElementChild?.getAttribute('style')).toContain('min-height: 240px')
    expect(container.textContent).toContain('SSR content')
    frame()
    expect(container.querySelector('[id]')).toBe(placeholder)
    frame()
    expect(container.querySelector('[id]')).toBeNull()
    expect(container.textContent).toBe('Live editor')
    expect(container.firstElementChild?.getAttribute('style')).not.toContain('min-height')
  })

  it('supports client navigation with loader HTML and no existing DOM', () => {
    act(() => {
      root = createRoot(container)
      root.render(page('<p>Navigation content</p>'))
    })
    expect(container.textContent).toBe('Navigation content')
  })

  it('renders the children directly when there is no SSR content', () => {
    act(() => {
      root = createRoot(container)
      root.render(page(null, true))
    })
    expect(container.innerHTML).toBe('<p>Live editor</p>')
  })
})
