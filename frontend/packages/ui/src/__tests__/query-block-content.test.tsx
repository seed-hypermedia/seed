// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({isLoading: false, data: {citations: 0}}),
  useInteractionSummaries: () => [{data: {citations: 2}}, {data: {citations: 8}}],
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
  it('sorts authors alphabetically by their displayed names', () => {
    const items = makeItems(2)
    items[0].metadata.name = 'Zed document'
    items[0].authors = ['z-author']
    items[1].metadata.name = 'Alpha document'
    items[1].authors = ['a-author']

    act(() => {
      root.render(
        <QueryBlockContent
          items={items}
          style="Table"
          tableSorting={[]}
          tableConfig={{columns: [{id: 'authors', visible: true}]}}
          accountsMetadata={
            {
              'z-author': {id: {uid: 'z-author'}, metadata: {name: 'Zelda'}},
              'a-author': {id: {uid: 'a-author'}, metadata: {name: 'Alice'}},
            } as any
          }
        />,
      )
    })

    const authorsHeading = Array.from(container.querySelectorAll('thead button')).find(
      (button) => button.textContent?.includes('Authors'),
    )
    expect(authorsHeading?.className).toContain('inset-0')
    act(() => authorsHeading?.dispatchEvent(new MouseEvent('click', {bubbles: true})))

    expect(Array.from(container.querySelectorAll('tbody tr a')).map((link) => link.textContent)).toEqual([
      'Alpha document',
      'Zed document',
    ])

    act(() => authorsHeading?.dispatchEvent(new MouseEvent('click', {bubbles: true})))

    expect(Array.from(container.querySelectorAll('tbody tr a')).map((link) => link.textContent)).toEqual([
      'Zed document',
      'Alpha document',
    ])
  })

  it('sorts citations numerically', () => {
    const items = makeItems(2)
    items[0].metadata.name = 'Least cited'
    items[1].metadata.name = 'Most cited'

    act(() => {
      root.render(<QueryBlockContent items={items} style="Table" accountsMetadata={{}} />)
    })

    const citationsHeading = Array.from(container.querySelectorAll('thead button')).find(
      (button) => button.textContent?.includes('Backlinks'),
    )
    act(() => citationsHeading?.dispatchEvent(new MouseEvent('click', {bubbles: true})))

    expect(Array.from(container.querySelectorAll('tbody tr a')).map((link) => link.textContent)).toEqual([
      'Most cited',
      'Least cited',
    ])
  })

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
      'Name',
      'Tags',
      'Last Modified',
      'Subdocuments',
      'Comments',
      'Backlinks',
    ])
    expect(container.textContent).toContain('Ready')
  })
})

describe('QueryBlockContent list view with prepended draft items', () => {
  it('renders prepended draft items even when no published documents match the query', () => {
    act(() => {
      root.render(
        <QueryBlockContent
          items={[]}
          style="List"
          accountsMetadata={{}}
          prependItems={[<div data-testid="draft-slot">Draft item</div>]}
        />,
      )
    })

    expect(container.querySelector('[data-testid="draft-slot"]')).toBeTruthy()
    expect(container.textContent).not.toContain('No documents found.')
    expect(container.textContent).not.toContain('No documents match the current search and filters.')
  })
})

describe('QueryBlockContent card view navigation', () => {
  function renderCard(props?: {navigateCards?: boolean; titleLinkOnly?: boolean}) {
    act(() => {
      root.render(
        <QueryBlockContent
          items={makeItems(1)}
          style="Card"
          accountsMetadata={{}}
          navigateCards={props?.navigateCards}
          titleLinkOnly={props?.titleLinkOnly}
        />,
      )
    })
  }

  it('wraps the whole card in an anchor when navigateCards is true and titleLinkOnly is false', () => {
    renderCard({navigateCards: true, titleLinkOnly: false})

    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]?.textContent).toContain('Item 0')
  })

  it('links only the card title when titleLinkOnly is true', () => {
    renderCard({navigateCards: false, titleLinkOnly: true})

    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]?.textContent).toBe('Item 0')
  })

  it('renders no anchor when neither navigateCards nor titleLinkOnly is true', () => {
    renderCard({navigateCards: false, titleLinkOnly: false})

    expect(container.querySelectorAll('a')).toHaveLength(0)
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
