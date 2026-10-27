import {describe, expect, it} from 'vitest'
import type {HMRawCitation} from '@seed-hypermedia/client/hm-types'
import {groupDocumentConnections} from '../connections'
import {hmId} from '../utils/entity-id-url'

const target = hmId('target', {path: ['document']})

const link = (overrides: Partial<HMRawCitation> = {}): HMRawCitation => ({
  source: 'hm://alice/source?v=version1',
  sourceType: 'Ref',
  sourceContext: 'p1',
  citationType: 'doc/Link',
  sourceBlob: {cid: 'version1', createTime: '2026-10-20T10:00:00Z'},
  ...overrides,
})

describe('document connections', () => {
  it('groups multiple blocks and comments under their source document', () => {
    const groups = groupDocumentConnections(target, [
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
    const groups = groupDocumentConnections(target, [
      link(),
      link({targetFragment: 'other'}),
      link({source: 'hm://alice/source?v=version2', sourceBlob: {cid: 'ref-blob', createTime: '2026-10-21T10:00:00Z'}}),
    ])
    expect(groups[0]?.sources).toHaveLength(1)
    expect(groups[0]?.sources[0]?.id.version).toBe('version2')
    expect(groups[0]?.sources[0]?.id.blockRef).toBe('p1')
  })

  it('does not use a Ref blob CID as a document version', () => {
    const groups = groupDocumentConnections(target, [link({source: 'hm://alice/source'})])
    expect(groups[0]?.sources[0]?.id.version).toBeNull()
    expect(groups[0]?.sources[0]?.id.blockRef).toBe('p1')
  })

  it('filters target fragments without confusing them with source blocks', () => {
    const groups = groupDocumentConnections(
      target,
      [link({targetFragment: 'intro[2:8]'}), link({targetFragment: 'other', sourceContext: 'p2'})],
      'intro',
    )
    expect(groups[0]?.sources).toHaveLength(1)
    expect(groups[0]?.sources[0]?.id.blockRef).toBe('p1')
  })

  it('does not invent source documents for invalid links or comments with no document context', () => {
    expect(
      groupDocumentConnections(target, [
        link({source: 'invalid'}),
        link({sourceType: 'Comment', citationType: 'comment/Link'}),
        link({sourceType: 'Capability', citationType: undefined}),
      ]),
    ).toEqual([])
  })
  it('excludes comments on the target document and links from its own blocks', () => {
    const target = hmId('alice', {path: ['source'], version: 'current-version', blockRef: 'intro'})
    const groups = groupDocumentConnections(target, [
      link({source: 'hm://alice/source?v=older-version#self'}),
      link({
        source: 'hm://bob/internal-comment',
        sourceType: 'Comment',
        sourceDocument: 'hm://alice/source?v=older-version#intro',
        citationType: 'comment/Embed',
      }),
      link({source: 'hm://alice/another'}),
      link({
        source: 'hm://bob/external-comment',
        sourceType: 'Comment',
        sourceDocument: 'hm://alice/another',
        citationType: 'comment/Embed',
      }),
      link({source: 'hm://other-account/source'}),
    ])
    expect(groups.map((group) => group.id.id)).toEqual(['hm://alice/another', 'hm://other-account/source'])
    expect(groups[0]?.sources).toHaveLength(2)
    expect(groups[0]?.sources[1]?.isComment).toBe(true)
  })

  it('returns no connections when a root document only has its own comments', () => {
    expect(
      groupDocumentConnections(
        hmId('alice'),
        [
          link({
            source: 'hm://bob/comment',
            sourceType: 'Comment',
            sourceDocument: 'hm://alice?v=older-version',
            citationType: 'comment/Link',
            targetFragment: 'intro[1:3]',
          }),
        ],
        'intro',
      ),
    ).toEqual([])
  })
})
