import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {planDeletedDocumentCardEmbedCleanup, planDocumentCardRemoval} from './document-card-cleanup'

function doc(content: HMBlockNode[]): Pick<HMDocument, 'content'> {
  return {content}
}

function paragraph(id: string, children: HMBlockNode[] = [], annotations: unknown[] = []): HMBlockNode {
  return {
    block: {
      id,
      type: 'Paragraph',
      text: '',
      attributes: {},
      annotations,
    } as HMBlockNode['block'],
    children,
  }
}

function embedCard(id: string, link: string, children: HMBlockNode[] = []): HMBlockNode {
  return embed(id, link, 'Card', children)
}

function embed(id: string, link: string, view: string | undefined, children: HMBlockNode[] = []): HMBlockNode {
  return {
    block: {
      id,
      type: 'Embed',
      link,
      attributes: view ? {view} : {},
    } as HMBlockNode['block'],
    children,
  }
}

function plainChanges(changes: ReturnType<typeof planDeletedDocumentCardEmbedCleanup>['changes']) {
  return changes.map((change) => {
    if (change.op.case === 'moveBlock') {
      return {
        case: 'moveBlock',
        blockId: change.op.value.blockId,
        parent: change.op.value.parent,
        leftSibling: change.op.value.leftSibling,
      }
    }
    if (change.op.case === 'deleteBlock') {
      return {case: 'deleteBlock', blockId: change.op.value}
    }
    return {case: change.op.case}
  })
}

