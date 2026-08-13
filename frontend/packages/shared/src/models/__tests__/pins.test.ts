import {describe, expect, it} from 'vitest'
import {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from '../../utils/entity-id-url'
import {pinnedDocumentId, pinnedDocumentToUnpackedId, PinnedDocument, resolvePins} from '../pins'

function makeDocument(
  overrides: Partial<HMDocumentInfo> & {uid: string; path?: string[]; version?: string},
): HMDocumentInfo {
  const path = overrides.path ?? []
  const id = hmId(overrides.uid, {path})
  return {
    type: 'document',
    id,
    path,
    authors: [],
    createTime: '2024-01-01T00:00:00Z',
    updateTime: '2024-01-01T00:00:00Z',
    sortTime: new Date('2024-01-01T00:00:00Z'),
    genesis: '',
    version: overrides.version ?? 'v1',
    breadcrumbs: [],
    activitySummary: {
      latestChangeTime: '2024-01-01T00:00:00Z',
      latestCommentId: '',
      commentCount: 0,
      isUnread: false,
    },
    generationInfo: {genesis: '', generation: 0n},
    metadata: {name: overrides.metadata?.name ?? 'Doc'},
    visibility: 'PUBLIC',
  } as unknown as HMDocumentInfo
}

function makePin(overrides: Partial<PinnedDocument> & {siteUid: string; path?: string[]}): PinnedDocument {
  return {
    siteUid: overrides.siteUid,
    path: overrides.path ?? [],
    seenVersion: overrides.seenVersion ?? 'v1',
    title: overrides.title ?? 'Doc',
    createdAt: overrides.createdAt ?? '2024-01-01T00:00:00Z',
  }
}

describe('pins', () => {
  describe('pinnedDocumentId', () => {
    it('joins site uid and path with a colon', () => {
      const pin = makePin({siteUid: 'alice', path: ['projects', 'seed']})
      expect(pinnedDocumentId(pin)).toBe('alice:projects/seed')
    })

    it('handles a root path', () => {
      const pin = makePin({siteUid: 'alice'})
      expect(pinnedDocumentId(pin)).toBe('alice:')
    })
  })

  describe('pinnedDocumentToUnpackedId', () => {
    it('round-trips site uid, path and seen version', () => {
      const pin = makePin({siteUid: 'alice', path: ['projects'], seenVersion: 'v2'})
      const id = pinnedDocumentToUnpackedId(pin)
      expect(id.uid).toBe('alice')
      expect(id.path).toEqual(['projects'])
      expect(id.version).toBe('v2')
    })
  })

  describe('resolvePins', () => {
    it('marks a pin as ok when its version matches the directory item', () => {
      const pin = makePin({siteUid: 'alice', path: ['projects']})
      const doc = makeDocument({uid: 'alice', path: ['projects'], version: 'v1'})
      const result = resolvePins([pin], [doc])
      expect(result).toHaveLength(1)
      expect(result[0]!.status).toBe('ok')
      expect(result[0]!.item).toBe(doc)
    })

    it('marks a pin as outdated when the directory item has a different version', () => {
      const pin = makePin({siteUid: 'alice', path: ['projects'], seenVersion: 'v1'})
      const doc = makeDocument({uid: 'alice', path: ['projects'], version: 'v2'})
      const result = resolvePins([pin], [doc])
      expect(result[0]!.status).toBe('outdated')
      expect(result[0]!.item).toBe(doc)
    })

    it('marks a pin as deleted when it is missing from the directory', () => {
      const pin = makePin({siteUid: 'alice', path: ['projects']})
      const result = resolvePins([pin], [])
      expect(result[0]!.status).toBe('deleted')
      expect(result[0]!.item).toBeUndefined()
    })

    it('matches by site uid and exact path', () => {
      const pin = makePin({siteUid: 'alice', path: ['projects']})
      const otherSite = makeDocument({uid: 'bob', path: ['projects'], version: 'v1'})
      const otherPath = makeDocument({uid: 'alice', path: ['notes'], version: 'v1'})
      const result = resolvePins([pin], [otherSite, otherPath])
      expect(result[0]!.status).toBe('deleted')
    })
  })
})
