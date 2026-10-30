import {describe, expect, it} from 'vitest'
import type {HMBlockNode, HMRawCitation} from '@seed-hypermedia/client/hm-types'
import {buildConnectionsGraph, groupDocumentConnections} from '../connections'
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

describe('connection graph', () => {
  const contentWithLinks = (links: string[]): HMBlockNode[] => [
    {
      block: {
        id: 'links',
        type: 'Paragraph',
        text: 'links',
        attributes: {},
        annotations: links.map((link) => ({type: 'Link', link, starts: [0], ends: [1]})),
      },
      children: [],
    },
  ]

  it('merges citation, child, and outgoing relationships under one canonical document', () => {
    const id = hmId('alice', {path: ['source']})
    const nodes = buildConnectionsGraph(
      target,
      groupDocumentConnections(target, [link()]),
      [{id: hmId('alice', {path: ['source'], version: 'child-version'}), metadata: {name: 'Source'}}],
      contentWithLinks(['hm://alice/source?v=old#one', 'hm://alice/source?v=new#two', 'hm://alice/source/:directory']),
    )
    expect(nodes).toEqual([{key: id.id, id, name: 'Source', citation: true, child: true, outgoing: true}])
  })

  it('excludes the target from every relationship', () => {
    expect(
      buildConnectionsGraph(
        target,
        [{id: target, sources: []}],
        [{id: target, metadata: {}}],
        contentWithLinks(['hm://target/document?v=old#block']),
      ),
    ).toEqual([])
  })

  it('extracts nested block links and excludes account, profile, and comment mentions', () => {
    const content = contentWithLinks([
      'hm://alice/:profile',
      'hm://alice/doc/:comments/bob-comment',
      'https://example.com',
    ])
    content[0]!.children = [
      {block: {id: 'embed', type: 'Embed', link: 'hm://alice/nested', attributes: {}}, children: []},
    ]
    const paragraph = content[0]!.block
    if (paragraph.type !== 'Paragraph') throw new Error('Expected paragraph fixture')
    paragraph.annotations!.push({
      type: 'Embed',
      link: 'hm://bob',
      starts: [0],
      ends: [1],
      attributes: {mentionKind: 'account'},
    })
    paragraph.annotations!.push({
      type: 'Embed',
      link: 'hm://carol',
      starts: [0],
      ends: [1],
      attributes: {mentionKind: 'document'},
    })
    expect(buildConnectionsGraph(target, [], [], content).map((node) => node.key)).toEqual([
      'hm://alice/nested',
      'hm://carol',
    ])
  })

  it('keeps drafts separate and sorts citations before stable keys', () => {
    const children = [
      {id: hmId('z', {path: ['child']}), metadata: {name: 'Z'}},
      {draftId: 'local', metadata: {name: 'Draft'}},
      {id: hmId('a', {path: ['child']}), metadata: {name: 'A'}},
    ]
    const groups = groupDocumentConnections(target, [
      link({source: 'hm://z/citation'}),
      link({source: 'hm://a/citation'}),
    ])
    const nodes = buildConnectionsGraph(target, groups, children, [])
    expect(nodes.map((node) => node.key)).toEqual([
      'hm://a/citation',
      'hm://z/citation',
      'draft:local',
      'hm://a/child',
      'hm://z/child',
    ])
    expect(nodes[2]).toEqual({
      key: 'draft:local',
      draftId: 'local',
      name: 'Draft',
      citation: false,
      child: true,
      outgoing: false,
    })
    expect(buildConnectionsGraph(target, groups.slice().reverse(), children.slice().reverse(), [])).toEqual(nodes)
  })

  it('merges a published child with pending draft edits into the published node', () => {
    const id = hmId('alice', {path: ['source']})
    const nodes = buildConnectionsGraph(
      target,
      groupDocumentConnections(target, [link()]),
      [{id, draftId: 'pending-edits', metadata: {name: 'Source'}}],
      contentWithLinks(['hm://alice/source?v=old#one']),
    )
    expect(nodes).toEqual([{key: id.id, id, name: 'Source', citation: true, child: true, outgoing: true}])
  })

  it('retains all 669 children without making them outgoing links', () => {
    const children = Array.from({length: 669}, (_, index) => ({
      id: hmId('alice', {path: ['child-' + index]}),
      metadata: {name: 'Child ' + index},
    }))
    const nodes = buildConnectionsGraph(target, [], children, [])
    expect(nodes).toHaveLength(669)
    expect(new Set(nodes.map((node) => node.key)).size).toBe(669)
    expect(nodes.every((node) => node.child && !node.citation && !node.outgoing)).toBe(true)
  })
})
