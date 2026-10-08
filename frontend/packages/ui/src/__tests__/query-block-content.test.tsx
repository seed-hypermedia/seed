// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({isLoading: false, data: {citations: 0}}),
  useInteractionSummaries: () => [{data: {citations: 2}}, {data: {citations: 8}}],
}))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => navigate,
}))

import {QueryBlockContent as QueryBlockContentImpl, type QueryBlockContentProps} from '../query-block-content'
import {TooltipProvider} from '../tooltip'

function QueryBlockContent(props: QueryBlockContentProps) {
  return (
    <TooltipProvider>
      <QueryBlockContentImpl {...props} />
    </TooltipProvider>
  )
}
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
  navigate.mockClear()
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
    path: ['docs', String(index)],
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

    expect(Array.from(container.querySelectorAll('tbody tr td a[title]')).map((link) => link.textContent)).toEqual([
      'Alpha document',
      'Zed document',
    ])

    act(() => authorsHeading?.dispatchEvent(new MouseEvent('click', {bubbles: true})))

    expect(Array.from(container.querySelectorAll('tbody tr td a[title]')).map((link) => link.textContent)).toEqual([
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

  it('renders a resize handle for every visible column, including the first column', () => {
    act(() => {
      root.render(<QueryBlockContent items={makeItems(1)} style="Table" accountsMetadata={{}} />)
    })

    const headings = container.querySelectorAll('th')
    const resizeHandles = container.querySelectorAll('button[aria-label^="Resize "]')
    expect(resizeHandles).toHaveLength(headings.length)
    expect(resizeHandles[0]?.getAttribute('aria-label')).toBe('Resize title column')
  })

  it('persists a resized column when the drag ends outside the resize handle', () => {
    const onTableConfigChange = vi.fn()
    act(() => {
      root.render(
        <QueryBlockContent
          items={makeItems(1)}
          style="Table"
          accountsMetadata={{}}
          onTableConfigChange={onTableConfigChange}
        />,
      )
    })

    const resizeHandle = container.querySelector('button[aria-label="Resize title column"]')
    act(() => {
      resizeHandle?.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, clientX: 240, buttons: 1}))
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: 300, buttons: 1}))
    })
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: 300}))
    })

    expect(onTableConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.arrayContaining([expect.objectContaining({id: 'title', width: 300})]),
      }),
    )
  })

  it('uses fixed column widths and truncates long values', () => {
    const items = makeItems(1)
    items[0].metadata.status = 'A status value that is much wider than its column'

    act(() => {
      root.render(
        <QueryBlockContent
          items={items}
          style="Table"
          accountsMetadata={{}}
          tableConfig={{columns: [{id: 'metadata:status', visible: true, width: 100}]}}
        />,
      )
    })

    expect(container.querySelector('table')?.className).toContain('table-fixed')
    const statusValue = Array.from(container.querySelectorAll('tbody span')).find(
      (span) => span.textContent?.startsWith('A status value'),
    )
    expect(statusValue?.className).toContain('truncate')
  })

  it('renders discovered custom attributes in the default column order', () => {
    const items = makeItems(1)
    items[0].metadata.status = 'Ready'

    act(() => {
      root.render(<QueryBlockContent items={items} style="Table" accountsMetadata={{}} />)
    })

    expect(Array.from(container.querySelectorAll('th')).map((cell) => cell.textContent)).toEqual([
      'Name',
      'Last Modified',
      'Subdocuments',
      'Comments',
      'Backlinks',
    ])
    expect(container.textContent).not.toContain('Ready')
  })
})

