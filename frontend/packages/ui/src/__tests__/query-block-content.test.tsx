// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('../document-list-item', () => ({
  DocumentListItem: ({item}: any) => <div data-testid="query-row">{item.metadata.name}</div>,
}))
vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({isLoading: false, data: {citations: 0}}),
}))

import {QueryBlockContent} from '../query-block-content'
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

function renderQueryBlock(style: 'Card' | 'List' | 'Table') {
  act(() => {
    root.render(<QueryBlockContent items={[]} style={style} accountsMetadata={{}} isDiscovering />)
  })
}

function makeItems(count: number) {
  return Array.from({length: count}, (_, index) => ({
    id: {id: `hm://doc-${index}`, uid: 'alice', path: ['docs', String(index)]},
    metadata: {name: `Item ${index}`},
    authors: [],
  })) as any
}

describe('QueryBlockContent loading state', () => {
  it('shows a spinner while a list query block is loading', () => {
    renderQueryBlock('List')

    expect(container.textContent).toContain('Searching for documents…')
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows a spinner while a card query block is loading', () => {
    renderQueryBlock('Card')

    expect(container.textContent).toContain('Searching for documents…')
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows a spinner while a table query block is loading', () => {
    renderQueryBlock('Table')

    expect(container.textContent).toContain('Searching for documents…')
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })
})

describe('QueryBlockContent table view', () => {
  it('stretches columns across the available table width while preserving horizontal overflow', () => {
    act(() => {
      root.render(<QueryBlockContent items={makeItems(1)} style="Table" accountsMetadata={{}} />)
    })

    const table = container.querySelector('table')
    expect(table?.style.width).toBe('100%')
    expect(table?.style.minWidth).toMatch(/px$/)
  })

  it('renders discovered custom attributes in the default column order', () => {
    const items = makeItems(1)
    items[0].metadata.status = 'Ready'

    act(() => {
      root.render(<QueryBlockContent items={items} style="Table" accountsMetadata={{}} />)
    })

    expect(Array.from(container.querySelectorAll('th')).map((cell) => cell.textContent)).toEqual([
      'Title',
      'status',
      'Comments',
      'Citations',
      'Updated',
      'Authors',
    ])
    expect(container.textContent).toContain('Ready')
  })
})

describe('QueryBlockContent progressive list rendering', () => {
  it('renders an initial chunk of rows, then loads more when the sentinel nears the viewport', () => {
    act(() => {
      root.render(<QueryBlockContent items={makeItems(30)} style="List" accountsMetadata={{}} />)
    })

    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(25)
    expect(container.textContent).toContain('Item 24')
    expect(container.textContent).not.toContain('Item 25')
    expect(observers).toHaveLength(1)

    act(() => {
      observers[0]?.trigger(true)
    })

    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(30)
    expect(container.textContent).toContain('Item 29')
  })
})
