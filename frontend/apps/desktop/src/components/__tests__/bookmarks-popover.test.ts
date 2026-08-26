import {TooltipProvider} from '@shm/ui/tooltip'
import {readFileSync} from 'node:fs'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {describe, expect, it, vi} from 'vitest'

vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/models/bookmarks', () => ({
  useBookmarks: () => [],
  useRemoveBookmark: () => ({isLoading: false, mutate: vi.fn()}),
}))
vi.mock('@shm/shared/models/contacts', () => ({useSelectedAccountContacts: () => ({data: []})}))
vi.mock('@shm/shared/models/entity', () => ({useResources: () => []}))
vi.mock('@shm/shared', () => ({useRouteLink: () => ({onClick: vi.fn()})}))

import {BookmarksPopover, newestBookmarksFirst} from '../bookmarks-popover'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('newestBookmarksFirst', () => {
  it('returns bookmarks newest first without mutating stored order', () => {
    const stored = [{url: 'first'}, {url: 'second'}, {url: 'latest'}]

    expect(newestBookmarksFirst(stored).map((bookmark) => bookmark.url)).toEqual(['latest', 'second', 'first'])
    expect(stored.map((bookmark) => bookmark.url)).toEqual(['first', 'second', 'latest'])
  })
})

describe('titlebar integration', () => {
  it('renders bookmarks immediately before notifications', () => {
    const titlebar = readFileSync('src/components/titlebar-common.tsx', 'utf8')
    const bookmarksIndex = titlebar.indexOf('<BookmarksPopover />')
    const notificationsIndex = titlebar.indexOf('<NotificationButton />')

    expect(bookmarksIndex).toBeGreaterThan(-1)
    expect(bookmarksIndex).toBeLessThan(notificationsIndex)
  })

  it('lets users open the bookmarks popover from its button', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      act(() => root.render(React.createElement(TooltipProvider, null, React.createElement(BookmarksPopover))))
      const button = container.querySelector('button[aria-label="Bookmarks"]')

      expect(button).toBeTruthy()
      expect(document.body.textContent).not.toContain('No bookmarks yet')

      act(() => button?.dispatchEvent(new MouseEvent('click', {bubbles: true})))

      expect(document.body.textContent).toContain('No bookmarks yet')
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})

describe('bookmark row layout', () => {
  it('renders a leading icon badge without a secondary type label', () => {
    const popover = readFileSync('src/components/bookmarks-popover.tsx', 'utf8')

    expect(popover).toContain('min-h-12')
    expect(popover).toContain(
      'bg-muted-foreground/15 text-foreground flex size-8 shrink-0 items-center justify-center rounded-full',
    )
    expect(popover).not.toContain('bookmarkKindLabel(bookmark)')
  })
})

describe('bookmark popover focus', () => {
  it('does not auto-focus the first remove button when opened', () => {
    const popover = readFileSync('src/components/bookmarks-popover.tsx', 'utf8')

    expect(popover).toContain('onOpenAutoFocus={(event) => event.preventDefault()}')
  })
})