describe('QueryBlockContent toolbar', () => {
  it('focuses expanded search and preserves its value and results after blur', () => {
    act(() => root.render(<QueryBlockContent items={makeItems(2)} style="List" accountsMetadata={{}} />))
    const searchButton = container.querySelector('button[aria-label="Search documents"]') as HTMLButtonElement
    expect(searchButton).toBeTruthy()
    act(() => searchButton.click())
    const input = container.querySelector('input[aria-label="Search documents"]') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Item 1')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(1)
    act(() => input.blur())
    expect(container.querySelector('input[aria-label="Search documents"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Search documents"]')?.textContent).toBe('Item 1')
    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(1)
    act(() => (container.querySelector('button[aria-label="Search documents"]') as HTMLButtonElement).click())
    const reopened = container.querySelector('input[aria-label="Search documents"]') as HTMLInputElement
    expect(reopened.value).toBe('Item 1')
    expect(document.activeElement).toBe(reopened)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(reopened, '')
      reopened.dispatchEvent(new Event('input', {bubbles: true}))
    })
    act(() => reopened.blur())
    expect(container.querySelector('button[aria-label="Search documents"]')?.textContent).toBe('Search')
    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(2)
  })

  it('counts only applied filters and clears them without clearing search', () => {
    function Collection() {
      const [filters, setFilters] = React.useState<NonNullable<QueryBlockContentProps['viewerFilters']>>([
        {columnId: 'title', operator: 'contains', value: '0'},
        {columnId: 'title', operator: 'contains', value: '   '},
      ])
      return (
        <QueryBlockContent
          items={makeItems(2)}
          style="List"
          accountsMetadata={{}}
          viewerSearch="Item"
          viewerFilters={filters}
          onViewerFiltersChange={setFilters}
          viewerQueryApplied={false}
        />
      )
    }
    act(() => root.render(<Collection />))
    const filterButton = container.querySelector('button[aria-label="Filters: 1 applied"]') as HTMLButtonElement
    expect(filterButton).toBeTruthy()
    act(() => filterButton.click())
    const clear = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Clear filters',
    )
    expect(clear).toBeTruthy()
    act(() => clear?.click())
    expect(container.querySelector('button[aria-label="Filter"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="Search documents"]')?.textContent).toBe('Item')
    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(2)
  })

  it('shows equality filters with readable labels and removes them from the popover summary', () => {
    const onViewerFiltersChange = vi.fn()
    const items = makeItems(1)
    items[0].metadata.status = 'Ready'

    act(() => {
      root.render(
        <QueryBlockContent
          items={items}
          style="Table"
          accountsMetadata={{}}
          viewerFilters={[{columnId: 'metadata:status', operator: 'equals', value: 'Ready'}]}
          onViewerFiltersChange={onViewerFiltersChange}
        />,
      )
    })

    act(() => (container.querySelector('button[aria-label="Filters: 1 applied"]') as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('Status IS Ready')

    const remove = document.querySelector('button[aria-label="Remove filter: Status IS Ready"]')
    act(() => remove?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
    expect(onViewerFiltersChange).toHaveBeenCalledWith([])
  })

  it('removes an applied filter from its summary inside the popover', () => {
    function Collection() {
      const [filters, setFilters] = React.useState<NonNullable<QueryBlockContentProps['viewerFilters']>>([
        {columnId: 'title', operator: 'contains', value: '0'},
      ])
      return (
        <QueryBlockContent
          items={makeItems(2)}
          style="List"
          accountsMetadata={{}}
          viewerFilters={filters}
          onViewerFiltersChange={setFilters}
          viewerQueryApplied={false}
        />
      )
    }
    act(() => root.render(<Collection />))
    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(1)
    act(() => (container.querySelector('button[aria-label="Filters: 1 applied"]') as HTMLButtonElement).click())
    const remove = document.querySelector('button[aria-label="Remove filter: Name contains 0"]') as HTMLButtonElement
    expect(remove).toBeTruthy()
    act(() => remove.click())
    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(2)
  })

  it('reports controlled viewer search changes without filtering the current result page locally', () => {
    const onViewerSearchChange = vi.fn()
    act(() => {
      root.render(
        <QueryBlockContent
          items={makeItems(2)}
          style="List"
          accountsMetadata={{}}
          viewerSearch="outside current page"
          onViewerSearchChange={onViewerSearchChange}
        />,
      )
    })

    expect(container.textContent).toContain('Item 0')
    expect(container.textContent).toContain('Item 1')
    act(() => (container.querySelector('button[aria-label="Search documents"]') as HTMLButtonElement).click())
    const input = container.querySelector('input[aria-label="Search documents"]') as HTMLInputElement
    expect(input.value).toBe('outside current page')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'roadmap')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(onViewerSearchChange).toHaveBeenCalledWith('roadmap')
  })

  it('filters the current page when the query resolver does not support viewer filters yet', () => {
    const items = makeItems(2)
    items[0].metadata.name = 'Dream document'
    items[1].metadata.name = 'Release notes'

    act(() => {
      root.render(
        <QueryBlockContent
          items={items}
          style="List"
          accountsMetadata={{}}
          viewerFilters={[{columnId: 'title', operator: 'contains', value: 'dream'}]}
          onViewerFiltersChange={vi.fn()}
          viewerQueryApplied={false}
        />,
      )
    })

    expect(container.textContent).toContain('Dream document')
    expect(container.textContent).not.toContain('Release notes')
  })
})

