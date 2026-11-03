import {TooltipProvider} from '@shm/ui/tooltip'
import {readFileSync} from 'node:fs'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
  bookmarks: [] as any[],
  navigate: vi.fn(),
  route: {key: 'document', id: {uid: 'alice'}, panel: null} as any,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => state.route,
  useNavigate: () => (route: unknown) => {
    state.route = route
  },
}))

beforeEach(() => {
  state.route = {key: 'document', id: {uid: 'alice'}, panel: null}
  state.bookmarks = []
  state.navigate.mockClear()
})

vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/models/bookmarks', () => ({
  useBookmarks: () => state.bookmarks,
  useRemoveBookmark: () => ({
    isLoading: false,
    mutate: (url: string) => {
      state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.url !== url)
    },
  }),
}))
vi.mock('@shm/shared/models/contacts', () => ({useSelectedAccountContacts: () => ({data: []})}))
vi.mock('@shm/shared/models/entity', () => ({
  useResources: (ids: any[]) => ids.map((id) => ({data: {type: 'document', id, document: {metadata: {name: id.uid}}}})),
}))
vi.mock('@shm/shared', () => ({useRouteLink: (route: unknown) => ({onClick: () => state.navigate(route)})}))

import {
  bookmarkRoute,
  BookmarksPanel,
  BookmarksPanelProvider,
  useBookmarksPanel,
  newestBookmarksFirst,
} from '../bookmarks-panel'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('newestBookmarksFirst', () => {
  it('returns bookmarks newest first without mutating stored order', () => {
    const stored = [{url: 'first'}, {url: 'second'}, {url: 'latest'}]

    expect(newestBookmarksFirst(stored).map((bookmark) => bookmark.url)).toEqual(['latest', 'second', 'first'])
    expect(stored.map((bookmark) => bookmark.url)).toEqual(['first', 'second', 'latest'])
  })
})

describe('bookmarks panel', () => {
  it('keeps bookmarks from different spaces available after navigation and keyboard removal', () => {
    state.bookmarks = ['alice', 'bob'].map((uid) => ({
      key: 'document',
      id: {id: `hm://${uid}`, uid, path: []},
      url: `hm://${uid}`,
      viewTerm: null,
    }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const render = () =>
      root.render(
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(BookmarksPanelProvider, null, React.createElement(BookmarksPanel)),
        ),
      )
    try {
      act(render)
      const links = container.querySelectorAll('[role="link"]')
      expect(links).toHaveLength(2)
      act(() => links[0]?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})))
      expect(state.navigate).toHaveBeenCalledWith({key: 'document', id: expect.objectContaining({uid: 'bob'})})
      expect(container.querySelectorAll('[role="link"]')).toHaveLength(2)
      state.navigate.mockClear()
      const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove bob from Bookmarks"]')!
      act(() => {
        remove.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
        remove.click()
      })
      act(render)
      expect(state.navigate).not.toHaveBeenCalled()
      expect(state.bookmarks.map((bookmark) => bookmark.id.uid)).toEqual(['alice'])
      expect(container.querySelectorAll('[role="link"]')).toHaveLength(1)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  it('opens from its context and closes with its panel control', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    function PanelHarness() {
      const panel = useBookmarksPanel()
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', {onClick: panel.open}, 'Open saved bookmarks'),
        panel.isOpen ? React.createElement(BookmarksPanel) : null,
      )
    }
    try {
      act(() =>
        root.render(
          React.createElement(
            TooltipProvider,
            null,
            React.createElement(BookmarksPanelProvider, null, React.createElement(PanelHarness)),
          ),
        ),
      )
      expect(container.textContent).not.toContain('No bookmarks yet')
      act(() => container.querySelector('button')?.click())
      expect(container.textContent).toContain('No bookmarks yet')
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Close panel"]')?.click())
      expect(container.textContent).not.toContain('No bookmarks yet')
      act(() => container.querySelector('button')?.click())
      act(
        () =>
          container
            .querySelector('section')
            ?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})),
      )
      expect(container.textContent).not.toContain('No bookmarks yet')
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})

describe('comments icons', () => {
  it('uses MessagesSquare in bookmarks and document tools', () => {
    const popover = readFileSync('src/components/bookmarks-panel.tsx', 'utf8')
    const documentTools = readFileSync('../../packages/ui/src/document-tools.tsx', 'utf8')

    expect(popover).toContain("':comments': MessagesSquare")
    expect(documentTools).not.toMatch(/\bMessageSquare\b/)
  })
})

describe('comment bookmarks', () => {
  it('routes directly to the bookmarked comment', () => {
    expect(
      bookmarkRoute({
        key: 'comment',
        id: {id: 'hm://alice/comment', uid: 'alice', path: ['comment']},
        url: 'hm://alice/comment',
        viewTerm: null,
        title: 'Saved comment',
        commentId: 'alice/comment',
        targetId: {id: 'hm://space/doc', uid: 'space', path: ['doc']},
        authorAccountId: 'alice',
      } as any),
    ).toEqual({key: 'comments', id: expect.objectContaining({uid: 'space'}), openComment: 'alice/comment'})
  })

  it('renders the author avatar with a comment badge', () => {
    const popover = readFileSync('src/components/bookmarks-panel.tsx', 'utf8')

    expect(popover).toContain('<AccountAvatar')
    expect(popover).toContain('id={authorId}')
    expect(popover).toContain('<MessageSquare className="text-foreground size-3" />')
  })
})

describe('Activity and Bookmarks selection', () => {
  it('replaces Activity with Bookmarks and does not restore Bookmarks after Activity closes', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    function Controls() {
      const panel = useBookmarksPanel()
      return React.createElement('button', {onClick: panel.open}, panel.isOpen ? 'Bookmarks open' : 'Bookmarks closed')
    }
    const render = () => root.render(React.createElement(BookmarksPanelProvider, null, React.createElement(Controls)))
    try {
      state.route = {...state.route, panel: {key: 'feed', tab: 'to-you'}}
      act(render)
      act(() => container.querySelector('button')!.click())
      act(render)
      expect(state.route.panel).toBeNull()
      expect(container.textContent).toBe('Bookmarks open')
      state.route = {...state.route, panel: {key: 'feed', tab: 'all-updates'}}
      act(render)
      expect(container.textContent).toBe('Bookmarks closed')
      state.route = {...state.route, panel: null}
      act(render)
      expect(container.textContent).toBe('Bookmarks closed')
    } finally {
      act(() => root.unmount())
    }
  })
})
