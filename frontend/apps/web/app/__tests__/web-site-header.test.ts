import {describe, expect, it, vi} from 'vitest'
import type {DocNavigationItem} from '@shm/ui/navigation'
import {getSiteNavDirectory} from '@shm/ui/navigation'
import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

vi.mock('@shm/shared', () => ({unpackHmId: vi.fn()}))
vi.mock('@shm/shared/constants', () => ({NOTIFY_SERVICE_HOST: ''}))
vi.mock('@shm/shared/models/entity', () => ({useDirectory: vi.fn(), useResource: vi.fn()}))
vi.mock('@shm/ui/hm-host-banner', () => ({HypermediaHostBanner: vi.fn()}))
vi.mock('@shm/ui/site-header', () => ({SiteHeader: vi.fn()}))

import {resolveNavigationItems} from '../web-site-header'

function makeNavItem(name: string): DocNavigationItem {
  return {
    key: name,
    metadata: {name},
    isPublished: true,
  }
}

describe('resolveNavigationItems', () => {
  const homeNav = [makeNavItem('Home Nav 1'), makeNavItem('Home Nav 2')]
  const dirItems = [makeNavItem('Dir Item 1'), makeNavItem('Dir Item 2')]

  it('returns empty array while home resource is loading', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: true,
      homeNavigationItems: [],
      directoryItems: dirItems,
    })
    expect(result).toEqual([])
  })

  it('returns empty array while loading even if both have items', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: true,
      homeNavigationItems: homeNav,
      directoryItems: dirItems,
    })
    expect(result).toEqual([])
  })

  it('returns home navigation items when available after loading', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: false,
      homeNavigationItems: homeNav,
      directoryItems: dirItems,
    })
    expect(result).toBe(homeNav)
  })

  it('falls back to directory items when no home navigation items after loading', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: false,
      homeNavigationItems: [],
      directoryItems: dirItems,
    })
    expect(result).toBe(dirItems)
  })

  it('returns empty array when both are empty and loaded', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: false,
      homeNavigationItems: [],
      directoryItems: [],
    })
    expect(result).toEqual([])
  })
})

describe('site-header directory fallback (regression for #418)', () => {
  function makeId(uid: string, path?: string[]): UnpackedHypermediaId {
    return {
      uid,
      path: path ?? null,
      version: null,
      blockRef: null,
      blockRange: null,
      hostname: null,
      scheme: null,
      latest: null,
      id: `${uid}/${path?.join('/') ?? ''}`,
    }
  }

  function makeDocInfo(uid: string, path: string[], name: string, visibility: 'PUBLIC' | 'PRIVATE'): HMDocumentInfo {
    const ts = '2024-01-01T00:00:00Z'
    return {
      type: 'document',
      id: makeId(uid, path),
      path,
      authors: [uid],
      createTime: ts,
      updateTime: ts,
      sortTime: new Date(ts),
      genesis: 'genesis',
      version: 'v1',
      breadcrumbs: [],
      activitySummary: {commentCount: 0, latestCommentId: '', latestChangeTime: ts, isUnread: false},
      generationInfo: {genesis: 'genesis', generation: 1n},
      metadata: {name},
      visibility,
    }
  }

  // The site header builds its directory fallback by calling
  // `getSiteNavDirectory({id, directory})` with NO `includePrivate` flag.
  // This locks in that contract: with no flag, private docs must be excluded —
  // even when the underlying directory query returned them (which happens for
  // any viewer with writer+ capability on the site home).
  it('excludes private docs when called the way WebSiteHeader calls it', () => {
    const homeId = makeId('alice')
    const directory: HMDocumentInfo[] = [
      makeDocInfo('alice', ['public-doc'], 'Public Doc', 'PUBLIC'),
      makeDocInfo('alice', ['private-doc'], 'Private Doc', 'PRIVATE'),
    ]
    const items = getSiteNavDirectory({id: homeId, directory})
    const names = items.map((i) => i.metadata.name)
    expect(names).toContain('Public Doc')
    expect(names).not.toContain('Private Doc')
  })
})