describe.each(['List', 'Card'] as const)('QueryBlockContent %s selected attributes', (style) => {
  it('renders every selected attribute and omits attributes that are not selected', () => {
    const items = makeItems(1)
    items[0].metadata.status = 'Ready'
    items[0].metadata.priority = 'High'

    act(() => {
      root.render(
        <TooltipProvider>
          <QueryBlockContent
            items={items}
            style={style}
            accountsMetadata={{}}
            tableConfig={{
              columns: [
                {id: 'title', visible: true},
                {id: 'metadata:status', visible: true},
                {id: 'metadata:priority', visible: false},
              ],
            }}
          />
        </TooltipProvider>,
      )
    })

    expect(container.textContent).toContain('Ready')
    expect(container.textContent).not.toContain('Status:')
    expect(container.textContent).not.toContain('High')
  })
})

describe('QueryBlockContent Card attribute layout', () => {
  it('renders count attributes in the card action row', () => {
    const items = makeItems(1)
    items[0].metadata.status = 'Ready'

    act(() => {
      root.render(
        <TooltipProvider>
          <QueryBlockContent
            items={items}
            style="Card"
            accountsMetadata={{}}
            tableConfig={{
              columns: [
                {id: 'title', visible: true},
                {id: 'metadata:status', visible: true},
                {id: 'children', visible: true},
              ],
            }}
          />
        </TooltipProvider>,
      )
    })

    const actionRow = container.querySelector('[data-testid="document-card-action-row"]')
    expect(actionRow?.querySelector('[data-testid="selected-attribute-counts"]')).toBeTruthy()
    expect(actionRow?.textContent).not.toContain('Ready')
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

describe('QueryBlockContent selected card comments', () => {
  it.each([0, 7])('shows one selected comment count (%i) and suppresses card navigation', (comments) => {
    const items = makeItems(1)
    let parentClicks = 0
    act(() => {
      root.render(
        <TooltipProvider>
          <div onClick={() => parentClicks++}>
            <QueryBlockContent
              items={items}
              style="Card"
              accountsMetadata={{}}
              interactionSummaries={{[items[0].id.id]: {comments, children: 0, authors: []}} as any}
              tableConfig={{columns: [{id: 'comments', visible: true}]}}
            />
          </div>
        </TooltipProvider>,
      )
    })

    const counts = container.querySelectorAll('[title="Comments"]')
    expect(counts).toHaveLength(1)
    expect(counts[0]?.textContent).toBe(String(comments))
    expect(
      Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === String(comments)),
    ).toHaveLength(1)
    const selectedCount = container.querySelector('[data-testid="selected-attribute-counts"] button')
    expect(selectedCount).toBeTruthy()
    const click = new MouseEvent('click', {bubbles: true, cancelable: true})
    act(() => selectedCount!.dispatchEvent(click))
    expect(click.defaultPrevented).toBe(true)
    expect(parentClicks).toBe(0)
    expect(navigate).toHaveBeenCalledExactlyOnceWith({key: 'comments', id: items[0].id})
  })

  it('hides comments when the selected attribute is disabled, even with existing comments', () => {
    const items = makeItems(1)
    act(() => {
      root.render(
        <TooltipProvider>
          <QueryBlockContent
            items={items}
            style="Card"
            accountsMetadata={{}}
            interactionSummaries={{[items[0].id.id]: {comments: 7, children: 0, authors: []}} as any}
            tableConfig={{columns: [{id: 'comments', visible: false}]}}
          />
        </TooltipProvider>,
      )
    })
    expect(container.querySelector('[title="Comments"]')).toBeNull()
    expect(container.textContent).not.toContain('7')
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

  it('renders an explicit cover image in card view', () => {
    const items = makeItems(1)
    items[0].metadata.cover = 'ipfs://cover-cid'

    act(() => {
      root.render(<QueryBlockContent items={items} style="Card" accountsMetadata={{}} />)
    })

    expect(container.querySelector('img')?.getAttribute('src')).toContain('/cover-cid')
  })

  it('uses the indexed first content image when the document has no cover or icon', () => {
    const items = makeItems(1)
    items[0].firstImageInContent = 'ipfs://content-image-cid'

    act(() => {
      root.render(<QueryBlockContent items={items} style="Card" accountsMetadata={{}} />)
    })

    expect(container.querySelector('img')?.getAttribute('src')).toContain('/content-image-cid')
  })

  it('does not use the indexed content image when the document has an icon', () => {
    const items = makeItems(1)
    items[0].metadata.icon = 'ipfs://icon-cid'
    items[0].firstImageInContent = 'ipfs://content-image-cid'

    act(() => {
      root.render(<QueryBlockContent items={items} style="Card" accountsMetadata={{}} />)
    })

    expect(container.querySelector('img')?.getAttribute('src')).toContain('/icon-cid')
    expect(container.querySelector('img')?.getAttribute('src')).not.toContain('/content-image-cid')
  })

  it('renders the first result as a larger banner card when enabled', () => {
    const items = makeItems(2)
    items[0].metadata.cover = 'ipfs://banner-cover-cid'

    act(() => {
      root.render(<QueryBlockContent items={items} style="Card" banner accountsMetadata={{}} />)
    })

    const titles = Array.from(container.querySelectorAll('p')).filter(
      (element) => element.textContent?.startsWith('Item '),
    )
    expect(titles[0]?.className).toContain('text-2xl')
    expect(titles[1]?.className).toContain('text-lg')
    expect(titles[0]?.closest('.group\\/item')?.className).toContain('md:min-h-[240px]')
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

  it('keeps loaded rows when the same items arrive as a new array', () => {
    // Upstream rebuilds the items array on most renders. Collapsing back to the first chunk here
    // pulls a scrolled reader toward the top, which brings the sentinel back into view and loads
    // the rows again.
    const items = makeItems(30)
    act(() => {
      root.render(<QueryBlockContent items={items} style="List" accountsMetadata={{}} />)
    })
    act(() => {
      observers[0]?.trigger(true)
    })
    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(30)

    act(() => {
      root.render(<QueryBlockContent items={[...items]} style="List" accountsMetadata={{}} />)
    })

    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(30)
  })

  it('shrinks to fit when the list itself gets shorter', () => {
    const items = makeItems(30)
    act(() => {
      root.render(<QueryBlockContent items={items} style="List" accountsMetadata={{}} />)
    })
    act(() => {
      observers[0]?.trigger(true)
    })
    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(30)

    act(() => {
      root.render(<QueryBlockContent items={makeItems(8)} style="List" accountsMetadata={{}} />)
    })

    expect(container.querySelectorAll('[data-testid="query-row"]')).toHaveLength(8)
  })
})
