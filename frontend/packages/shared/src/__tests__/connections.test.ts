import {describe, expect, it} from 'vitest'
import type {HMRawCitation} from '@seed-hypermedia/client/hm-types'
import {groupDocumentConnections} from '../connections'

const link = (overrides: Partial<HMRawCitation> = {}): HMRawCitation => ({
  source: 'hm://alice/source',
  sourceType: 'Ref',
  sourceContext: 'p1',
  citationType: 'doc/Link',
  sourceBlob: {cid: 'version1', createTime: '2026-10-20T10:00:00Z'},
  ...overrides,
})

describe('document connections', () => {
  it('groups multiple blocks and comments under their source document', () => {
    const groups = groupDocumentConnections([
      link(),
      link({sourceContext: 'p2'}),
      link({
        source: 'hm://bob/comment1',
        sourceType: 'Comment',
        sourceDocument: 'hm://alice/source',
        citationType: 'comment/Embed',
      }),
      link({source: 'hm://alice/another'}),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]?.sources).toHaveLength(3)
    expect(groups[0]?.sources[2]?.isComment).toBe(true)
    expect(groups[0]?.sources[2]?.id.uid).toBe('bob')
  })

  it('keeps each source block once at its newest version', () => {
    const groups = groupDocumentConnections([
      link(),
      link({targetFragment: 'other'}),
      link({sourceBlob: {cid: 'version2', createTime: '2026-10-21T10:00:00Z'}}),
    ])
    expect(groups[0]?.sources).toHaveLength(1)
    expect(groups[0]?.sources[0]?.id.version).toBe('version2')
    expect(groups[0]?.sources[0]?.id.blockRef).toBe('p1')
  })

  it('filters target fragments without confusing them with source blocks', () => {
    const groups = groupDocumentConnections(
      [link({targetFragment: 'intro[2:8]'}), link({targetFragment: 'other', sourceContext: 'p2'})],
      'intro',
    )
    expect(groups[0]?.sources).toHaveLength(1)
    expect(groups[0]?.sources[0]?.id.blockRef).toBe('p1')
  })

  it('does not invent source documents for invalid links or comments with no document context', () => {
    expect(
      groupDocumentConnections([
        link({source: 'invalid'}),
        link({sourceType: 'Comment', citationType: 'comment/Link'}),
        link({sourceType: 'Capability', citationType: undefined}),
      ]),
    ).toEqual([])
  })
})
