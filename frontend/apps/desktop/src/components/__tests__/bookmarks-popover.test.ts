import {describe, expect, it, vi} from 'vitest'

vi.mock('@/trpc', () => ({client: {}}))

import {bookmarkKindLabel, newestBookmarksFirst} from '../bookmarks-popover'

describe('newestBookmarksFirst', () => {
  it('returns bookmarks newest first without mutating stored order', () => {
    const stored = [{url: 'first'}, {url: 'second'}, {url: 'latest'}]

    expect(newestBookmarksFirst(stored).map((bookmark) => bookmark.url)).toEqual(['latest', 'second', 'first'])
    expect(stored.map((bookmark) => bookmark.url)).toEqual(['first', 'second', 'latest'])
  })
})

describe('bookmarkKindLabel', () => {
  it('describes profiles, documents, and saved views', () => {
    expect(bookmarkKindLabel({key: 'profile', viewTerm: ':following'})).toBe('Profile · Following')
    expect(bookmarkKindLabel({key: 'document', viewTerm: ':comments'})).toBe('Document · Comments')
    expect(bookmarkKindLabel({key: 'document', viewTerm: null})).toBe('Document')
  })
})
