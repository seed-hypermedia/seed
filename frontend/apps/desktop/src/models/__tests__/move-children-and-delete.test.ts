import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it, vi} from 'vitest'
import {moveChildrenAndDelete} from '../move-children-and-delete'

const parent = hmId('site', {path: ['p']})
const target = hmId('site', {path: ['t']})

const docs = [
  {path: ['p'], isRedirect: false, metadata: {name: 'Parent'}},
  {path: ['p', 'a'], isRedirect: false},
  {path: ['p', 'a', 'deep'], isRedirect: false},
  {path: ['p', 'b'], isRedirect: false},
  {path: ['p', 'gone'], isRedirect: true},
]

function deps(overrides: Partial<Parameters<typeof moveChildrenAndDelete>[0]> = {}) {
  return {
    parent,
    target,
    signingAccountId: 'site',
    listDocuments: async () => docs,
    requestResource: vi.fn(async () => ({type: 'not-found'}) as any),
    move: vi.fn(async () => {}),
    deleteParent: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('moveChildrenAndDelete', () => {
  it('moves every child root then deletes only the parent', async () => {
    const move = vi.fn(async (_m: {from: any; to: any}) => {})
    const deleteParent = vi.fn(async () => {})
    await moveChildrenAndDelete(deps({move, deleteParent}))
    expect(move.mock.calls.map(([m]) => [m.from.path, m.to.path])).toEqual([
      [
        ['p', 'a'],
        ['t', 'a'],
      ],
      [
        ['p', 'b'],
        ['t', 'b'],
      ],
    ])
    expect(deleteParent).toHaveBeenCalledTimes(1)
    expect(deleteParent.mock.invocationCallOrder[0]!).toBeGreaterThan(move.mock.invocationCallOrder.at(-1)!)
  })

  it('publishes and deletes nothing when a destination is occupied', async () => {
    const move = vi.fn(async () => {})
    const deleteParent = vi.fn(async () => {})
    const d = deps({
      move,
      deleteParent,
      requestResource: vi.fn(async (id) =>
        id.path?.join('/') === 't/a'
          ? ({type: 'document', id, document: {version: 'v1'}} as any)
          : ({type: 'not-found'} as any),
      ),
    })
    await expect(moveChildrenAndDelete(d)).rejects.toThrow('A document already exists')
    expect(move).not.toHaveBeenCalled()
    expect(deleteParent).not.toHaveBeenCalled()
  })

  it('does not delete the parent when a move fails partway', async () => {
    const deleteParent = vi.fn(async () => {})
    let count = 0
    const d = deps({
      deleteParent,
      move: vi.fn(async () => {
        count += 1
        if (count === 2) throw new Error('move failed')
      }),
    })
    await expect(moveChildrenAndDelete(d)).rejects.toThrow(
      /Moved 1 of 2 child documents\. "Parent" was not deleted\. move failed/,
    )
    expect(deleteParent).not.toHaveBeenCalled()
  })
})
