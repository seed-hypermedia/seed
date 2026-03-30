import {describe, expect, it} from 'vitest'
import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getSiteNavDirectory} from '../navigation'

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

const timestamp = '2024-01-01T00:00:00Z'

function makeDocInfo(
  uid: string,
  path: string[],
  name: string,
  visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC',
): HMDocumentInfo {
  return {
    type: 'document',
    id: makeId(uid, path),
    path,
    authors: [uid],
    createTime: timestamp,
    updateTime: timestamp,
    sortTime: new Date(timestamp),
    genesis: 'genesis',
    version: 'v1',
    breadcrumbs: [],
    activitySummary: {
      commentCount: 0,
      latestCommentId: '',
      latestChangeTime: timestamp,
      isUnread: false,
    },
    generationInfo: {genesis: 'genesis', generation: 1n},
    metadata: {name},
    visibility,
  }
}

describe('getSiteNavDirectory', () => {
  const homeId = makeId('alice')

  it('returns public documents as navigation items', () => {
    const directory: HMDocumentInfo[] = [
      makeDocInfo('alice', ['docs'], 'Docs'),
      makeDocInfo('alice', ['about'], 'About'),
    ]

    const result = getSiteNavDirectory({id: homeId, directory})

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.metadata.name)).toEqual(['About', 'Docs'])
    expect(result.every((r) => r.isPublished)).toBe(true)
  })

  it('excludes private documents by default', () => {
    const directory: HMDocumentInfo[] = [
      makeDocInfo('alice', ['docs'], 'Docs', 'PUBLIC'),
      makeDocInfo('alice', ['secret'], 'Secret Notes', 'PRIVATE'),
      makeDocInfo('alice', ['about'], 'About', 'PUBLIC'),
    ]

    const result = getSiteNavDirectory({id: homeId, directory})

    expect(result).toHaveLength(2)
    const names = result.map((r) => r.metadata.name)
    expect(names).toContain('Docs')
    expect(names).toContain('About')
    expect(names).not.toContain('Secret Notes')
  })

  it('excludes private documents when includePrivate is explicitly false', () => {
    const directory: HMDocumentInfo[] = [
      makeDocInfo('alice', ['docs'], 'Docs', 'PUBLIC'),
      makeDocInfo('alice', ['secret'], 'Secret Notes', 'PRIVATE'),
    ]

    const result = getSiteNavDirectory({id: homeId, directory, includePrivate: false})

    expect(result).toHaveLength(1)
    expect(result[0]!.metadata.name).toBe('Docs')
  })

  it('includes private documents when includePrivate is true', () => {
    const directory: HMDocumentInfo[] = [
      makeDocInfo('alice', ['docs'], 'Docs', 'PUBLIC'),
      makeDocInfo('alice', ['secret'], 'Secret Notes', 'PRIVATE'),
      makeDocInfo('alice', ['about'], 'About', 'PUBLIC'),
    ]

    const result = getSiteNavDirectory({id: homeId, directory, includePrivate: true})

    expect(result).toHaveLength(3)
    const names = result.map((r) => r.metadata.name)
    expect(names).toContain('Docs')
    expect(names).toContain('About')
    expect(names).toContain('Secret Notes')
  })

  it('returns empty array when all documents are private and includePrivate is false', () => {
    const directory: HMDocumentInfo[] = [
      makeDocInfo('alice', ['secret1'], 'Secret 1', 'PRIVATE'),
      makeDocInfo('alice', ['secret2'], 'Secret 2', 'PRIVATE'),
    ]

    const result = getSiteNavDirectory({id: homeId, directory})

    expect(result).toHaveLength(0)
  })

  it('returns all documents when all are private and includePrivate is true', () => {
    const directory: HMDocumentInfo[] = [
      makeDocInfo('alice', ['secret1'], 'Secret 1', 'PRIVATE'),
      makeDocInfo('alice', ['secret2'], 'Secret 2', 'PRIVATE'),
    ]

    const result = getSiteNavDirectory({id: homeId, directory, includePrivate: true})

    expect(result).toHaveLength(2)
  })


  it('returns empty array when directory is undefined', () => {
    const result = getSiteNavDirectory({id: homeId, directory: undefined})
    expect(result).toHaveLength(0)
  })

  it('returns empty array when directory is empty', () => {
    const result = getSiteNavDirectory({id: homeId, directory: []})
    expect(result).toHaveLength(0)
  })

  it('preserves visibility field on returned items', () => {
    const directory: HMDocumentInfo[] = [makeDocInfo('alice', ['docs'], 'Docs', 'PUBLIC')]

    const result = getSiteNavDirectory({id: homeId, directory})

    expect(result[0]!.visibility).toBe('PUBLIC')
  })
})
