import {describe, expect, it} from 'vitest'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {rebaseDocumentReferenceDraft, findPublishedCardPosition} from './document-reference-rebase'

const card = (link: string): HMBlockNode => ({
  block: {id: 'card', type: 'Embed', link, attributes: {view: 'Card'}, revision: 'old'} as any,
})
const paragraph = (text: string): HMBlockNode => ({block: {id: 'text', type: 'Paragraph', text} as any})
const job = {operation: 'rewrite' as const, sourceDocumentId: 'hm://alice/old', targetDocumentId: 'hm://alice/new'}

describe('reference-maintenance draft reconciliation', () => {
  it('keeps a local card deletion while moving discard baseline to the renamed published card', () => {
    const published = [card(job.targetDocumentId)]
    expect(rebaseDocumentReferenceDraft(job, [card(job.sourceDocumentId)], [], published).content).toEqual([])
    expect((published[0]?.block as any)?.link).toBe(job.targetDocumentId)
  })
  it('preserves unrelated local edits while applying the renamed path', () => {
    const result = rebaseDocumentReferenceDraft(
      job,
      [card(job.sourceDocumentId), paragraph('before')],
      [card(job.sourceDocumentId), paragraph('local')],
      [card(job.targetDocumentId), paragraph('before')],
    )
    expect(result.content.map((node) => (node.block as any)?.link || (node.block as any)?.text)).toEqual([
      job.targetDocumentId,
      'local',
    ])
    expect(result.mineTouchedIds).toEqual(['text'])
  })
  it('refuses unrelated concurrent edits instead of overwriting the draft', () => {
    expect(() =>
      rebaseDocumentReferenceDraft(
        job,
        [card(job.sourceDocumentId), paragraph('before')],
        [card(job.sourceDocumentId), paragraph('local')],
        [card(job.targetDocumentId), paragraph('remote')],
      ),
    ).toThrow('conflicting remote edits')
  })
  it('adds a newly published card through the baseline without losing draft text', () => {
    const result = rebaseDocumentReferenceDraft(
      {operation: 'add'},
      [paragraph('before')],
      [paragraph('local')],
      [paragraph('before'), card('hm://alice/child')],
    )
    expect(result.content.map((node) => (node.block as any)?.link || (node.block as any)?.text)).toEqual([
      'local',
      'hm://alice/child',
    ])
  })
})

it('removes a maintenance-deleted card on both sides without inventing a conflict', () => {
  const result = rebaseDocumentReferenceDraft(
    {operation: 'remove', sourceDocumentId: 'hm://alice/child'},
    [card('hm://alice/child'), paragraph('old')],
    [card('hm://alice/child'), paragraph('local')],
    [paragraph('old')],
  )
  expect((result.content[0]?.block as any).text).toBe('local')
  expect(result.mineTouchedIds).toEqual(['text'])
})

it('leaves unselected cards alone when removing a card from an arbitrary container', () => {
  const selected = card('hm://alice/elsewhere')
  const other = {
    ...card('hm://alice/elsewhere'),
    block: {...card('hm://alice/elsewhere').block, id: 'other'},
  } as HMBlockNode
  const result = rebaseDocumentReferenceDraft(
    {operation: 'remove', sourceDocumentId: 'hm://alice/elsewhere', targetBlockId: 'card'},
    [selected, other],
    [selected, other],
    [other],
  )
  expect(result.content.map((node) => node.block.id)).toEqual(['other'])
})

it('keeps a resolved child placeholder inside its unpublished draft-only container', () => {
  const resolved = card('hm://alice/child')
  const container = {
    ...paragraph('container'),
    block: {...paragraph('container').block, id: 'container'},
    children: [resolved],
  } as HMBlockNode
  const result = rebaseDocumentReferenceDraft(
    {operation: 'add', childDraftId: 'child-draft', cardBlockId: 'card'},
    [],
    [container],
    [resolved],
  )
  expect(result.content.map((node) => node.block.id)).toEqual(['container'])
  expect(result.content[0]?.children?.map((node) => node.block.id)).toEqual(['card'])
})

it('anchors publication only to published ancestors and siblings', () => {
  const childCard = card('hm://alice/child')
  const draftOnlyContainer = {
    ...paragraph('draft-only'),
    block: {...paragraph('draft-only').block, id: 'container'},
    children: [childCard],
  } as HMBlockNode
  expect(findPublishedCardPosition([paragraph('published')], [paragraph('local'), draftOnlyContainer], 'card')).toEqual(
    {parent: '', leftSibling: 'text'},
  )
  expect(findPublishedCardPosition([], [draftOnlyContainer], 'card')).toEqual({parent: '', leftSibling: ''})
})

it('retains a live deletion of the temporary child card after the child is published', () => {
  const result = rebaseDocumentReferenceDraft(
    {operation: 'add', childDraftId: 'child-draft', cardBlockId: 'card', targetDocumentId: 'hm://alice/child'},
    [card('')],
    [],
    [card('hm://alice/child')],
  )
  expect(result.content).toEqual([])
})

