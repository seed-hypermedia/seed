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
    const mine: HMBlockNode[] = [node({id: 'b1', text: 'one edited'}), node({id: 'b2', text: 'two', revision: 'cidA'})]
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
    const mine: HMBlockNode[] = [node({id: 'b1', text: 'mine edit'})]
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
      node({id: 'b2', text: 'mine updated'}),
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

  it('propagates a remote descendant edit to a locally deleted ancestor', () => {
    const child = node({id: 'child', text: 'Published'})
    const parent = node({id: 'parent'}, [child])
    const remoteChild = node({id: 'child', text: 'Remote edit'})
    const theirs = [{...parent, children: [remoteChild]}]
    const result = classifyRebase([parent], [], theirs, [], new Set())
    expect(result.conflictedBlockIds.sort()).toEqual(['child', 'parent'])
    expect(applyRebasePlan([], theirs, result.plan, {child: 'theirs'})).toEqual(theirs)
    expect(applyRebasePlan([], theirs, result.plan, {parent: 'mine', child: 'theirs'})).toEqual([remoteChild])
  })

  it('reattaches an explicitly retained remote subtree once when its ancestor is removed', () => {
    const grandchild = node({id: 'grandchild', text: 'Published'})
    const child = node({id: 'child'}, [grandchild])
    const parent = node({id: 'parent'}, [child])
    const remoteGrandchild = node({id: 'grandchild', text: 'Remote edit'})
    const remoteChild = {...child, children: [remoteGrandchild]}
    const theirs = [{...parent, children: [remoteChild]}]
    const result = classifyRebase([parent], [], theirs, [], new Set())
    expect(applyRebasePlan([], theirs, result.plan, {parent: 'mine', child: 'theirs', grandchild: 'theirs'})).toEqual([
      remoteChild,
    ])
  })

  it('requires a choice when theirs adds a child beneath a locally deleted ancestor', () => {
    const parent = node({id: 'parent'})
    const remoteChild = node({id: 'remote-child'})
    const theirs = [{...parent, children: [remoteChild]}]
    const result = classifyRebase([parent], [], theirs, [], new Set())
    expect(result.autoMergeable).toBe(false)
    expect(result.conflictedBlockIds).toEqual(['parent'])
    expect(applyRebasePlan([], theirs, result.plan, {parent: 'theirs'})).toEqual(theirs)
    expect(applyRebasePlan([], theirs, result.plan, {parent: 'mine'})).toEqual([])
  })

  it('does not conflict on a deleted ancestor when the new remote child is retained outside it', () => {
    const parent = node({id: 'parent'})
    const remoteChild = node({id: 'remote-child'})
    const theirs = [{...parent, children: [remoteChild]}]
    const result = classifyRebase([parent], [remoteChild], theirs, [], new Set())
    expect(result.conflictedBlockIds).not.toContain('parent')
    expect(applyRebasePlan([remoteChild], theirs, result.plan, {'remote-child': 'theirs'})).toEqual([remoteChild])
  })

  it('auto-merges when mine adds and theirs adds different new blocks', () => {
    const base: HMBlockNode[] = [node({id: 'b1', text: 'one', revision: 'cidA'})]
    const mine: HMBlockNode[] = [
      node({id: 'b1', text: 'one', revision: 'cidA'}),
      node({id: 'bMine', text: 'added by me'}),
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
  it('keeps a user-deleted card deleted when choosing mine after a remote rename', () => {
    const card: HMBlockNode = {
      block: {
        id: 'card',
        type: 'Embed',
        link: 'hm://account/old-name',
        attributes: {view: 'Card'},
        revision: 'cidA',
      } as HMBlockNode['block'],
      children: [],
    }
    const paragraph = node({id: 'paragraph', text: 'Unrelated text', revision: 'cidA'})
    const base = [paragraph, card]
    const mine = [paragraph]
    const theirs: HMBlockNode[] = [
      paragraph,
      {
        ...card,
        block: {...card.block, link: 'hm://account/new-name', revision: 'cidB'} as HMBlockNode['block'],
      },
    ]

    const result = classifyRebase(base, mine, theirs, [], new Set(['cidB']))

    expect(result.autoMergeable).toBe(false)
    expect(result.conflictedBlockIds).toEqual(['card'])
    expect(applyRebasePlan(mine, theirs, result.plan, {card: 'mine'})).toEqual(mine)
  })

  it('does not resurrect a remotely deleted card when preserving unrelated local edits', () => {
    const card: HMBlockNode = {
      block: {
        id: 'card',
        type: 'Embed',
        link: 'hm://account/deleted-child',
        attributes: {view: 'Card'},
        revision: 'cidA',
      } as HMBlockNode['block'],
      children: [],
    }
    const paragraph = node({id: 'paragraph', text: 'Published text', revision: 'cidA'})
    const editedParagraph = node({id: 'paragraph', text: 'Unpublished user edits'})
    const base = [paragraph, card]
    const mine = [editedParagraph, card]
    const theirs = [paragraph]

    const result = classifyRebase(base, mine, theirs, ['paragraph'], new Set(['cidB']))

    expect(result.autoMergeable).toBe(true)
    expect(result.conflictedBlockIds).toEqual([])
    expect(applyRebasePlan(mine, theirs, result.plan)).toEqual([editedParagraph])
  })

  it.each(['root', 'surviving-parent'])('retains a child moved out of a locally deleted card to %s', (destination) => {
    const child = node({id: 'child', text: 'Keep this text'})
    const card: HMBlockNode = {
      block: {id: 'card', type: 'Embed', link: 'hm://account/child', attributes: {view: 'Card'}},
      children: [child],
    }
    const parent = node({id: 'parent'})
    const base = [card, parent]
    const mine = destination === 'root' ? [child, parent] : [{...parent, children: [child]}]
    const result = classifyRebase(base, mine, base, ['card'], new Set())
    expect(result.autoMergeable).toBe(true)
    const merged = applyRebasePlan(mine, base, result.plan)
    expect(merged).toEqual(destination === 'root' ? [parent, child] : mine)
  })

  it('keeps remote edits and new descendants of a retained child under a locally deleted parent', () => {
    const child = node({id: 'child', text: 'Published', revision: 'cidA'})
    const parent = node({id: 'parent'}, [child])
    const remoteChild = node({id: 'child', text: 'Remote edit', revision: 'cidB'}, [node({id: 'remote-add'})])
    const mine = [child]
    const theirs = [{...parent, children: [remoteChild]}]
    const result = classifyRebase([parent], mine, theirs, ['parent'], new Set(['cidB']))
    expect(result.autoMergeable).toBe(true)
    expect(applyRebasePlan(mine, theirs, result.plan)).toEqual([remoteChild])
  })

  it('does not restore descendants of a fully deleted local subtree', () => {
    const base = [node({id: 'parent'}, [node({id: 'child'})])]
    const result = classifyRebase(base, [], base, [], new Set())
    expect(applyRebasePlan([], base, result.plan)).toEqual([])
  })

  it('keeps an uncontested local deletion', () => {
    const base = [node({id: 'deleted', revision: 'cidA'})]
    const result = classifyRebase(base, [], base, [], new Set())
    expect(applyRebasePlan([], base, result.plan)).toEqual([])
  })

  it('honors either choice for a remote deletion conflict', () => {
    const base = [node({id: 'deleted', text: 'published', revision: 'cidA'})]
    const mine = [node({id: 'deleted', text: 'local edit'})]
    const result = classifyRebase(base, mine, [], ['deleted'], new Set(['cidB']))
    expect(result.conflictedBlockIds).toEqual(['deleted'])
    expect(applyRebasePlan(mine, [], result.plan)).toEqual([])
    expect(applyRebasePlan(mine, [], result.plan, {deleted: 'theirs'})).toEqual([])
    expect(applyRebasePlan(mine, [], result.plan, {deleted: 'mine'})).toEqual(mine)
  })

  it('honors theirs when mine deleted a remotely edited block', () => {
    const base = [node({id: 'deleted', text: 'published', revision: 'cidA'})]
    const theirs = [node({id: 'deleted', text: 'remote edit', revision: 'cidB'})]
    const result = classifyRebase(base, [], theirs, [], new Set(['cidB']))
    expect(applyRebasePlan([], theirs, result.plan, {deleted: 'theirs'})).toEqual(theirs)
  })

  it('appends a new local subtree only once', () => {
    const mine = [node({id: 'parent'}, [node({id: 'child'}, [node({id: 'grandchild'})])])]
    const result = classifyRebase([], mine, [], [], new Set())
    expect(applyRebasePlan(mine, [], result.plan)).toEqual(mine)
  })

  it('keeps new local children nested without disturbing remote siblings', () => {
    const parent = node({id: 'parent', revision: 'cidA'})
    const localChild = node({id: 'local-child'})
    const remoteChild = node({id: 'remote-child', revision: 'cidB'})
    const mine = [{...parent, children: [localChild]}]
    const theirs = [{...parent, children: [remoteChild]}]
    const result = classifyRebase([parent], mine, theirs, [], new Set(['cidB']))
    expect(applyRebasePlan(mine, theirs, result.plan)).toEqual([{...parent, children: [remoteChild, localChild]}])
  })

  it('does not reattach remotely removed nested blocks', () => {
    const child = node({id: 'child', revision: 'cidA'})
    const parent = node({id: 'parent', revision: 'cidA'}, [child])
    const mine = [parent, node({id: 'local-add'})]
    const theirs = [{...parent, children: []}]
    const result = classifyRebase([parent], mine, theirs, [], new Set(['cidB']))
    expect(applyRebasePlan(mine, theirs, result.plan)).toEqual([...theirs, mine[1]])
  })

  it('keeps theirs order and swaps mine content for plan.mineBlocks', () => {
    const mine: HMBlockNode[] = [node({id: 'b1', text: 'mine one'}), node({id: 'b2', text: 'mine two'})]
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
      node({id: 'bMine', text: 'added by me'}),
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
    const mine: HMBlockNode[] = [node({id: 'b1', text: 'mine'})]
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
      node({id: 'b1', text: 'parent', revision: 'cidA'}, [node({id: 'b1a', text: 'mine child'})]),
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
