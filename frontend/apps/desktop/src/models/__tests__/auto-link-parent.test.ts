import {HMBlockNode, HMDocument, UnpackedHypermediaId, hmId} from '@shm/shared'
import {describe, expect, it} from 'vitest'
import {
  documentContainsLinkToChild,
  documentHasSelfQuery,
} from '../auto-link-utils'

// Helper to create a minimal HMDocument for testing
function createDocument(content: HMBlockNode[]): HMDocument {
  return {
    id: 'test-doc-id',
    account: 'test-account',
    path: ['test', 'path'],
    version: 'v1',
    authors: [],
    content,
    metadata: {},
    visibility: 'PUBLIC',
    createTime: new Date(),
    updateTime: new Date(),
    genesis: 'genesis-id',
  } as unknown as HMDocument
}

describe('documentContainsLinkToChild', () => {
  const childId: UnpackedHypermediaId = hmId('child-uid', {
    path: ['parent', 'child'],
  })

  it('returns false for empty document', () => {
    const doc = createDocument([])
    expect(documentContainsLinkToChild(doc, childId)).toBe(false)
  })

  it('returns false for document with no embeds', () => {
    const doc = createDocument([
      {
        block: {
          id: 'p1',
          type: 'Paragraph',
          text: 'Hello world',
          attributes: {},
        },
      },
    ] as HMBlockNode[])
    expect(documentContainsLinkToChild(doc, childId)).toBe(false)
  })

  it('returns true when embed block links to child', () => {
    const doc = createDocument([
      {
        block: {
          id: 'e1',
          type: 'Embed',
          link: 'hm://child-uid/parent/child',
          attributes: {view: 'Card'},
        },
      },
    ] as HMBlockNode[])
    expect(documentContainsLinkToChild(doc, childId)).toBe(true)
  })

  it('returns true when embed block links to child with version', () => {
    const doc = createDocument([
      {
        block: {
          id: 'e1',
          type: 'Embed',
          link: 'hm://child-uid/parent/child?v=abc123',
          attributes: {view: 'Card'},
        },
      },
    ] as HMBlockNode[])
    expect(documentContainsLinkToChild(doc, childId)).toBe(true)
  })

  it('returns false when embed block links to different document', () => {
    const doc = createDocument([
      {
        block: {
          id: 'e1',
          type: 'Embed',
          link: 'hm://other-uid/some/path',
          attributes: {view: 'Card'},
        },
      },
    ] as HMBlockNode[])
    expect(documentContainsLinkToChild(doc, childId)).toBe(false)
  })

  it('returns true when inline link annotation links to child', () => {
    const doc = createDocument([
      {
        block: {
          id: 'p1',
          type: 'Paragraph',
          text: 'Check out this doc',
          attributes: {},
          annotations: [
            {
              type: 'Link',
              link: 'hm://child-uid/parent/child',
              starts: [0],
              ends: [5],
            },
          ],
        },
      },
    ] as HMBlockNode[])
    expect(documentContainsLinkToChild(doc, childId)).toBe(true)
  })

  it('returns true when inline embed annotation links to child', () => {
    const doc = createDocument([
      {
        block: {
          id: 'p1',
          type: 'Paragraph',
          text: 'Check out this doc',
          attributes: {},
          annotations: [
            {
              type: 'Embed',
              link: 'hm://child-uid/parent/child',
              starts: [0],
              ends: [5],
            },
          ],
        },
      },
    ] as HMBlockNode[])
    expect(documentContainsLinkToChild(doc, childId)).toBe(true)
  })

  it('returns true when link is in nested children', () => {
    const doc = createDocument([
      {
        block: {id: 'g1', type: 'Group'},
        children: [
          {
            block: {
              id: 'e1',
              type: 'Embed',
              link: 'hm://child-uid/parent/child',
              attributes: {view: 'Card'},
            },
          },
        ],
      },
    ] as HMBlockNode[])
    expect(documentContainsLinkToChild(doc, childId)).toBe(true)
  })

  it('returns false when similar but different path', () => {
    const doc = createDocument([
      {
        block: {
          id: 'e1',
          type: 'Embed',
          link: 'hm://child-uid/parent/other-child',
          attributes: {view: 'Card'},
        },
      },
    ] as HMBlockNode[])
    expect(documentContainsLinkToChild(doc, childId)).toBe(false)
  })

  it('returns false when same path but different uid', () => {
    const doc = createDocument([
      {
        block: {
          id: 'e1',
          type: 'Embed',
          link: 'hm://other-uid/parent/child',
          attributes: {view: 'Card'},
        },
      },
    ] as HMBlockNode[])
    expect(documentContainsLinkToChild(doc, childId)).toBe(false)
  })
})

