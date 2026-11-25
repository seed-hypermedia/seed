// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DirectoryPageContent, useDirectoryDataWithActivity, type DirectoryItemWithActivity} from '../directory-page'
import {DirectoryPanel} from '../directory-panel'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {queryKeys} from '@shm/shared/models/query-keys'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  useDirectoryWithDrafts: vi.fn(),
  useAccountsMetadata: vi.fn(),
  useCanSeePrivateDocs: vi.fn(),
  useNavRoute: vi.fn(),
  useScrollRestoration: vi.fn(),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useAccountsMetadata: mocks.useAccountsMetadata,
  useDirectoryWithDrafts: mocks.useDirectoryWithDrafts,
}))

vi.mock('@shm/shared/models/capabilities', () => ({
  useCanSeePrivateDocs: mocks.useCanSeePrivateDocs,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: mocks.useNavRoute,
  getRouteKey: () => 'route-key',
}))

vi.mock('../use-scroll-restoration', () => ({
  useScrollRestoration: mocks.useScrollRestoration,
}))

vi.mock('../document-list-item', () => ({
  DocumentListItem: ({item}: {item: {metadata?: {name?: string}}}) =>
    (globalThis as unknown as {React: typeof React}).React.createElement(
      'div',
      {'data-testid': 'doc-item'},
      item.metadata?.name,
    ),
}))

vi.mock('../components/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement> & {onChangeText?: (value: string) => void}) => {
    const {onChangeText, onChange, ...rest} = props
    return (globalThis as unknown as {React: typeof React}).React.createElement('input', {
      ...rest,
      'data-testid': 'mocked-input',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        if (onChangeText) onChangeText(e.target.value)
        if (onChange) onChange(e)
      },
    })
  },
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  mocks.useDirectoryWithDrafts.mockReturnValue({
    directory: [],
    drafts: [],
    isLoading: false,
    isInitialLoading: false,
  })
  mocks.useAccountsMetadata.mockReturnValue({data: {}})
  mocks.useCanSeePrivateDocs.mockReturnValue(true)
  mocks.useNavRoute.mockReturnValue({key: 'document', id: hmId('site')})
  mocks.useScrollRestoration.mockReturnValue(vi.fn())
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

function makeDoc(
  name: string,
  path: string[],
  activitySummary?: {latestChangeTime?: string; latestCommentTime?: string; latestCommentId?: string},
  sortTime = new Date('2024-01-01T00:00:00Z'),
): DirectoryItemWithActivity {
  const id = hmId('site', {path})
  return {
    type: 'document',
    id,
    path,
    authors: [],
    createTime: '2024-01-01T00:00:00Z',
    updateTime: '2024-01-01T00:00:00Z',
    sortTime,
    genesis: 'genesis',
    version: 'v1',
    breadcrumbs: [],
    activitySummary: {
      commentCount: 0,
      latestCommentId: activitySummary?.latestCommentId ?? '',
      latestCommentTime: activitySummary?.latestCommentTime,
      latestChangeTime: activitySummary?.latestChangeTime ?? '2024-01-01T00:00:00Z',
      isUnread: false,
    },
    generationInfo: {genesis: 'genesis', generation: 1n},
    metadata: {name},
    visibility: 'PUBLIC',
    isPublished: true,
  } as HMDocumentInfo & DirectoryItemWithActivity
}

const parentId = hmId('site', {path: ['parent']})
const pins = [{siteUid: 'site', path: ['pinned'], title: 'Pinned guide', seenVersion: 'v1', createdAt: '2024-01-01'}]

function renderContent(content: React.ReactNode, withPins = false) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}})
  client.setQueryData(
    [queryKeys.DOC_LIST_DIRECTORY, hmId('site').id, 'AllDescendants'],
    [makeDoc('Pinned guide', ['pinned'])],
  )
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <DocumentActionsProvider getPinsForSite={() => (withPins ? pins : [])}>{content}</DocumentActionsProvider>
      </QueryClientProvider>,
    )
  })
}

function setDocs(docs: DirectoryItemWithActivity[], drafts: unknown[] = []) {
  mocks.useDirectoryWithDrafts.mockReturnValue({directory: docs, drafts, isInitialLoading: false})
}

function filterDocuments(query: string) {
  const input = container.querySelector('input')!
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, query)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