describe('planDeletedDocumentCardEmbedCleanup', () => {
  it('returns no changes for empty content', () => {
    const result = planDeletedDocumentCardEmbedCleanup(doc([]), 'hm://target/doc')

    expect(result).toEqual({changes: [], removedBlockIds: []})
  })

  it('removes content, card, and link embeds pointing at the deleted document', () => {
    const result = planDeletedDocumentCardEmbedCleanup(
      doc([
        embed('embed-content', 'hm://target/doc', 'Content'),
        embed('embed-default-content', 'hm://target/doc', undefined),
        embedCard('embed-card', 'hm://target/doc'),
        embed('embed-link', 'hm://target/doc#block-id', 'Link'),
        embed('embed-comments', 'hm://target/doc', 'Comments'),
      ]),
      'hm://target/doc',
    )

    expect(plainChanges(result.changes)).toEqual([
      {case: 'deleteBlock', blockId: 'embed-content'},
      {case: 'deleteBlock', blockId: 'embed-default-content'},
      {case: 'deleteBlock', blockId: 'embed-card'},
      {case: 'deleteBlock', blockId: 'embed-link'},
      {case: 'deleteBlock', blockId: 'embed-comments'},
    ])
    expect(result.removedBlockIds).toEqual([
      'embed-content',
      'embed-default-content',
      'embed-card',
      'embed-link',
      'embed-comments',
    ])
  })

  it('ignores inline embed annotations', () => {
    const result = planDeletedDocumentCardEmbedCleanup(
      doc([paragraph('para', [], [{type: 'Embed', link: 'hm://target/doc', starts: [0], ends: [1]}])]),
      'hm://target/doc',
    )

    expect(result.changes).toEqual([])
    expect(result.removedBlockIds).toEqual([])
  })

  it('removes nested matching card embeds', () => {
    const result = planDeletedDocumentCardEmbedCleanup(
      doc([paragraph('parent', [embedCard('nested-card', 'hm://target/doc')])]),
      'hm://target/doc',
    )

    expect(plainChanges(result.changes)).toEqual([{case: 'deleteBlock', blockId: 'nested-card'}])
    expect(result.removedBlockIds).toEqual(['nested-card'])
  })

  it('matches version-pinned and block-ref card links by document uid and path only', () => {
    const result = planDeletedDocumentCardEmbedCleanup(
      doc([embedCard('versioned-card', 'hm://target/doc?v=bafy-version#block-id')]),
      'hm://target/doc?l',
    )

    expect(plainChanges(result.changes)).toEqual([{case: 'deleteBlock', blockId: 'versioned-card'}])
    expect(result.removedBlockIds).toEqual(['versioned-card'])
  })

  it('lifts children from multiple adjacent cards in final sibling order', () => {
    const result = planDeletedDocumentCardEmbedCleanup(
      doc([
        embedCard('card-a', 'hm://target/doc', [paragraph('a-child')]),
        embedCard('card-b', 'hm://target/doc', [paragraph('b-child'), paragraph('c-child')]),
        paragraph('tail'),
      ]),
      'hm://target/doc',
    )

    expect(plainChanges(result.changes)).toEqual([
      {case: 'moveBlock', blockId: 'a-child', parent: '', leftSibling: ''},
      {case: 'moveBlock', blockId: 'b-child', parent: '', leftSibling: 'a-child'},
      {case: 'moveBlock', blockId: 'c-child', parent: '', leftSibling: 'b-child'},
      {case: 'deleteBlock', blockId: 'card-a'},
      {case: 'deleteBlock', blockId: 'card-b'},
    ])
    expect(result.removedBlockIds).toEqual(['card-a', 'card-b'])
    const moveLeftSiblings = plainChanges(result.changes)
      .filter((change) => change.case === 'moveBlock')
      .map((change) => ('leftSibling' in change ? change.leftSibling : ''))
    expect(moveLeftSiblings).not.toContain('card-a')
    expect(moveLeftSiblings).not.toContain('card-b')
  })

  it('moves only direct card children and preserves grandchildren under the moved child', () => {
    const result = planDeletedDocumentCardEmbedCleanup(
      doc([
        paragraph('before'),
        embedCard('card', 'hm://target/doc', [paragraph('child', [paragraph('grandchild')])]),
        paragraph('after'),
      ]),
      'hm://target/doc',
    )

    expect(plainChanges(result.changes)).toEqual([
      {case: 'moveBlock', blockId: 'child', parent: '', leftSibling: 'before'},
      {case: 'deleteBlock', blockId: 'card'},
    ])
    expect(result.removedBlockIds).toEqual(['card'])
  })

  it('does not keep a matching card that was a child of another matching card', () => {
    const result = planDeletedDocumentCardEmbedCleanup(
      doc([
        embedCard('outer-card', 'hm://target/doc', [
          embedCard('inner-card', 'hm://target/doc', [paragraph('leaf')]),
          paragraph('outer-child'),
        ]),
        paragraph('after'),
      ]),
      'hm://target/doc',
    )

    expect(plainChanges(result.changes)).toEqual([
      {case: 'moveBlock', blockId: 'leaf', parent: '', leftSibling: ''},
      {case: 'moveBlock', blockId: 'outer-child', parent: '', leftSibling: 'leaf'},
      {case: 'deleteBlock', blockId: 'outer-card'},
      {case: 'deleteBlock', blockId: 'inner-card'},
    ])
    expect(result.removedBlockIds).toEqual(['outer-card', 'inner-card'])
  })

  it('uses an empty left sibling when a root-level card has no previous final sibling', () => {
    const result = planDeletedDocumentCardEmbedCleanup(
      doc([embedCard('card', 'hm://target/doc', [paragraph('child')]), paragraph('after')]),
      'hm://target/doc',
    )

    expect(plainChanges(result.changes)).toEqual([
      {case: 'moveBlock', blockId: 'child', parent: '', leftSibling: ''},
      {case: 'deleteBlock', blockId: 'card'},
    ])
    expect(result.removedBlockIds).toEqual(['card'])
  })

  it('can remove only the clicked card embed when a target block id is provided', () => {
    const result = planDocumentCardRemoval(
      doc([
        embedCard('clicked-card', 'hm://target/doc', [paragraph('clicked-child')]),
        embedCard('other-card', 'hm://target/doc'),
        paragraph('after'),
      ]),
      'hm://target/doc',
      {targetBlockId: 'clicked-card'},
    )

    expect(plainChanges(result.changes)).toEqual([
      {case: 'moveBlock', blockId: 'clicked-child', parent: '', leftSibling: ''},
      {case: 'deleteBlock', blockId: 'clicked-card'},
    ])
    expect(result.removedBlockIds).toEqual(['clicked-card'])
  })
})