describe('documentHasSelfQuery', () => {
  const documentId: UnpackedHypermediaId = hmId('doc-uid', {
    path: ['my', 'document'],
  })

  it('returns false for empty document', () => {
    const doc = createDocument([])
    expect(documentHasSelfQuery(doc, documentId)).toBe(false)
  })

  it('returns false for document with no query blocks', () => {
    const doc = createDocument([
      {
        block: {
          id: 'p1',
          type: 'Paragraph',
          text: 'Hello world',
          attributes: {},
        },
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(false)
  })

  it('returns true when query includes self (empty space)', () => {
    const doc = createDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {
            style: 'Card',
            banner: false,
            columnCount: 1,
            query: {
              includes: [{space: '', path: '', mode: 'Children'}],
            },
          },
        },
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(true)
  })

  it('returns true when query includes self (matching space and empty path)', () => {
    const doc = createDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {
            style: 'Card',
            banner: false,
            columnCount: 1,
            query: {
              includes: [{space: 'doc-uid', path: '', mode: 'Children'}],
            },
          },
        },
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(true)
  })

  it('returns true when query includes self (matching space and path)', () => {
    // Note: hmIdPathToEntityQueryPath returns paths with leading slash
    const doc = createDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {
            style: 'Card',
            banner: false,
            columnCount: 1,
            query: {
              includes: [{space: 'doc-uid', path: '/my/document', mode: 'Children'}],
            },
          },
        },
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(true)
  })

  it('returns false when query is for different space', () => {
    const doc = createDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {
            style: 'Card',
            banner: false,
            columnCount: 1,
            query: {
              includes: [{space: 'other-uid', path: 'some/path', mode: 'Children'}],
            },
          },
        },
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(false)
  })

  it('returns false when query is for different path in same space', () => {
    const doc = createDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {
            style: 'Card',
            banner: false,
            columnCount: 1,
            query: {
              includes: [{space: 'doc-uid', path: 'other/path', mode: 'Children'}],
            },
          },
        },
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(false)
  })

  it('returns true when one of multiple includes matches self', () => {
    const doc = createDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {
            style: 'Card',
            banner: false,
            columnCount: 1,
            query: {
              includes: [
                {space: 'other-uid', path: 'some/path', mode: 'Children'},
                {space: 'doc-uid', path: '', mode: 'Children'},
              ],
            },
          },
        },
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(true)
  })

  it('returns true when query is in nested children', () => {
    const doc = createDocument([
      {
        block: {id: 'g1', type: 'Group'},
        children: [
          {
            block: {
              id: 'q1',
              type: 'Query',
              attributes: {
                style: 'Card',
                banner: false,
                columnCount: 1,
                query: {
                  includes: [{space: '', path: '', mode: 'Children'}],
                },
              },
            },
          },
        ],
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(true)
  })

  it('returns false when query has no includes', () => {
    const doc = createDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {
            style: 'Card',
            banner: false,
            columnCount: 1,
            query: {
              includes: [],
            },
          },
        },
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(false)
  })

  it('returns false when query attributes are missing', () => {
    const doc = createDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {},
        },
      },
    ] as HMBlockNode[])
    expect(documentHasSelfQuery(doc, documentId)).toBe(false)
  })
})
