// @vitest-environment jsdom
import React from 'react'
import {hmId} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import type {EditorQueryBlock} from '@seed-hypermedia/client/editor-types'
import type {HMQueryBlockInput} from '@seed-hypermedia/client/hm-types'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {QueryBlockContentProps} from '../query-block-content'
import {DocumentCollection} from '../resource-page-common'

const service = vi.hoisted(() => ({request: vi.fn(), send: vi.fn(), beginEditIfNeeded: vi.fn()}))
vi.mock('@shm/shared/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/routing')>()),
  useUniversalClient: () => ({request: service.request}),
}))
vi.mock('@shm/shared/models/use-document-machine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/models/use-document-machine')>()),
  useDocumentSend: () => service.send,
}))
vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: () => ({beginEditIfNeeded: service.beginEditIfNeeded}),
}))
// Keep the real collection state and query cache; replace only its visual controls.
vi.mock('../query-block-content', () => ({
  QueryBlockContent: ({items, tableSorting, onTableSortingChange, style, toolbarActions}: QueryBlockContentProps) => (
    <div>
      <button onClick={() => onTableSortingChange?.([{id: 'activity', desc: true}])}>Newest activity</button>
      <button onClick={() => onTableSortingChange?.([{id: 'activity', desc: false}])}>Oldest activity</button>
      {['children', 'citations', 'authors'].map((term) => (
        <button key={term} onClick={() => onTableSortingChange?.([{id: term, desc: true}])}>
          {term}
        </button>
      ))}
      <output>{items.map((item) => item.metadata.name).join(',')}</output>
      <span data-sort>{JSON.stringify(tableSorting)}</span>
      <span data-style>{style}</span>
      {toolbarActions}
    </div>
  ),
}))
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
let block: EditorQueryBlock

function documentInfo(name: string) {
  return {
    type: 'document',
    id: hmId('alice', {path: [name]}),
    path: [name],
    authors: [],
    createTime: '',
    updateTime: '',
    sortTime: new Date(),
    genesis: 'genesis',
    version: 'version',
    breadcrumbs: [],
    metadata: {name},
    visibility: 'PUBLIC',
    generationInfo: {genesis: 'genesis', generation: 1n},
    activitySummary: {latestCommentId: '', commentCount: 0, latestChangeTime: '', isUnread: false},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  block = {
    id: 'collection-query',
    type: 'query',
    props: {
      queryIncludes: JSON.stringify([{space: 'alice', path: '', mode: 'Children'}]),
      querySort: JSON.stringify([{term: 'title', reverse: false}]),
      queryLimit: '1',
      style: 'Table',
    },
  } as EditorQueryBlock
  service.request.mockImplementation(async (_method: string, input: HMQueryBlockInput) => {
    const sort = input.query.sort?.[0]
    const names =
      sort?.term === 'activity'
        ? sort.reverse
          ? ['Recently commented', 'Alphabetical first']
          : ['Alphabetical first', 'Recently commented']
        : ['Alphabetical first', 'Recently commented']
    return {
      queryTargetName: 'Collection',
      in: hmId('alice'),
      results: names.slice(0, input.query.limit).map(documentInfo),
      accountsMetadata: {},
      interactionSummaries: {},
    }
  })
})

afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  container.remove()
})

async function render(path = 'collection', canEdit = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <DocumentCollection docId={hmId('alice', {path: [path]})} queryBlock={block} canEdit={canEdit} />
      </QueryClientProvider>,
    ),
  )
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.querySelector('output')?.textContent).not.toBe('')
  })
}

async function selectActivity(newest = true) {
  await act(async () => {
    ;(container.querySelectorAll('button')[newest ? 0 : 1] as HTMLButtonElement).click()
  })
}

async function expectResult(name: string) {
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(queryClient.isFetching()).toBe(0)
    expect(container.querySelector('output')?.textContent).toBe(name)
  })
}

describe('collection reader sorting', () => {
  it('changes the query before its limit without modifying saved settings', async () => {
    const savedSort = block.props.querySort
    await render()
    await expectResult('Alphabetical first')
    await selectActivity()
    await expectResult('Recently commented')
    expect(container.querySelector('[data-sort]')?.textContent).toBe('[{"id":"activity","desc":true}]')
    expect(block.props.querySort).toBe(savedSort)
    expect(service.send).not.toHaveBeenCalled()
    expect(service.beginEditIfNeeded).not.toHaveBeenCalled()
    await selectActivity(false)
    await expectResult('Alphabetical first')
  })

  it.each(['children', 'citations', 'authors'])(
    'keeps the saved result subset for reader-only %s sorting',
    async (term) => {
      block = {...block, props: {...block.props, querySort: JSON.stringify([{term: 'activity', reverse: true}])}}
      await render()
      await expectResult('Recently commented')
      await act(async () => {
        const button = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === term)
        button!.click()
      })
      await expectResult('Recently commented')
      // A reader-only sort must reuse the saved result set rather than query again.
      expect(queryClient.getQueryCache().findAll({queryKey: [queryKeys.QUERY_BLOCK]})).toHaveLength(1)
      expect(container.querySelector('[data-sort]')?.textContent).toBe(JSON.stringify([{id: term, desc: true}]))
      expect(JSON.parse(block.props.querySort!)).toEqual([{term: 'activity', reverse: true}])
    },
  )

  it('keeps the override across views and resets it after document navigation', async () => {
    await render()
    await selectActivity()
    await expectResult('Recently commented')
    block = {...block, props: {...block.props, style: 'List'}}
    await render()
    await expectResult('Recently commented')
    await render('other-collection')
    await expectResult('Alphabetical first')
    await render()
    await expectResult('Alphabetical first')
  })

  it('keeps editor changes in the existing document edit flow', async () => {
    await render('collection', true)
    service.send.mockImplementation((event) => {
      block = {...block, props: {...block.props, ...event.props}}
    })
    await selectActivity()
    await render('collection', true)
    await expectResult('Recently commented')
    expect(JSON.parse(block.props.querySort!)).toEqual([{term: 'activity', reverse: true}])
    expect(service.beginEditIfNeeded).toHaveBeenCalledOnce()
  })
})

