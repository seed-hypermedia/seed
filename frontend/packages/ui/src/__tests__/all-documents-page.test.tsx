// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AllDocumentsPage, type AllDocumentsPageState} from '../all-documents-page'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useDirectoryMock = vi.hoisted(() => vi.fn())
const useAccountsMetadataMock = vi.hoisted(() => vi.fn(() => ({data: {}})))
const useAccountMock = vi.hoisted(() => vi.fn(() => ({data: {metadata: {name: 'Test Space'}}})))
const useDraftsMock = vi.hoisted(() => vi.fn(() => ({data: [], isLoading: false})))

vi.mock('@shm/shared/models/entity', () => ({
  useAccountsMetadata: useAccountsMetadataMock,
  useDirectory: useDirectoryMock,
  useAccount: useAccountMock,
}))

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({isLoading: false, data: {citations: 0}}),
}))

vi.mock('@shm/shared/draft-breadcrumb-context', async () => ({
  ...(await vi.importActual<typeof import('@shm/shared/draft-breadcrumb-context')>(
    '@shm/shared/draft-breadcrumb-context',
  )),
  useDraftsForAccountSafe: useDraftsMock,
}))

// jsdom lacks matchMedia, which useMedia relies on.
beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }
})

let container: HTMLDivElement
let root: Root

