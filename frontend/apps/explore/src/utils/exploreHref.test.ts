import {hmId} from '@shm/shared'
import {describe, expect, it} from 'vitest'
import {exploreHref, exploreTabHref, isProfileId, parseHmRoutePath, tabToViewTerm, viewTermToExploreTab} from './exploreHref'

describe('exploreHref', () => {
  it('links to a profile (root document) with no path', () => {
    expect(exploreHref(hmId('zAccount'))).toBe('/hm/zAccount')
  })

  it('includes the path segments for a document', () => {
    expect(exploreHref(hmId('zAccount', {path: ['notes', 'thread']}))).toBe('/hm/zAccount/notes/thread')
  })

  it('appends the version as a query param', () => {
    expect(exploreHref(hmId('zAccount', {path: ['notes'], version: 'bafyVersion'}))).toBe(
      '/hm/zAccount/notes?v=bafyVersion',
    )
  })
})

describe('isProfileId', () => {
  it('is true for an account home doc (empty path)', () => {
    expect(isProfileId(hmId('zAccount'))).toBe(true)
    expect(isProfileId(hmId('zAccount', {path: []}))).toBe(true)
  })

  it('is false for a document with a path', () => {
    expect(isProfileId(hmId('zAccount', {path: ['notes']}))).toBe(false)
  })
})

describe('parseHmRoutePath', () => {
  it('parses a bare uid', () => {
    expect(parseHmRoutePath('zAccount')).toEqual({
      uid: 'zAccount',
      path: [],
      viewTerm: null,
      defaultTab: null,
    })
  })

  it('parses uid + path segments', () => {
    expect(parseHmRoutePath('zAccount/notes/thread')).toEqual({
      uid: 'zAccount',
      path: ['notes', 'thread'],
      viewTerm: null,
      defaultTab: null,
    })
  })

  it('strips a /:profile view term back to the account home doc', () => {
    expect(parseHmRoutePath('zAccount/:profile')).toEqual({
      uid: 'zAccount',
      path: [],
      viewTerm: ':profile',
      defaultTab: 'profile',
    })
  })

  it('maps a /:comments view term to the comments tab and keeps the path', () => {
    expect(parseHmRoutePath('zAccount/notes/:comments')).toEqual({
      uid: 'zAccount',
      path: ['notes'],
      viewTerm: ':comments',
      defaultTab: 'comments',
    })
  })

  it('handles an empty route tail', () => {
    expect(parseHmRoutePath(undefined)).toEqual({uid: '', path: [], viewTerm: null, defaultTab: null})
  })

  it('resolves a /:comments/<commentId> tail to the comment resource', () => {
    expect(parseHmRoutePath('zDocAccount/mydoc/:comments/zCommentAccount/ts-abc123')).toEqual({
      uid: 'zCommentAccount',
      path: ['ts-abc123'],
      viewTerm: ':comments',
      defaultTab: null,
      commentId: 'zCommentAccount/ts-abc123',
    })
  })
})

describe('viewTermToExploreTab', () => {
  it('maps :profile to the profile tab', () => {
    expect(viewTermToExploreTab(':profile')).toBe('profile')
  })

  it('maps comment-family terms to the comments tab', () => {
    expect(viewTermToExploreTab(':comments')).toBe('comments')
    expect(viewTermToExploreTab(':discussions')).toBe('comments')
  })

  it('maps directory terms to the children tab and collaborators to capabilities', () => {
    expect(viewTermToExploreTab(':directory')).toBe('children')
    expect(viewTermToExploreTab(':all-documents')).toBe('children')
    expect(viewTermToExploreTab(':collaborators')).toBe('capabilities')
  })

  it('has no distinct tab for the remaining profile-family or feed terms', () => {
    expect(viewTermToExploreTab(':followers')).toBeNull()
    expect(viewTermToExploreTab(':feed')).toBeNull()
    expect(viewTermToExploreTab(null)).toBeNull()
  })
})

describe('tabToViewTerm', () => {
  it('round-trips view-term tabs', () => {
    expect(tabToViewTerm('profile')).toBe(':profile')
    expect(tabToViewTerm('comments')).toBe(':comments')
    expect(tabToViewTerm('capabilities')).toBe(':collaborators')
    expect(tabToViewTerm('children')).toBe(':directory')
  })

  it('returns null for explore-only tabs', () => {
    expect(tabToViewTerm('document')).toBeNull()
    expect(tabToViewTerm('changes')).toBeNull()
    expect(tabToViewTerm('versions')).toBeNull()
    expect(tabToViewTerm('citations')).toBeNull()
    expect(tabToViewTerm('authored-comments')).toBeNull()
  })
})

describe('exploreTabHref', () => {
  const id = hmId('zAccount', {path: ['notes']})

  it('encodes a view-term tab in the path and drops ?tab', () => {
    expect(exploreTabHref(id, 'comments', new URLSearchParams('tab=document'))).toBe('/hm/zAccount/notes/:comments')
  })

  it('uses /:profile for the profile tab on an account root', () => {
    expect(exploreTabHref(hmId('zAccount'), 'profile', new URLSearchParams())).toBe('/hm/zAccount/:profile')
  })

  it('preserves the version param on view-term tabs', () => {
    expect(exploreTabHref(id, 'comments', new URLSearchParams('v=bafyVersion'))).toBe(
      '/hm/zAccount/notes/:comments?v=bafyVersion',
    )
  })

  it('uses ?tab= for explore-only tabs', () => {
    expect(exploreTabHref(id, 'citations', new URLSearchParams())).toBe('/hm/zAccount/notes?tab=citations')
  })
})
