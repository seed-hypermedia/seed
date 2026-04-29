import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {applyRebasePlan, classifyRebase, computeTheirsTouches} from './document-changes'

type BlockOverrides = {
  id: string
  text?: string
  revision?: string
  attributes?: Record<string, unknown>
}

function para({id, text = '', revision, attributes}: BlockOverrides): HMBlockNode['block'] {
  const block: any = {
    type: 'Paragraph',
    id,
    text,
    attributes: attributes ?? {},
  }
  if (revision) block.revision = revision
  return block
}

function node(over: BlockOverrides, children: HMBlockNode[] = []): HMBlockNode {
  return {block: para(over) as HMBlockNode['block'], children}
}

describe('computeTheirsTouches', () => {
  it('reports no touches when revisions are unchanged and no new CIDs match', () => {
    const base: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'two', revision: 'cidA'}),
    ]
    const theirs = base
    const touched = computeTheirsTouches(base, theirs, new Set(['cidZ']))
    expect(Array.from(touched)).toEqual([])
  })

  it('flags blocks whose revision is in newChangeCids', () => {
    const base: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'two', revision: 'cidA'}),
    ]
    const theirs: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'two changed', revision: 'cidB'}),
    ]
    const touched = computeTheirsTouches(base, theirs, new Set(['cidB']))
    expect(Array.from(touched).sort()).toEqual(['b2'])
  })

  it('detects structural adds by theirs', () => {
    const base: HMBlockNode[] = [node({id: 'b1', text: 'one', revision: 'cidA'})]
    const theirs: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'bNew', text: 'new', revision: 'cidB'}),
    ]
    const touched = computeTheirsTouches(base, theirs, new Set(['cidB']))
    expect(Array.from(touched).sort()).toEqual(['bNew'])
  })

  it('detects structural deletes by theirs', () => {
    const base: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'two', revision: 'cidA'}),
    ]
    const theirs: HMBlockNode[] = [node({id: 'b1', text: 'one', revision: 'cidA'})]
    const touched = computeTheirsTouches(base, theirs, new Set(['cidB']))
    expect(Array.from(touched).sort()).toEqual(['b2'])
  })

  it('falls back to deep-equals when revision is missing', () => {
    const base: HMBlockNode[] = [node({id: 'b1', text: 'one'}), node({id: 'b2', text: 'two'})]
    const theirs: HMBlockNode[] = [node({id: 'b1', text: 'one changed'}), node({id: 'b2', text: 'two'})]
    const touched = computeTheirsTouches(base, theirs, new Set())
    expect(Array.from(touched).sort()).toEqual(['b1'])
  })
})

describe('classifyRebase', () => {
  it('auto-merges when mine and theirs touch disjoint blocks', () => {
    const base: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'two', revision: 'cidA'}),
    ]
    const mine: HMBlockNode[] = [
      node({id: 'b1', text: 'one edited', revision: 'cidA'}),
      node({id: 'b2', text: 'two', revision: 'cidA'}),
    ]
    const theirs: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'two changed', revision: 'cidB'}),
    ]
    const result = classifyRebase(base, mine, theirs, ['b1'], new Set(['cidB']))
    expect(result.autoMergeable).toBe(true)
    expect(result.conflictedBlockIds).toEqual([])
    expect(Array.from(result.plan.mineBlocks).sort()).toEqual(['b1'])
    expect(Array.from(result.plan.theirsBlocks).sort()).toEqual(['b2'])
  })

  it('reports conflict on edit-vs-edit of the same block', () => {
    const base: HMBlockNode[] = [node({id: 'b1', text: 'same', revision: 'cidA'})]
    const mine: HMBlockNode[] = [node({id: 'b1', text: 'mine edit', revision: 'cidA'})]
    const theirs: HMBlockNode[] = [node({id: 'b1', text: 'their edit', revision: 'cidB'})]
    const result = classifyRebase(base, mine, theirs, ['b1'], new Set(['cidB']))
    expect(result.autoMergeable).toBe(false)
    expect(result.conflictedBlockIds).toEqual(['b1'])
  })

  it('reports conflict on mine-edit vs theirs-delete', () => {
    const base: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'two', revision: 'cidA'}),
    ]
    const mine: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'mine updated', revision: 'cidA'}),
    ]
    const theirs: HMBlockNode[] = [node({id: 'b1', text: 'one', revision: 'cidA'})]
    const result = classifyRebase(base, mine, theirs, ['b2'], new Set(['cidB']))
    expect(result.autoMergeable).toBe(false)
    expect(result.conflictedBlockIds).toEqual(['b2'])
  })

  it('reports conflict on mine-delete vs theirs-edit', () => {
    const base: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'two', revision: 'cidA'}),
    ]
    const mine: HMBlockNode[] = [node({id: 'b1', text: 'one', revision: 'cidA'})]
    const theirs: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'b2', text: 'two updated by them', revision: 'cidB'}),
    ]
    const result = classifyRebase(base, mine, theirs, [], new Set(['cidB']))
    expect(result.autoMergeable).toBe(false)
    expect(result.conflictedBlockIds).toEqual(['b2'])
  })

  it('auto-merges when mine adds and theirs adds different new blocks', () => {
    const base: HMBlockNode[] = [node({id: 'b1', text: 'one', revision: 'cidA'})]
    const mine: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'bMine', text: 'added by me', revision: 'cidA'}),
    ]
    const theirs: HMBlockNode[] = [
      node({id: 'bTheirs', text: 'added by them', revision: 'cidB'}),
      node({id: 'b1', text: 'one', revision: 'cidA'}),
    ]
    const result = classifyRebase(base, mine, theirs, [], new Set(['cidB']))
    expect(result.autoMergeable).toBe(true)
  })
})