const DEFAULT_STATE: AllDocumentsPageState = {
  view: 'list',
  tab: 'all',
  sort: 'location',
  order: 'asc',
  q: '',
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useDraftsMock.mockReturnValue({data: [], isLoading: false})
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

function makeDoc(
  path: string[],
  name: string,
  opts: {type?: string; isCollection?: boolean; visibility?: 'PUBLIC' | 'PRIVATE'; updateTime?: string} = {},
): HMDocumentInfo {
  const id = hmId('site', {path})
  return {
    type: 'document',
    id,
    path,
    authors: [],
    createTime: '2024-01-01T00:00:00Z',
    updateTime: opts.updateTime ?? '2024-01-01T00:00:00Z',
    sortTime: new Date('2024-01-01T00:00:00Z'),
    genesis: 'genesis',
    version: 'version-1',
    breadcrumbs: [],
    activitySummary: {
      commentCount: 0,
      latestCommentId: '',
      latestChangeTime: '2024-01-01T00:00:00Z',
      isUnread: false,
    },
    generationInfo: {genesis: 'genesis', generation: 1n},
    metadata: opts.type ? {name, type: opts.type} : {name},
    visibility: opts.visibility ?? 'PUBLIC',
    isCollection: opts.isCollection,
  } as HMDocumentInfo
}

function render(state: Partial<AllDocumentsPageState> = {}, onStateChange = vi.fn()) {
  const fullState = {...DEFAULT_STATE, ...state}
  act(() => {
    root.render(
      <AllDocumentsPage
        siteId={hmId('site')}
        state={fullState}
        onStateChange={onStateChange}
        onNavigateToDocument={vi.fn()}
      />,
    )
  })
}

function documentTitles(): string[] {
  return Array.from(container.querySelectorAll('tbody button')).map((button) => button.textContent || '')
}

function clickHeader(label: string) {
  const header = Array.from(container.querySelectorAll('thead button')).find((b) => b.textContent?.includes(label))
  if (!header) throw new Error(`Missing header ${label}`)
  act(() => {
    header.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
  })
}

describe('AllDocumentsPage', () => {
  it('renders the page title and description with the space name', () => {
    useDirectoryMock.mockReturnValue({data: [], isLoading: false})
    render()
    expect(container.textContent).toContain('All documents')
    expect(container.textContent).toContain('Everything in Test Space')
  })

  it('sorts by location (depth-first hierarchy) by default', () => {
    useDirectoryMock.mockReturnValue({
      data: [
        makeDoc(['guides', 'setup', 'intro'], 'Intro'),
        makeDoc(['guides'], 'Guides'),
        makeDoc(['guides', 'setup'], 'Setup'),
        makeDoc(['about'], 'About'),
      ],
      isLoading: false,
    })
    render()
    // Depth-first with siblings A–Z: About, Guides, Setup, Intro
    expect(documentTitles()).toEqual(['About', 'Guides', 'Setup', 'Intro'])
  })

  it('Documents tab excludes collections and agents; Collections tab only collections; All includes agent', () => {
    const collection = makeDoc(['col'], 'My Collection', {isCollection: true})
    const agent = makeDoc(['agent'], 'My Agent', {type: 'hm://hyper.media/agent'})
    const doc = makeDoc(['doc'], 'My Doc')
    useDirectoryMock.mockReturnValue({data: [collection, agent, doc], isLoading: false})

    render({tab: 'documents'})
    expect(documentTitles()).toEqual(['My Doc'])

    render({tab: 'collections'})
    expect(documentTitles()).toEqual(['My Collection'])

    render({tab: 'all'})
    expect(documentTitles().sort()).toEqual(['My Agent', 'My Collection', 'My Doc'])
  })

  it('search matches title and location', () => {
    useDirectoryMock.mockReturnValue({
      data: [makeDoc(['guides', 'setup'], 'Setup Guide'), makeDoc(['about'], 'About')],
      isLoading: false,
    })
    // Match by title
    render({q: 'setup'})
    expect(documentTitles()).toEqual(['Setup Guide'])
    // Match by location
    render({q: 'guides'})
    expect(documentTitles()).toEqual(['Setup Guide'])
  })

  it('header sort: Updated click → newest first and callback receives sort updated; second click flips', () => {
    useDirectoryMock.mockReturnValue({
      data: [
        makeDoc(['old'], 'Old', {updateTime: '2024-01-01T00:00:00Z'}),
        makeDoc(['new'], 'New', {updateTime: '2024-12-01T00:00:00Z'}),
      ],
      isLoading: false,
    })
    const onStateChange = vi.fn()
    render({sort: 'updated', order: 'desc'}, onStateChange)
    expect(documentTitles()).toEqual(['New', 'Old'])

    // Click Updated header to flip to asc
    clickHeader('Updated')
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({sort: 'updated', order: 'asc'}))
  })

  it('clicking a different column selects it with its default direction', () => {
    useDirectoryMock.mockReturnValue({
      data: [makeDoc(['b'], 'Beta'), makeDoc(['a'], 'Alpha')],
      isLoading: false,
    })
    const onStateChange = vi.fn()
    render({sort: 'location', order: 'asc'}, onStateChange)
    clickHeader('Title')
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({sort: 'title', order: 'asc'}))
  })

  it('drafts render with a Draft marker', () => {
    useDirectoryMock.mockReturnValue({data: [], isLoading: false})
    useDraftsMock.mockReturnValue({
      data: [
        {
          id: 'draft-1',
          locationId: hmId('site', {path: ['new']}),
          editId: hmId('site', {path: ['new', '-draft-1']}),
          metadata: {name: 'New draft'},
        },
      ] as never[],
      isLoading: false,
    })
    render()
    expect(container.textContent).toContain('New draft')
    expect(container.textContent).toContain('Draft')
  })

  it('tree view shows ancestors of a matching child (parent muted, child nested)', () => {
    useDirectoryMock.mockReturnValue({
      data: [makeDoc(['guides'], 'Guides'), makeDoc(['guides', 'setup'], 'Setup')],
      isLoading: false,
    })
    render({view: 'tree', q: 'setup'})
    // Both the matching child and its ancestor should be visible
    expect(container.textContent).toContain('Setup')
    expect(container.textContent).toContain('Guides')
    // The ancestor (Guides) is context-only: rendered muted (opacity-60) on its title cell
    const guidesTitleCell = Array.from(container.querySelectorAll('tbody tr td')).find(
      (td) => td.textContent?.includes('Guides'),
    )
    expect(guidesTitleCell?.querySelector('div')?.className).toContain('opacity-60')
    // The child (Setup) is not muted
    const setupTitleCell = Array.from(container.querySelectorAll('tbody tr td')).find(
      (td) => td.textContent?.includes('Setup'),
    )
    expect(setupTitleCell?.querySelector('div')?.className).not.toContain('opacity-60')
  })

  it('tree view: Collections tab keeps a collection nested under its document ancestor', () => {
    useDirectoryMock.mockReturnValue({
      data: [
        makeDoc(['parent'], 'Parent Doc'),
        makeDoc(['parent', 'child-col'], 'Child Collection', {isCollection: true}),
      ],
      isLoading: false,
    })
    render({view: 'tree', tab: 'collections'})
    // The collection and its ancestor should both be visible
    expect(container.textContent).toContain('Child Collection')
    expect(container.textContent).toContain('Parent Doc')
  })

  it('count label reflects matching documents and ignores tree expansion and context rows', () => {
    useDirectoryMock.mockReturnValue({
      data: [makeDoc(['guides'], 'Guides'), makeDoc(['guides', 'setup'], 'Setup')],
      isLoading: false,
    })
    // Tree view with search matching only the child: count is 1 (not 2, ancestor is context-only)
    render({view: 'tree', q: 'setup'})
    const countLabel = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent?.match(/\d+ documents?/),
    )
    expect(countLabel?.textContent).toBe('1 document')
  })

  it('draft updated time renders from lastUpdateTime (milliseconds, relative)', () => {
    useDirectoryMock.mockReturnValue({data: [], isLoading: false})
    // lastUpdateTime is epoch milliseconds (producers use Date.now() / stat.mtimeMs).
    const twoHoursAgoMs = Date.now() - 2 * 3600_000
    useDraftsMock.mockReturnValue({
      data: [
        {
          id: 'draft-1',
          locationId: hmId('site', {path: ['new']}),
          editId: hmId('site', {path: ['new', '-draft-1']}),
          metadata: {name: 'New draft'},
          lastUpdateTime: twoHoursAgoMs,
        },
      ] as never[],
      isLoading: false,
    })
    render({sort: 'updated', order: 'desc'})
    expect(container.textContent).toContain('New draft')
    // The draft row should show a relative label (~2 hours ago) derived from lastUpdateTime.
    const draftRow = Array.from(container.querySelectorAll('tbody tr')).find(
      (tr) => tr.textContent?.includes('New draft'),
    )
    expect(draftRow?.textContent).toMatch(/2\s*hr/i)
  })

  it('trigger kind badge label is "Trigger" (not "Tool")', () => {
    const trigger = makeDoc(['trigger'], 'My Trigger', {type: 'hm://hyper.media/trigger'})
    useDirectoryMock.mockReturnValue({data: [trigger], isLoading: false})
    render()
    expect(container.textContent).toContain('Trigger')
    expect(container.textContent).not.toMatch(/My Trigger.*Tool/)
  })

  it('type badge shows label and kind icon aria-label, including private → Document + lock', () => {
    const privateDoc = makeDoc(['secret'], 'Secret', {visibility: 'PRIVATE'})
    const collection = makeDoc(['col'], 'Col', {isCollection: true})
    useDirectoryMock.mockReturnValue({data: [privateDoc, collection], isLoading: false})
    render()
    // Private doc: label "Document" with lock icon aria-label
    expect(container.textContent).toContain('Document')
    expect(container.querySelector('[aria-label="Private document"]')).toBeTruthy()
    // Collection: green pill with "Collection" label
    expect(container.textContent).toContain('Collection')
  })

  it('Authors column is not rendered (defaultVisible false)', () => {
    useDirectoryMock.mockReturnValue({data: [makeDoc(['doc'], 'Doc')], isLoading: false})
    render()
    const headers = Array.from(container.querySelectorAll('thead th')).map((h) => h.textContent)
    expect(headers.some((h) => h?.includes('Authors'))).toBe(false)
  })

  it('shows no-match message when search has no results', () => {
    useDirectoryMock.mockReturnValue({data: [makeDoc(['doc'], 'Doc')], isLoading: false})
    render({q: 'zzzznotfound'})
    expect(container.textContent).toContain('No documents match your search.')
  })

  it('shows empty message when there are no documents', () => {
    useDirectoryMock.mockReturnValue({data: [], isLoading: false})
    render()
    expect(container.textContent).toContain('No documents found.')
  })

  it('navigates to a document on title click and new window on shift-click', () => {
    const document_ = makeDoc(['doc'], 'Doc Title')
    useDirectoryMock.mockReturnValue({data: [document_], isLoading: false})
    const onNavigateToDocument = vi.fn()
    act(() => {
      root.render(
        <AllDocumentsPage
          siteId={hmId('site')}
          state={DEFAULT_STATE}
          onStateChange={vi.fn()}
          onNavigateToDocument={onNavigateToDocument}
        />,
      )
    })
    const titleButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Doc Title')!
    act(() => {
      titleButton.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    expect(onNavigateToDocument).toHaveBeenCalledWith(document_.id)
    act(() => {
      titleButton.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, shiftKey: true}))
    })
    expect(onNavigateToDocument).toHaveBeenCalledWith(document_.id, {newWindow: true})
  })
})
