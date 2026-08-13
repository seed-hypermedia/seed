// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  DirectoryPageContent,
  getSortKey,
  parseSortValue,
  sortDirectoryItems,
  type DirectoryItemWithActivity,
} from '../directory-page'
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

vi.mock('../select-dropdown', () => ({
  SelectDropdown: ({
    value,
    onValue,
    options,
  }: {
    value: string
    onValue: (value: string) => void
    options: {value: string; label: string}[]
  }) =>
    (globalThis as unknown as {React: typeof React}).React.createElement(
      'select',
      {
        'data-testid': 'sort-select',
        value,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onValue(e.target.value),
      },
      options.map((option) =>
        (globalThis as unknown as {React: typeof React}).React.createElement(
          'option',
          {key: option.value, value: option.value},
          option.label,
        ),
      ),
    ),
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

function makeDraft(name: string, sortTime = new Date('2024-01-01T00:00:00Z')): DirectoryItemWithActivity {
  return {
    draftId: 'draft-1',
    isPublished: false,
    id: hmId('site'),
    metadata: {name},
    sortTime,
  }
}

describe('parseSortValue', () => {
  it.each([
    ['activity-desc', {type: 'activity', direction: 'desc'}],
    ['activity-asc', {type: 'activity', direction: 'asc'}],
    ['alphabetical-asc', {type: 'alphabetical', direction: 'asc'}],
    ['alphabetical-desc', {type: 'alphabetical', direction: 'desc'}],
    ['hierarchy-asc', {type: 'hierarchy', direction: 'asc'}],
    ['hierarchy-desc', {type: 'hierarchy', direction: 'desc'}],
  ])('parses %s', (value, expected) => {
    expect(parseSortValue(value as Parameters<typeof parseSortValue>[0])).toEqual(expected)
  })
})

describe('getSortKey', () => {
  it('uses the document name for alphabetical sorting', () => {
    const item = makeDoc('My Doc', ['my-doc'])
    expect(getSortKey(item, 'alphabetical')).toBe('my doc')
  })

  it('uses the joined path for hierarchy sorting', () => {
    const item = makeDoc('My Doc', ['folder', 'sub', 'my-doc'])
    expect(getSortKey(item, 'hierarchy')).toBe('folder/sub/my-doc')
  })

  it('falls back to the document name for hierarchy when path is empty', () => {
    const item = makeDoc('My Doc', [])
    expect(getSortKey(item, 'hierarchy')).toBe('my doc')
  })

  it('uses activity time for activity sorting', () => {
    const item = makeDoc('My Doc', ['my-doc'], {
      latestChangeTime: '2024-06-15T12:00:00Z',
    })
    expect(getSortKey(item, 'activity')).toBe(new Date('2024-06-15T12:00:00Z').getTime())
  })

  it('uses latest comment time when it is more recent', () => {
    const item = makeDoc('My Doc', ['my-doc'], {
      latestChangeTime: '2024-06-15T12:00:00Z',
      latestCommentTime: '2024-07-20T08:00:00Z',
    })
    expect(getSortKey(item, 'activity')).toBe(new Date('2024-07-20T08:00:00Z').getTime())
  })

  it('uses sort time for unpublished drafts', () => {
    const draft = makeDraft('My Draft', new Date('2024-03-01T00:00:00Z'))
    expect(getSortKey(draft, 'activity')).toBe(new Date('2024-03-01T00:00:00Z').getTime())
  })
})

describe('sortDirectoryItems', () => {
  it('sorts alphabetically ascending and descending', () => {
    const b = makeDoc('Beta', ['b'])
    const a = makeDoc('Alpha', ['a'])
    const c = makeDoc('Charlie', ['c'])
    const items = [b, a, c]

    expect(sortDirectoryItems(items, 'alphabetical', 'asc').map((i) => i.metadata.name)).toEqual([
      'Alpha',
      'Beta',
      'Charlie',
    ])
    expect(sortDirectoryItems(items, 'alphabetical', 'desc').map((i) => i.metadata.name)).toEqual([
      'Charlie',
      'Beta',
      'Alpha',
    ])
  })

  it('sorts case-insensitively and handles numbers', () => {
    const items = [makeDoc('doc 10', ['doc-10']), makeDoc('Doc 2', ['doc-2']), makeDoc('doc 1', ['doc-1'])]

    expect(sortDirectoryItems(items, 'alphabetical', 'asc').map((i) => i.metadata.name)).toEqual([
      'doc 1',
      'Doc 2',
      'doc 10',
    ])
  })

  it('sorts by activity descending by default', () => {
    const old = makeDoc('Old', ['old'], {latestChangeTime: '2024-01-01T00:00:00Z'})
    const recent = makeDoc('Recent', ['recent'], {latestChangeTime: '2024-06-01T00:00:00Z'})
    const items = [old, recent]

    expect(sortDirectoryItems(items, 'activity', 'desc').map((i) => i.metadata.name)).toEqual(['Recent', 'Old'])
    expect(sortDirectoryItems(items, 'activity', 'asc').map((i) => i.metadata.name)).toEqual(['Old', 'Recent'])
  })

  it('sorts by hierarchy ascending and descending', () => {
    const zebra = makeDoc('Zebra', ['animals', 'zebra'])
    const apple = makeDoc('Apple', ['fruits', 'apple'])
    const root = makeDoc('Root', ['root'])
    const items = [zebra, apple, root]

    expect(sortDirectoryItems(items, 'hierarchy', 'asc').map((i) => i.metadata.name)).toEqual([
      'Zebra',
      'Apple',
      'Root',
    ])
    expect(sortDirectoryItems(items, 'hierarchy', 'desc').map((i) => i.metadata.name)).toEqual([
      'Root',
      'Apple',
      'Zebra',
    ])
  })
})

describe('DirectoryPageContent search toggle', () => {
  function renderWithDocs(docs: DirectoryItemWithActivity[]) {
    mocks.useDirectoryWithDrafts.mockReturnValue({
      directory: docs,
      drafts: [],
      isLoading: false,
      isInitialLoading: false,
    })

    act(() => {
      root.render(<DirectoryPageContent docId={hmId('site', {path: ['parent']})} />)
    })
  }

  it('shows a search icon instead of an input by default', () => {
    renderWithDocs([makeDoc('Foo', ['foo'])])

    expect(container.querySelector('button[aria-label="Search documents"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="mocked-input"]')).toBeFalsy()
  })

  it('expands the search input when the icon is clicked', () => {
    renderWithDocs([makeDoc('Foo', ['foo'])])

    const searchBtn = container.querySelector('button[aria-label="Search documents"]')
    expect(searchBtn).toBeTruthy()

    act(() => {
      searchBtn!.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(container.querySelector('[data-testid="mocked-input"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="Close search"]')).toBeTruthy()
  })

  it('filters documents as the user types and clears on close', () => {
    renderWithDocs([makeDoc('Foo', ['foo']), makeDoc('Bar', ['bar'])])

    act(() => {
      container
        .querySelector('button[aria-label="Search documents"]')!
        .dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    const input = container.querySelector('[data-testid="mocked-input"]') as HTMLInputElement
    expect(input).toBeTruthy()

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'oo')
      input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}))
    })

    const visibleItems = Array.from(container.querySelectorAll('[data-testid="doc-item"]')).map((el) => el.textContent)
    expect(visibleItems).toContain('Foo')
    expect(visibleItems).not.toContain('Bar')

    act(() => {
      container
        .querySelector('button[aria-label="Close search"]')!
        .dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(container.querySelector('[data-testid="mocked-input"]')).toBeFalsy()
    expect(container.querySelectorAll('[data-testid="doc-item"]')).toHaveLength(2)
  })

  it('clears the query with Escape and closes the input on a second Escape', () => {
    renderWithDocs([makeDoc('Foo', ['foo'])])

    act(() => {
      container
        .querySelector('button[aria-label="Search documents"]')!
        .dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    const input = container.querySelector('[data-testid="mocked-input"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'query')
      input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}))
    })

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}))
    })

    expect(input.value).toBe('')
    expect(container.querySelector('[data-testid="mocked-input"]')).toBeTruthy()

    act(() => {
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}))
    })

    expect(container.querySelector('[data-testid="mocked-input"]')).toBeFalsy()
  })
})
