import {deserialize, serialize} from 'superjson'
import {describe, expect, it} from 'vitest'
import {serializeSuperJSON} from '../fast-superjson'

/** Byte-identical to superjson, including key order of json and meta. */
function expectSameAsSuperjson(value: unknown) {
  const expected = serialize(value)
  const actual = serializeSuperJSON(value)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(deserialize(actual)).toEqual(deserialize(expected))
}

describe('serializeSuperJSON', () => {
  it('matches superjson for root primitives and leaves', () => {
    for (const v of ['s', '', 0, 1.5, -3, true, false, null, undefined, 12n, new Date(1_700_000_000_000)]) {
      expectSameAsSuperjson(v)
    }
    expectSameAsSuperjson({})
    expectSameAsSuperjson([])
  })

  it('matches superjson for a document-shaped payload', () => {
    const metadata = {name: 'Doc', icon: 'ipfs://x', 'dotted.key': undefined}
    const generationInfo = {genesis: 'bafy', generation: 1730000000000n}
    const document = {
      account: 'z6Mk',
      path: '/a/b',
      version: 'v1',
      metadata,
      authors: ['z6Mk'],
      content: [
        {block: {id: 'a', type: 'Paragraph', text: 'hi', annotations: [], attributes: {}}, children: []},
        {block: {id: 'b', type: 'Image', link: 'ipfs://y', attributes: {width: undefined}}},
      ],
      generationInfo,
      createTime: {seconds: 1700000000n, nanos: 0},
      redirectInfo: undefined,
    }
    expectSameAsSuperjson({
      id: {id: 'hm://z6Mk/a/b', uid: 'z6Mk', path: ['a', 'b'], version: null, latest: false},
      document,
      dehydratedState: {
        mutations: [],
        queries: [
          {queryKey: ['ENTITY', 'hm://z6Mk/a/b', undefined, true], state: {data: {type: 'document', document}}},
          {
            queryKey: ['DOC_LIST_DIRECTORY'],
            state: {
              data: [
                {sortTime: new Date(1), activitySummary: {latestCommentTime: undefined}, metadata},
                {sortTime: new Date(2), generationInfo: {genesis: 'x', generation: 1730000000000n}},
              ],
            },
          },
        ],
      },
      ssrContentHTML: '<div class="a.b">x</div>',
    })
  })

  it('matches superjson for odd keys and shared references', () => {
    const shared = {x: [1, undefined, {y: 2n}]}
    expectSameAsSuperjson({
      '': {'': undefined, 'a.b': {'c.d': 5n}},
      'k.': shared,
      list: [shared, shared, [shared]],
      nested: {again: shared},
    })
    const arr = [undefined, 3n]
    expectSameAsSuperjson([arr, {a: arr}])
  })

  it('falls back to superjson for values it does not handle', () => {
    class Thing {
      a = 1
    }
    const cyclic: any = {a: 1}
    cyclic.self = cyclic
    for (const v of [
      {m: new Map([['a', 1]])},
      {s: new Set([1, 2])},
      {n: NaN, i: Infinity, z: -0},
      {t: new Thing()},
      {r: /x/g},
      {d: new Date(NaN)},
      {u: new Uint8Array([1, 2])},
      cyclic,
      // eslint-disable-next-line no-sparse-arrays
      [1, , 3],
    ]) {
      expectSameAsSuperjson(v)
    }
  })

  it('matches superjson on randomized trees', () => {
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const pool: object[] = []
    function gen(depth: number): unknown {
      const r = rand()
      if (depth > 4 || r < 0.35) {
        const leaves = ['str', 7, true, null, undefined, 5n, BigInt(Math.floor(rand() * 3)), new Date(1e12)]
        return leaves[Math.floor(rand() * leaves.length)]
      }
      if (pool.length && r < 0.45) return pool[Math.floor(rand() * pool.length)]
      const node: any = r < 0.7 ? [] : {}
      const n = Math.floor(rand() * 5)
      for (let i = 0; i < n; i++) {
        const child = gen(depth + 1)
        if (Array.isArray(node)) node.push(child)
        else node[['a', 'b.c', '', 'd', 'e.f.g'][i]!] = child
      }
      pool.push(node)
      return node
    }
    for (let i = 0; i < Number(process.env.FAST_SJ_ITER || 300); i++) {
      pool.length = 0
      expectSameAsSuperjson({root: gen(0), again: gen(1)})
    }
  })
})
