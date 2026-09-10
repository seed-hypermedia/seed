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
