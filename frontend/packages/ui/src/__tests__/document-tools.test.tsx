// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared'
import {DocumentTools} from '../document-tools'

vi.mock('../page-tabs', () => ({
  PageTab: ({label, count, showZeroCount}: {label?: string; count?: number; showZeroCount?: boolean}) => (
    <span data-label={label} data-count={count} data-show-zero-count={showZeroCount}>
      {label}
    </span>
  ),
}))
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverStub {
  observe() {}
  unobserve() {}
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

describe('DocumentTools', () => {
  it('shows the Attributes tab with a zero count when the document has no custom attributes', () => {
    act(() => {
      root.render(<DocumentTools id={hmId('alice', {path: ['doc']})} metadataCount={0} />)
    })

    const attributesTabs = container.querySelectorAll('[data-label="Attributes"]')
    expect(attributesTabs).toHaveLength(2)
    expect(Array.from(attributesTabs).every((tab) => tab.getAttribute('data-count') === '0')).toBe(true)
    expect(Array.from(attributesTabs).every((tab) => tab.getAttribute('data-show-zero-count') === 'true')).toBe(true)
  })
})