function visibleDocuments() {
  return Array.from(container.querySelectorAll('[data-testid="doc-item"]')).map((el) => el.textContent)
}

describe('DirectoryPageContent', () => {
  it('shows the filter immediately without search toggles or sort selectors', () => {
    setDocs([makeDoc('Foo', ['foo'])])
    renderContent(<DirectoryPageContent docId={parentId} />)
    expect(container.querySelector('input[placeholder="Filter documents…"]')).toBeTruthy()
    expect(
      container.querySelector('button[aria-label="Search documents"], button[aria-label="Close search"]'),
    ).toBeNull()
    expect(container.querySelector('[role="combobox"], select')).toBeNull()
  })

  it('filters by title, shows no results, and restores documents and pins when cleared', () => {
    setDocs([makeDoc('Foo', ['foo']), makeDoc('Bar', ['bar'])])
    renderContent(<DirectoryPageContent docId={parentId} />, true)
    expect(visibleDocuments()).toEqual(['Pinned guide', 'Foo', 'Bar'])
    filterDocuments('OO')
    expect(visibleDocuments()).toEqual(['Foo'])
    filterDocuments('missing')
    expect(visibleDocuments()).toEqual([])
    expect(container.textContent).toContain('No documents match')
    filterDocuments('')
    expect(visibleDocuments()).toEqual(['Pinned guide', 'Foo', 'Bar'])
    expect(container.querySelector('input')).toBeTruthy()
  })

  it('honors showSearch while preserving header slots', () => {
    setDocs([makeDoc('Foo', ['foo'])])
    renderContent(
      <DirectoryPageContent
        docId={parentId}
        showSearch={false}
        header={<span>Create document</span>}
        headerRight={<span>Header action</span>}
      />,
    )
    expect(container.querySelector('input')).toBeNull()
    expect(container.textContent).toContain('Create document')
    expect(container.textContent).toContain('Header action')
  })

  it('keeps pins visible and collapsible when the directory has no children', () => {
    renderContent(<DirectoryPageContent docId={parentId} />, true)
    expect(container.querySelector('input')).toBeNull()
    expect(visibleDocuments()).toEqual(['Pinned guide'])
    expect(container.textContent).toContain('There are no documents here')
    const toggle = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Pinned'),
    )!
    act(() => toggle.click())
    expect(visibleDocuments()).toEqual([])
    act(() => toggle.click())
    expect(visibleDocuments()).toEqual(['Pinned guide'])
  })
})

describe('directory activity order', () => {
  const docs = () => [
    makeDoc('Old change', ['old'], {latestChangeTime: '2024-01-01T00:00:00Z'}),
    makeDoc('New change', ['new'], {latestChangeTime: '2024-06-01T00:00:00Z'}),
    makeDoc('New comment', ['comment'], {latestCommentTime: '2024-07-01T00:00:00Z'}),
  ]

  it.each(['page', 'panel'])('orders the %s by most recent activity', (view) => {
    setDocs(docs())
    renderContent(view === 'page' ? <DirectoryPageContent docId={parentId} /> : <DirectoryPanel docId={parentId} />)
    expect(visibleDocuments()).toEqual(['New comment', 'New change', 'Old change'])
  })

  it('returns activity-sorted data including unpublished drafts and fallback dates to all consumers', () => {
    const fallback = makeDoc(
      'Fallback',
      ['fallback'],
      {latestChangeTime: '1970-01-01T00:00:00Z'},
      new Date('2024-08-01'),
    )
    setDocs(
      [...docs(), fallback],
      [{id: 'draft-1', locationId: parentId, metadata: {name: 'Draft'}, lastUpdateTime: '2024-06-15T00:00:00Z'}],
    )
    function ReadDirectory() {
      const {items} = useDirectoryDataWithActivity(parentId)
      return <output>{items.map((item) => item.metadata.name).join(',')}</output>
    }
    renderContent(<ReadDirectory />)
    expect(container.querySelector('output')?.textContent).toBe('Fallback,New comment,Draft,New change,Old change')
  })

  it('keeps pins in an otherwise empty panel', () => {
    renderContent(<DirectoryPanel docId={parentId} />, true)
    expect(visibleDocuments()).toEqual(['Pinned guide'])
  })
})
