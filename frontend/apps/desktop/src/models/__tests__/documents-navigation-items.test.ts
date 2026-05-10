import {describe, expect, it} from 'vitest'
import type {HMResourceFetchResult, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useSiteNavigationItems} from '../documents'

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

function makeSiteHomeEntity(withNavigation: boolean): HMResourceFetchResult {
  const homeId = makeId('alice')
  return {
    id: homeId,
    document: {
      id: homeId,
      updateTime: '2024-01-01T00:00:00Z',
      createTime: '2024-01-01T00:00:00Z',
      genesis: 'genesis',
      version: 'v1',
      authors: ['alice'],
      metadata: {name: 'Alice Space'},
      content: [],
      detachedBlocks: withNavigation
        ? {
            navigation: {
              block: {id: 'navigation', type: 'Group'},
              children: [
                {block: {id: 'nav-1', type: 'Link', text: 'Docs', link: 'hm://alice/docs'}},
                {block: {id: 'nav-2', type: 'Link', text: 'About', link: 'hm://alice/about'}},
              ],
            },
          }
        : {},
    } as any,
    type: 'document',
  } as HMResourceFetchResult
}

describe('useSiteNavigationItems', () => {
  it('returns explicit navigation items when the home document has a navigation block', () => {
    const result = useSiteNavigationItems(makeSiteHomeEntity(true))

    expect(result).toEqual([
      {
        key: 'nav-1',
        id: makeId('alice', ['docs']),
        webUrl: undefined,
        isPublished: true,
        metadata: {name: 'Docs'},
      },
      {
        key: 'nav-2',
        id: makeId('alice', ['about']),
        webUrl: undefined,
        isPublished: true,
        metadata: {name: 'About'},
      },
    ])
  })

  it('returns an empty list when no explicit navigation block exists', () => {
    expect(useSiteNavigationItems(makeSiteHomeEntity(false))).toEqual([])
  })
})