function viewButton(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
}

async function clickView(label: string) {
  await act(async () => viewButton(label).click())
}

function settings() {
  return document.querySelector<HTMLElement>('[role="dialog"]')
}

describe('collection view settings', () => {
  it('opens the active view settings without editing or an overflow button', async () => {
    await render('collection', true)
    expect(container.querySelector('[aria-label="Query settings"]')).toBeNull()
    expect(viewButton('Table view settings').getAttribute('aria-pressed')).toBe('true')
    expect(settings()).toBeNull()

    await clickView('Table view settings')

    expect(settings()?.textContent).toContain('Table view')
    expect(settings()?.textContent).toContain('Document limit')
    expect(settings()?.textContent).not.toContain('Columns')
    expect(settings()?.textContent).not.toContain('Show banner')
    expect(service.send).not.toHaveBeenCalled()
    expect(service.beginEditIfNeeded).not.toHaveBeenCalled()

    await clickView('Table view settings')
    expect(settings()).toBeNull()
  })

  it.each([
    ['Card', 'Cards'],
    ['List', 'List'],
  ] as const)('switches to %s first and opens settings only on the next click', async (style, label) => {
    await render('collection', true)
    service.send.mockImplementation((event) => {
      block = {...block, props: {...block.props, ...event.props}}
    })

    await clickView(`${label} view`)
    await render('collection', true)
    expect(settings()).toBeNull()
    expect(service.send).toHaveBeenCalledExactlyOnceWith({type: 'collection.query.change', props: {style}})
    expect(service.beginEditIfNeeded).toHaveBeenCalledOnce()
    expect(viewButton(`${label} view settings`).getAttribute('aria-pressed')).toBe('true')

    await clickView(`${label} view settings`)
    expect(settings()?.textContent).toContain(`${label} view`)
    expect(settings()?.textContent?.includes('Columns')).toBe(style === 'Card')
    expect(settings()?.textContent?.includes('Show banner')).toBe(style === 'Card')
    expect(settings()?.textContent).toContain('Document limit')
    expect(service.send).toHaveBeenCalledOnce()
  })

  it('preserves saved card settings and updates the banner through the edit flow', async () => {
    block = {...block, props: {...block.props, style: 'Card', columnCount: '2', banner: 'true'}}
    await render('collection', true)
    await clickView('Cards view settings')
    expect(settings()?.querySelector('[role="combobox"]')?.textContent).toContain('2 columns')
    const banner = settings()?.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(banner.getAttribute('aria-checked')).toBe('true')
    expect(settings()?.querySelector('input')?.value).toBe('1')

    await act(async () => banner.click())
    expect(service.send).toHaveBeenCalledExactlyOnceWith({type: 'collection.query.change', props: {banner: 'false'}})
    expect(service.beginEditIfNeeded).toHaveBeenCalledOnce()
  })

  it('updates the document limit through the edit flow', async () => {
    await render('collection', true)
    await clickView('Table view settings')
    const limit = settings()?.querySelector('input')!
    expect(document.querySelector<HTMLLabelElement>(`label[for="${limit.id}"]`)?.textContent).toBe('Document limit')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(limit, '5')
      limit.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(service.send).toHaveBeenCalledExactlyOnceWith({type: 'collection.query.change', props: {queryLimit: '5'}})
    expect(service.beginEditIfNeeded).toHaveBeenCalledOnce()
  })

  it('keeps readers read-only when inspecting settings or clicking other views', async () => {
    block = {...block, props: {...block.props, style: 'Card'}}
    await render()
    expect(viewButton('Table view').disabled).toBe(true)
    expect(viewButton('List view').disabled).toBe(true)
    expect(viewButton('Cards view settings').disabled).toBe(false)
    await clickView('Table view')
    expect(settings()).toBeNull()
    await clickView('Cards view settings')
    expect(settings()?.textContent).toContain('Only editors can change these settings.')
    expect(settings()?.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true)
    expect(settings()?.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true)
    expect(settings()?.querySelector('input')?.disabled).toBe(true)
    expect(service.send).not.toHaveBeenCalled()
    expect(service.beginEditIfNeeded).not.toHaveBeenCalled()
  })

  it('dismisses settings on Escape and when navigating to another collection', async () => {
    await render('collection', true)
    await clickView('Table view settings')
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
    })
    expect(settings()).toBeNull()
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(document.activeElement).toBe(viewButton('Table view settings'))
    })

    await clickView('Table view settings')
    expect(settings()).not.toBeNull()
    await render('other-collection', true)
    expect(settings()).toBeNull()
  })
})