const draftCard = (id: string, draftId: string): HMBlockNode => ({
  block: {id, type: 'Embed', link: '', attributes: {view: 'Card', draftId}} as any,
})
const paragraphWithId = (id: string, text: string): HMBlockNode => ({
  block: {id, type: 'Paragraph', text} as any,
})

describe('child draft publish conversion', () => {
  const job = {operation: 'add', childDraftId: 'child-draft', cardBlockId: 'card', targetDocumentId: 'hm://alice/child'}

  it('converts the draft card to a real card at its draft position and removes duplicates', () => {
    const mine = [
      paragraphWithId('before', 'intro'),
      draftCard('card', 'child-draft'),
      draftCard('dup', 'child-draft'),
      draftCard('other', 'other-draft'),
      paragraphWithId('after', 'outro'),
    ]
    const published = [paragraphWithId('before', 'intro'), {...card(job.targetDocumentId)}]
    const result = rebaseDocumentReferenceDraft(job, [paragraphWithId('before', 'intro')], mine, published)
    const ids = result.content.map((node) => node.block.id)
    expect(ids).toEqual(['before', 'card', 'other', 'after'])
    const converted = result.content.find((node) => node.block.id === 'card')!
    expect((converted.block as any).link).toBe(job.targetDocumentId)
    expect((converted.block as any).attributes?.draftId).toBeUndefined()
    const sibling = result.content.find((node) => node.block.id === 'other')!
    expect((sibling.block as any).attributes?.draftId).toBe('other-draft')
    expect(result.content.filter((node) => (node.block as any).link === job.targetDocumentId)).toHaveLength(1)
  })

  it('removes a leftover draft card when findTemporaryCard missed and cardBlockId is a random id', () => {
    const result = rebaseDocumentReferenceDraft(
      {
        operation: 'add',
        childDraftId: 'child-draft',
        cardBlockId: 'generated-id',
        targetDocumentId: 'hm://alice/child',
      },
      [paragraphWithId('pub', 'intro')],
      [paragraphWithId('pub', 'intro'), draftCard('stale-card', 'child-draft'), draftCard('other', 'other-draft')],
      [
        paragraphWithId('pub', 'intro'),
        {...card('hm://alice/child'), block: {...card('hm://alice/child').block, id: 'generated-id'}},
      ],
    )
    const ids = result.content.map((node) => node.block.id)
    // The stale draft card is gone and the published card is merged into the draft.
    expect(ids).toEqual(['pub', 'generated-id', 'other'])
    expect(result.content.some((node) => (node.block as any).attributes?.draftId === 'child-draft')).toBe(false)
    expect((result.content.find((node) => node.block.id === 'other')!.block as any).attributes?.draftId).toBe(
      'other-draft',
    )
  })

  it('lifts children of a duplicate draft card when removing it', () => {
    const dup: HMBlockNode = {
      block: {id: 'dup', type: 'Embed', link: '', attributes: {view: 'Card', draftId: 'child-draft'}} as any,
      children: [paragraphWithId('lifted', 'nested')],
    }
    const result = rebaseDocumentReferenceDraft(job, [], [draftCard('card', 'child-draft'), dup], [])
    expect(result.content.map((node) => node.block.id)).toEqual(['card', 'lifted'])
  })

  it('anchors a published card after the nearest published sibling', () => {
    expect(
      findPublishedCardPosition(
        [paragraphWithId('pub-1', 'one'), paragraphWithId('pub-2', 'two')],
        [paragraphWithId('pub-1', 'one'), draftCard('card', 'child-draft'), paragraphWithId('draft-only', 'new')],
        'card',
      ),
    ).toEqual({parent: '', leftSibling: 'pub-1'})
  })
})