describe('applyRebasePlan', () => {
  it('keeps theirs order and swaps mine content for plan.mineBlocks', () => {
    const mine: HMBlockNode[] = [
      node({id: 'b1', text: 'mine one', revision: 'cidA'}),
      node({id: 'b2', text: 'mine two', revision: 'cidA'}),
    ]
    const theirs: HMBlockNode[] = [
      node({id: 'b2', text: 'theirs two', revision: 'cidB'}),
      node({id: 'b1', text: 'theirs one', revision: 'cidB'}),
    ]
    const merged = applyRebasePlan(mine, theirs, {
      scaffold: 'theirs',
      mineBlocks: new Set(['b1']),
      theirsBlocks: new Set(['b2']),
      conflictedBlockIds: [],
    })
    expect(merged.map((n) => n.block?.id)).toEqual(['b2', 'b1'])
    const b1 = merged.find((n) => n.block?.id === 'b1')
    const b2 = merged.find((n) => n.block?.id === 'b2')
    expect((b1?.block as any)?.text).toBe('mine one')
    expect((b2?.block as any)?.text).toBe('theirs two')
  })

  it('appends mine-only blocks not present in theirs at the end of root', () => {
    const mine: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'bMine', text: 'added by me', revision: 'cidA'}),
    ]
    const theirs: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'bTheirs', text: 'added by them', revision: 'cidB'}),
    ]
    const merged = applyRebasePlan(mine, theirs, {
      scaffold: 'theirs',
      mineBlocks: new Set(),
      theirsBlocks: new Set(['bTheirs']),
      conflictedBlockIds: [],
    })
    expect(merged.map((n) => n.block?.id)).toEqual(['b1', 'bTheirs', 'bMine'])
  })

  it('honors explicit picks (Phase B)', () => {
    const mine: HMBlockNode[] = [node({id: 'b1', text: 'mine', revision: 'cidA'})]
    const theirs: HMBlockNode[] = [node({id: 'b1', text: 'theirs', revision: 'cidB'})]
    const pickMine = applyRebasePlan(
      mine,
      theirs,
      {
        scaffold: 'theirs',
        mineBlocks: new Set(),
        theirsBlocks: new Set(['b1']),
        conflictedBlockIds: ['b1'],
      },
      {b1: 'mine'},
    )
    expect((pickMine[0]?.block as any)?.text).toBe('mine')

    const pickTheirs = applyRebasePlan(
      mine,
      theirs,
      {
        scaffold: 'theirs',
        mineBlocks: new Set(['b1']),
        theirsBlocks: new Set(),
        conflictedBlockIds: ['b1'],
      },
      {b1: 'theirs'},
    )
    expect((pickTheirs[0]?.block as any)?.text).toBe('theirs')
  })

  it('recursively rebuilds nested children', () => {
    const mine: HMBlockNode[] = [
      node({id: 'b1', text: 'parent', revision: 'cidA'}, [node({id: 'b1a', text: 'mine child', revision: 'cidA'})]),
    ]
    const theirs: HMBlockNode[] = [
      node({id: 'b1', text: 'parent', revision: 'cidA'}, [node({id: 'b1a', text: 'theirs child', revision: 'cidB'})]),
    ]
    const merged = applyRebasePlan(mine, theirs, {
      scaffold: 'theirs',
      mineBlocks: new Set(['b1a']),
      theirsBlocks: new Set(),
      conflictedBlockIds: [],
    })
    expect((merged[0]?.children?.[0]?.block as any)?.text).toBe('mine child')
  })
})
