// @vitest-environment jsdom
import React from 'react'
import {hmId} from '@shm/shared'
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
  QueryBlockContent: ({items, tableSorting, onTableSortingChange, style}: QueryBlockContentProps) => (
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
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
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
