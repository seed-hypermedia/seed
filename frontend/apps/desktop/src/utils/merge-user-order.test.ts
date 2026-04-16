import {describe, expect, it} from 'vitest'
import {mergeWithUserOrder} from './merge-user-order'

type Item = {id: string; name: string}
const getId = (item: Item) => item.id

const a: Item = {id: 'a', name: 'Alpha'}
const b: Item = {id: 'b', name: 'Beta'}
const c: Item = {id: 'c', name: 'Charlie'}
const d: Item = {id: 'd', name: 'Delta'}

describe('mergeWithUserOrder', () => {
  it('returns items in userOrder sequence', () => {
    const result = mergeWithUserOrder(['c', 'a', 'b'], [a, b, c], getId)
    expect(result).toEqual([c, a, b])
  })

  it('appends new items not in userOrder at end', () => {
    const result = mergeWithUserOrder(['a'], [a, b, c], getId)
    expect(result).toEqual([a, b, c])
  })

  it('skips stale IDs not in liveItems', () => {
    const result = mergeWithUserOrder(['a', 'x', 'b'], [a, b], getId)
    expect(result).toEqual([a, b])
  })

  it('handles empty userOrder — returns liveItems as-is', () => {
    const result = mergeWithUserOrder([], [a, b, c], getId)
    expect(result).toEqual([a, b, c])
  })

  it('handles empty liveItems — returns empty array', () => {
    const result = mergeWithUserOrder(['a', 'b'], [], getId)
    expect(result).toEqual([])
  })

  it('handles both empty', () => {
    const result = mergeWithUserOrder([], [], getId)
    expect(result).toEqual([])
  })

  it('preserves live order for new items', () => {
    const result = mergeWithUserOrder(['b'], [a, b, c, d], getId)
    expect(result).toEqual([b, a, c, d])
  })

  it('does not duplicate items', () => {
    const result = mergeWithUserOrder(['a', 'a', 'b'], [a, b], getId)
    // Second 'a' in userOrder should be skipped since already placed
    expect(result).toEqual([a, b])
  })
})