describe('maintenance-only reconcile keeps the draft structure', () => {
  const addJob = {
    operation: 'add',
    childDraftId: 'child-draft',
    cardBlockId: 'generated-id',
    targetDocumentId: 'hm://alice/child',
  }
  const publishedCard = {
    ...card(addJob.targetDocumentId),
    block: {...card(addJob.targetDocumentId).block, id: 'generated-id'},
  } as HMBlockNode

  it('keeps a draft-only block where it was inserted', () => {
    const base = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b'), paragraphWithId('c', 'c')]
    const mine = [
      paragraphWithId('a', 'a'),
      paragraphWithId('X', 'local'),
      paragraphWithId('b', 'b'),
      paragraphWithId('c', 'c'),
    ]
    const published = [...base, publishedCard]
    const result = rebaseDocumentReferenceDraft(addJob, base, mine, published)
    expect(result.content.map((node) => node.block.id)).toEqual(['a', 'X', 'b', 'c', 'generated-id'])
  })

  it('keeps a local reorder and places the card after its published anchor', () => {
    const base = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b'), paragraphWithId('c', 'c')]
    const mine = [paragraphWithId('c', 'c'), paragraphWithId('a', 'a'), paragraphWithId('b', 'b')]
    const published = [...base, publishedCard]
    const result = rebaseDocumentReferenceDraft(addJob, base, mine, published)
    expect(result.content.map((node) => node.block.id)).toEqual(['c', 'generated-id', 'a', 'b'])
  })

  it('keeps local nesting', () => {
    const base = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b'), paragraphWithId('c', 'c')]
    const mine = [
      {...paragraphWithId('a', 'a'), children: [paragraphWithId('b', 'b')]} as HMBlockNode,
      paragraphWithId('c', 'c'),
    ]
    const published = [...base, publishedCard]
    const result = rebaseDocumentReferenceDraft(addJob, base, mine, published)
    expect(result.content.map((node) => node.block.id)).toEqual(['a', 'c', 'generated-id'])
    expect(result.content[0]?.children?.map((node) => node.block.id)).toEqual(['b'])
  })

  it('keeps a moved published card at its draft position', () => {
    const old = {
      ...card('hm://alice/old-child'),
      block: {...card('hm://alice/old-child').block, id: 'old'},
    } as HMBlockNode
    const base = [paragraphWithId('a', 'a'), old, paragraphWithId('b', 'b')]
    const mine = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b'), old]
    const published = [paragraphWithId('a', 'a'), old, paragraphWithId('b', 'b'), publishedCard]
    const result = rebaseDocumentReferenceDraft(addJob, base, mine, published)
    expect(result.content.map((node) => node.block.id)).toEqual(['a', 'b', 'generated-id', 'old'])
  })

  it('anchors the card after the nearest surviving published sibling when the anchor was deleted', () => {
    const base = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b')]
    const mine = [paragraphWithId('a', 'a'), paragraphWithId('local', 'local')]
    const published = [...base, publishedCard]
    const result = rebaseDocumentReferenceDraft(addJob, base, mine, published)
    expect(result.content.map((node) => node.block.id)).toEqual(['a', 'generated-id', 'local'])
  })

  it('does not duplicate a card the draft already references', () => {
    const base = [paragraphWithId('a', 'a')]
    const mine = [
      paragraphWithId('a', 'a'),
      {...card(addJob.targetDocumentId), block: {...card(addJob.targetDocumentId).block, id: 'manual'}} as HMBlockNode,
    ]
    const published = [...base, publishedCard]
    const result = rebaseDocumentReferenceDraft(addJob, base, mine, published)
    expect(result.content.filter((node) => (node.block as any).link === addJob.targetDocumentId)).toHaveLength(1)
    expect(result.content.map((node) => node.block.id)).not.toContain('generated-id')
  })

  it('converts a tracked draft card in place without moving draft edits', () => {
    const trackedJob = {...addJob, cardBlockId: 'card'}
    const base = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b')]
    const mine = [
      paragraphWithId('b', 'b'),
      paragraphWithId('a', 'a'),
      paragraphWithId('X', 'local'),
      draftCard('card', 'child-draft'),
    ]
    const published = [paragraphWithId('a', 'a'), card(addJob.targetDocumentId), paragraphWithId('b', 'b')]
    const result = rebaseDocumentReferenceDraft(trackedJob, base, mine, published)
    expect(result.content.map((node) => node.block.id)).toEqual(['b', 'a', 'X', 'card'])
    const converted = result.content.find((node) => node.block.id === 'card')!
    expect((converted.block as any).link).toBe(addJob.targetDocumentId)
    expect((converted.block as any).attributes?.draftId).toBeUndefined()
  })

  it('falls back to the full merge on a concurrent remote edit', () => {
    const base = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b')]
    const mine = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b'), paragraphWithId('X', 'local')]
    const published = [paragraphWithId('a', 'a remote'), paragraphWithId('b', 'b'), publishedCard]
    const result = rebaseDocumentReferenceDraft(addJob, base, mine, published)
    expect(result.content.map((node) => node.block.id)).toEqual(['a', 'b', 'generated-id', 'X'])
    expect((result.content[0]?.block as any).text).toBe('a remote')
  })

  it('does not mutate its inputs', () => {
    const base = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b'), paragraphWithId('c', 'c')]
    const mine = [
      paragraphWithId('a', 'a'),
      paragraphWithId('X', 'local'),
      paragraphWithId('b', 'b'),
      paragraphWithId('c', 'c'),
    ]
    const published = [...base, publishedCard]
    const snapshot = JSON.stringify({base, mine, published})
    rebaseDocumentReferenceDraft(addJob, base, mine, published)
    expect(JSON.stringify({base, mine, published})).toBe(snapshot)

    const trackedJob = {...addJob, cardBlockId: 'card'}
    const base2 = [paragraphWithId('a', 'a'), paragraphWithId('b', 'b')]
    const mine2 = [
      paragraphWithId('b', 'b'),
      paragraphWithId('a', 'a'),
      paragraphWithId('X', 'local'),
      draftCard('card', 'child-draft'),
    ]
    const published2 = [paragraphWithId('a', 'a'), card(addJob.targetDocumentId), paragraphWithId('b', 'b')]
    const snapshot2 = JSON.stringify({base: base2, mine: mine2, published: published2})
    rebaseDocumentReferenceDraft(trackedJob, base2, mine2, published2)
    expect(JSON.stringify({base: base2, mine: mine2, published: published2})).toBe(snapshot2)
  })
})
