import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {
  verifyDocumentCleanupPrimary,
  appendDraftCardToEditorBlocks,
  applyDocumentCardCleanupToBlockNodes,
  planDocumentCardMoveOperations,
  getDirectChildrenLosingReferences,
  planDeletedDocumentCardEmbedCleanup,
  planDocumentCardAppend,
  planDocumentCardRemoval,
  planDocumentCardRewrite,
  rebaseDocumentReferenceDraft,
  removeDraftCardFromEditorBlocks,
} from './document-card-cleanup'

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

  it('removes only Card embeds pointing at the deleted document', () => {
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

    expect(plainChanges(result.changes)).toEqual([{case: 'deleteBlock', blockId: 'embed-card'}])
    expect(result.removedBlockIds).toEqual(['embed-card'])
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

describe('rebaseDocumentReferenceDraft', () => {
  it('reapplies unpublished draft blocks over the newly published card version', () => {
    const base = [paragraph('published')]
    const mine = [paragraph('published'), paragraph('mine')]
    const theirs = [paragraph('published'), embedCard('stable-card', 'hm://parent/site/child')]

    const result = rebaseDocumentReferenceDraft({base, mine, published: theirs, mineTouchedIds: ['mine']})

    expect(result.conflictedBlockIds).toEqual([])
    expect(result.content.map((node) => node.block.id)).toEqual(['published', 'stable-card', 'mine'])
  })
})

describe('planDocumentCardAppend', () => {
  it('appends a card embed to a parent without self query or existing child card', () => {
    const result = planDocumentCardAppend(
      doc([paragraph('intro')]),
      'hm://parent/site',
      'hm://parent/site/child',
      'new-card',
    )

    expect(plainChanges(result.changes)).toEqual([
      {case: 'moveBlock', blockId: 'new-card', parent: '', leftSibling: 'intro'},
      {case: 'replaceBlock'},
    ])
    expect(result.addedBlockIds).toEqual(['new-card'])
  })

  it('does not append when the parent has a self query block', () => {
    const result = planDocumentCardAppend(
      doc([
        {
          block: {
            id: 'query',
            type: 'Query',
            attributes: {
              query: {includes: [{space: 'parent', path: '/site', mode: 'Children'}]},
            },
          } as HMBlockNode['block'],
          children: [],
        },
      ]),
      'hm://parent/site',
      'hm://parent/site/child',
      'new-card',
    )

    expect(result.changes).toEqual([])
    expect(result.addedBlockIds).toEqual([])
  })

  it('does not append when the parent already links to the child', () => {
    const result = planDocumentCardAppend(
      doc([embedCard('existing', 'hm://parent/site/child?v=bafy')]),
      'hm://parent/site',
      'hm://parent/site/child',
      'new-card',
    )

    expect(result.changes).toEqual([])
    expect(result.addedBlockIds).toEqual([])
  })

  it('does not append when nested text has an ordinary versioned link to the child', () => {
    const result = planDocumentCardAppend(
      doc([
        paragraph('outer', [
          paragraph(
            'linked',
            [],
            [{type: 'Link', link: 'hm://parent/site/child?v=bafy#paragraph', starts: [0], ends: [5]}],
          ),
        ]),
      ]),
      'hm://parent/site',
      'hm://parent/site/child',
      'new-card',
    )

    expect(result.changes).toEqual([])
    expect(result.addedBlockIds).toEqual([])
  })
})

describe('planDocumentCardRewrite', () => {
  it('rewrites matching embed links in place while preserving position and children', () => {
    const result = planDocumentCardRewrite(
      doc([paragraph('intro'), embedCard('card', 'hm://parent/site/old', [paragraph('child')]), paragraph('tail')]),
      'hm://parent/site/old',
      'hm://parent/site/new',
    )

    expect(plainChanges(result.changes)).toEqual([{case: 'replaceBlock'}])
    expect(result.rewrittenBlockIds).toEqual(['card'])
    const replace = result.changes[0]
    expect(replace?.op.case).toBe('replaceBlock')
    if (replace?.op.case === 'replaceBlock') {
      expect(replace.op.value.id).toBe('card')
      expect(replace.op.value.link).toBe('hm://parent/site/new')
    }
  })

  it('rewrites stale references even when the target link already exists', () => {
    const result = planDocumentCardRewrite(
      doc([embedCard('old-card', 'hm://parent/site/old'), embedCard('new-card', 'hm://parent/site/new')]),
      'hm://parent/site/old',
      'hm://parent/site/new',
    )

    expect(plainChanges(result.changes)).toEqual([{case: 'replaceBlock'}])
    expect(result.rewrittenBlockIds).toEqual(['old-card'])
  })
})

describe('applyDocumentCardCleanupToBlockNodes', () => {
  it('removes matching cards from draft block nodes and preserves other embeds and children', () => {
    const result = applyDocumentCardCleanupToBlockNodes(
      [
        paragraph('before'),
        embedCard('card', 'hm://target/doc', [paragraph('child')]),
        embed('comments', 'hm://target/doc', 'Comments'),
        paragraph('after'),
      ],
      {
        operation: 'remove',
        sourceDocumentId: 'hm://target/doc',
      },
    )

    expect(result.changedBlockIds).toEqual(['card'])
    expect(result.content.map((node) => node.block.id)).toEqual(['before', 'child', 'comments', 'after'])
  })

  it('appends a missing child card to draft block nodes', () => {
    const result = applyDocumentCardCleanupToBlockNodes([paragraph('intro')], {
      operation: 'add',
      parentDocumentId: 'hm://parent/site',
      targetDocumentId: 'hm://parent/site/child',
      newBlockId: 'new-card',
    })

    expect(result.changedBlockIds).toEqual(['new-card'])
    expect(result.content.map((node) => node.block.id)).toEqual(['intro', 'new-card'])
    expect(result.content.at(-1)?.block.id).toBe('new-card')
    expect(result.content.at(-1)?.block.type).toBe('Embed')
    expect((result.content.at(-1)?.block as any).link).toBe('hm://parent/site/child')
    expect((result.content.at(-1)?.block as any).attributes).toEqual({view: 'Card'})
  })

  it('rewrites matching draft embed links without duplicating an existing target', () => {
    const result = applyDocumentCardCleanupToBlockNodes(
      [paragraph('intro'), embedCard('card', 'hm://parent/site/old'), paragraph('tail')],
      {
        operation: 'rewrite',
        sourceDocumentId: 'hm://parent/site/old',
        targetDocumentId: 'hm://parent/site/new',
      },
    )

    expect(result.changedBlockIds).toEqual(['card'])
    expect((result.content[1]?.block as any).link).toBe('hm://parent/site/new')
    expect(result.content.map((node) => node.block.id)).toEqual(['intro', 'card', 'tail'])
  })
})

describe('document reference maintenance', () => {
  const source = 'hm://parent/site/old'
  const target = 'hm://parent/site/new'
  const references: [string, HMBlockNode][] = [
    ['card', embedCard('reference', source)],
    ['content embed', embed('reference', source, 'Content')],
    ['default embed', embed('reference', source, undefined)],
    ['link embed', embed('reference', source, 'Link')],
    ['comments embed', embed('reference', source, 'Comments')],
    ['link block', {block: {id: 'reference', type: 'Link', link: source, text: 'Child'}, children: []}],
    [
      'button block',
      {block: {id: 'reference', type: 'Button', link: source, text: 'Child', attributes: {}}, children: []},
    ],
    ...(['Link', 'Embed'] as const).map((type): [string, HMBlockNode] => {
      const node = paragraph(
        'reference',
        [],
        [
          {type, link: source, starts: [4], ends: [9]},
          {type: 'Link', link: 'https://example.com', starts: [14], ends: [18]},
          {type: 'Bold', starts: [4], ends: [9]},
        ],
      )
      node.block = {...node.block, text: 'See Child and more'} as HMBlockNode['block']
      return [`${type} annotation`, node]
    }),
  ]

  it.each(references)('does not append when a nested %s already references the child', (_, reference) => {
    const content = [paragraph('container', [reference])]
    expect(planDocumentCardAppend(doc(content), 'hm://parent/site', source, 'new-card')).toEqual({
      changes: [],
      addedBlockIds: [],
    })
    expect(
      applyDocumentCardCleanupToBlockNodes(content, {
        operation: 'add',
        parentDocumentId: 'hm://parent/site',
        targetDocumentId: source,
        newBlockId: 'new-card',
      }),
    ).toEqual({content, changedBlockIds: []})
  })

  it.each(references.filter(([name]) => name !== 'card'))(
    'preserves a %s and its text when deleting the referenced document',
    (_, reference) => {
      const content = [paragraph('container', [reference])]
      expect(planDocumentCardRemoval(doc(content), source)).toEqual({changes: [], removedBlockIds: []})
      expect(applyDocumentCardCleanupToBlockNodes(content, {operation: 'remove', sourceDocumentId: source})).toEqual({
        content,
        changedBlockIds: [],
      })
    },
  )

  it.each(references)('rewrites a nested %s without removing its text or other annotations', (_, reference) => {
    reference = {...reference, block: {...reference.block, revision: 'old-revision'} as HMBlockNode['block']}
    const content = [paragraph('container', [reference]), embedCard('existing-target', target)]
    const original = JSON.parse(JSON.stringify(content))
    const block = reference.block
    const expected =
      'link' in block
        ? {...block, revision: undefined, link: target}
        : {
            ...block,
            revision: undefined,
            annotations: ('annotations' in block ? block.annotations || [] : []).map((annotation) =>
              'link' in annotation && annotation.link === source ? {...annotation, link: target} : annotation,
            ),
          }
    const plan = planDocumentCardRewrite(doc(content), source, target)
    expect(plan.rewrittenBlockIds).toEqual(['reference'])
    expect(plan.changes).toHaveLength(1)
    const change = plan.changes[0]
    expect(change?.op.case).toBe('replaceBlock')
    if (change?.op.case === 'replaceBlock') {
      const {revision, ...expectedJson} = expected
      expect(change.op.value.toJson()).toMatchObject(expectedJson)
      expect(change.op.value.revision).toBe('')
    }
    const draft = applyDocumentCardCleanupToBlockNodes(content, {
      operation: 'rewrite',
      sourceDocumentId: source,
      targetDocumentId: target,
    })
    expect(draft.changedBlockIds).toEqual(['reference'])
    expect(draft.content).toEqual([
      paragraph('container', [{...reference, block: expected as HMBlockNode['block']}]),
      content[1],
    ])
    expect(content).toEqual(original)
  })

  it.each(['Children', 'AllDescendants'] as const)(
    'does not append for a nested self-query with %s mode and a limit',
    (mode) => {
      const query = {
        block: {
          id: 'query',
          type: 'Query',
          attributes: {
            columnCount: 3,
            style: 'Card',
            banner: false,
            query: {
              includes: [{space: 'parent', path: '/site', mode}],
              limit: 1,
              sort: [{term: 'title', reverse: true}],
            },
          },
        },
        children: [],
      } as HMBlockNode
      const content = [paragraph('container', [query])]
      expect(planDocumentCardAppend(doc(content), 'hm://parent/site', source, 'new-card').addedBlockIds).toEqual([])
      expect(
        applyDocumentCardCleanupToBlockNodes(content, {
          operation: 'add',
          parentDocumentId: 'hm://parent/site',
          targetDocumentId: source,
          newBlockId: 'new-card',
        }),
      ).toEqual({content, changedBlockIds: []})
    },
  )
})

describe('planDocumentCardMoveOperations', () => {
  it('plans a rewrite when a document stays under the same parent', () => {
    const result = planDocumentCardMoveOperations(
      {uid: 'site', path: ['parent', 'old'], id: 'hm://site/parent/old'} as any,
      {uid: 'site', path: ['parent', 'new'], id: 'hm://site/parent/new'} as any,
    )

    expect(result).toEqual([
      {
        operation: 'rewrite',
        parentDocumentId: 'hm://site/parent',
        sourceDocumentId: 'hm://site/parent/old',
        targetDocumentId: 'hm://site/parent/new',
      },
    ])
  })

  it('plans remove and add operations when a document moves to a different parent', () => {
    const result = planDocumentCardMoveOperations(
      {uid: 'site', path: ['old-parent', 'doc'], id: 'hm://site/old-parent/doc'} as any,
      {uid: 'site', path: ['new-parent', 'doc'], id: 'hm://site/new-parent/doc'} as any,
    )

    expect(result).toEqual([
      {
        operation: 'remove',
        parentDocumentId: 'hm://site/old-parent',
        sourceDocumentId: 'hm://site/old-parent/doc',
      },
      {
        operation: 'add',
        parentDocumentId: 'hm://site/new-parent',
        targetDocumentId: 'hm://site/new-parent/doc',
      },
    ])
  })
})

describe('draft-card editor block helpers', () => {
  it('removes only the matching draft card and preserves its children', () => {
    const result = removeDraftCardFromEditorBlocks(
      [
        {
          id: 'target-card',
          type: 'embed',
          props: {draftId: 'draft-1', view: 'Card'},
          children: [{id: 'child', type: 'paragraph', children: []}],
        },
        {id: 'other-card', type: 'embed', props: {draftId: 'draft-1', view: 'Card'}, children: []},
      ],
      'draft-1',
      'target-card',
    )

    expect(result.removedBlockIds).toEqual(['target-card'])
    expect(result.content).toEqual([
      {id: 'child', type: 'paragraph', children: []},
      {id: 'other-card', type: 'embed', props: {draftId: 'draft-1', view: 'Card'}, children: []},
    ])
  })

  it('appends a draft card unless the draft is already linked', () => {
    const initial = [{id: 'paragraph', type: 'paragraph', children: []}]

    expect(appendDraftCardToEditorBlocks(initial, 'draft-1', 'new-card')).toEqual({
      content: [
        {id: 'paragraph', type: 'paragraph', children: []},
        {
          id: 'new-card',
          type: 'embed',
          props: {url: '', draftId: 'draft-1', view: 'Card', defaultOpen: 'false'},
          content: [],
          children: [],
        },
      ],
      addedBlockIds: ['new-card'],
    })
    expect(
      appendDraftCardToEditorBlocks(
        [{id: 'existing-card', type: 'embed', props: {draftId: 'draft-1'}, children: []}],
        'draft-1',
        'new-card',
      ).addedBlockIds,
    ).toEqual([])
  })
})

describe('getDirectChildrenLosingReferences', () => {
  const parent = unpackHmId('hm://parent/site')!
  it('returns only direct children whose final direct reference was removed', () => {
    const before = [
      embedCard('one', 'hm://parent/site/child?v=old#block'),
      paragraph('two', [], [{type: 'Link', link: 'hm://parent/site/child', starts: [0], ends: [1]}]),
      embedCard('other-account', 'hm://other/site/child'),
      embedCard('grandchild', 'hm://parent/site/child/deeper'),
      embedCard('self', 'hm://parent/site'),
      embedCard('sibling', 'hm://parent/elsewhere'),
    ]
    expect(getDirectChildrenLosingReferences(parent, before, [before[1]!])).toEqual([])
    expect(getDirectChildrenLosingReferences(parent, before, []).map((id) => id.id)).toEqual(['hm://parent/site/child'])
    expect(getDirectChildrenLosingReferences(parent, [], [])).toEqual([])
  })
  it('counts nested inline embeds and block links but never query results', () => {
    const before = [
      paragraph('container', [
        paragraph('inline', [], [{type: 'Embed', link: 'hm://parent/site/child', starts: [0], ends: [1]}]),
        {
          block: {id: 'button', type: 'Button', link: 'hm://parent/site/button', text: '', attributes: {}},
          children: [],
        },
        {
          block: {
            id: 'query',
            type: 'Query',
            attributes: {
              columnCount: 3,
              style: 'Card',
              banner: false,
              query: {includes: [{space: 'parent', path: '/site', mode: 'Children'}]},
            },
          },
          children: [],
        } as HMBlockNode,
      ]),
    ]
    expect(getDirectChildrenLosingReferences(parent, before, []).map((id) => id.id)).toEqual([
      'hm://parent/site/child',
      'hm://parent/site/button',
    ])
  })
})

describe('revision preservation', () => {
  it('keeps unchanged block revisions while clearing rewritten block revisions', () => {
    const untouched = paragraph('untouched')
    ;(untouched.block as {revision?: string}).revision = 'unchanged'
    const rewritten = embedCard('rewritten', 'hm://parent/site/old')
    ;(rewritten.block as {revision?: string}).revision = 'stale'
    const result = applyDocumentCardCleanupToBlockNodes([untouched, rewritten], {
      operation: 'rewrite',
      sourceDocumentId: 'hm://parent/site/old',
      targetDocumentId: 'hm://parent/site/new',
    })
    expect((result.content[0]?.block as {revision?: string}).revision).toBe('unchanged')
    expect((result.content[1]?.block as {revision?: string}).revision).toBeUndefined()
  })
})

describe('primary-operation recovery proof', () => {
  it('does not follow a captured move destination that has moved again', async () => {
    const client = {
      request: async (_key: string, id: {id: string}) => ({
        type: 'redirect',
        redirectTarget: unpackHmId(id.id === 'hm://alice/a' ? 'hm://alice/b' : 'hm://alice/c'),
      }),
    } as any
    await expect(
      verifyDocumentCleanupPrimary(client, {
        documentId: 'hm://alice/a',
        expectedType: 'redirect',
        targetDocumentId: 'hm://alice/b',
        expectedGenesis: 'same-genesis',
      }),
    ).rejects.toThrow('captured destination moved')
  })

  it('never accepts document existence alone as proof of a completed publication', async () => {
    const client = {request: async () => ({type: 'document', document: {version: 'unrelated', genesis: 'g'}})} as any
    await expect(
      verifyDocumentCleanupPrimary(client, {documentId: 'hm://alice/child', expectedType: 'document'}),
    ).rejects.toThrow('identity is unavailable')
  })
  it('accepts the exact signed publication version and rejects a changed version', async () => {
    const client = {request: async () => ({type: 'document', document: {version: 'v2', genesis: 'g'}})} as any
    await expect(
      verifyDocumentCleanupPrimary(client, {
        documentId: 'hm://alice/child',
        expectedType: 'document',
        expectedVersion: 'v2',
      }),
    ).resolves.toBeUndefined()
    await expect(
      verifyDocumentCleanupPrimary(client, {
        documentId: 'hm://alice/child',
        expectedType: 'document',
        expectedVersion: 'v1',
      }),
    ).rejects.toThrow('version changed')
  })
  it('never treats a missing resource or a redirect as a completed deletion', async () => {
    for (const type of ['not-found', 'redirect']) {
      await expect(
        verifyDocumentCleanupPrimary({request: async () => ({type})} as any, {
          documentId: 'hm://alice/child',
          expectedType: 'tombstone',
        }),
      ).rejects.toThrow('outcome not confirmed')
    }
  })
})
