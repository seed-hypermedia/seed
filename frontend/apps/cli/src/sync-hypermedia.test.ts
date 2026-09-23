import {describe, expect, test} from 'bun:test'
import {batchBlobs} from './sync-hypermedia'

const blob = (n: number, cid: string) => ({data: new Uint8Array(n), cid})

describe('batchBlobs', () => {
  test('keeps every batch under the byte budget and the count cap, in order', () => {
    const blobs = Array.from({length: 10}, (_, i) => blob(30, `b${i}`))
    const batches = batchBlobs(blobs, 100, 3)
    expect(batches.map((b) => b.map((x) => x.cid))).toEqual([
      ['b0', 'b1', 'b2'],
      ['b3', 'b4', 'b5'],
      ['b6', 'b7', 'b8'],
      ['b9'],
    ])
    for (const b of batches) expect(b.reduce((n, x) => n + x.data.byteLength, 0)).toBeLessThanOrEqual(100)
  })

  test('a blob larger than the budget goes alone instead of being dropped', () => {
    const batches = batchBlobs([blob(10, 'a'), blob(500, 'big'), blob(10, 'c')], 100, 32)
    expect(batches.map((b) => b.map((x) => x.cid))).toEqual([['a'], ['big'], ['c']])
  })

  test('nothing to publish is no requests', () => {
    expect(batchBlobs([])).toEqual([])
  })
})
