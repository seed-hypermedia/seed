import {describe, expect, it} from 'vitest'
import {vi} from 'vitest'

vi.mock('@/trpc', () => ({client: {}}))

import {
  createJoinedSiteOrderWriter,
  parseJoinedSiteOrder,
  reconcileJoinedSiteOrder,
  selectJoinedSiteOrder,
} from '../joined-site-order'

describe('parseJoinedSiteOrder', () => {
  it('rejects invalid stored values', () => {
    expect(parseJoinedSiteOrder(null)).toBeNull()
    expect(parseJoinedSiteOrder(['site-a', '', 42])).toBeNull()
  })

  it('removes duplicate site ids while keeping their first occurrence', () => {
    expect(parseJoinedSiteOrder(['site-b', 'site-a', 'site-b'])).toEqual(['site-b', 'site-a'])
  })
})

describe('selectJoinedSiteOrder', () => {
  it('does not reuse the previous identity order while the next identity loads', () => {
    expect(selectJoinedSiteOrder(['site-a'], true)).toBeNull()
    expect(selectJoinedSiteOrder(['site-a'], false)).toEqual(['site-a'])
  })
})

describe('reconcileJoinedSiteOrder', () => {
  it('uses source order without requesting persistence when no custom order exists', () => {
    expect(reconcileJoinedSiteOrder(['site-c', 'site-b', 'site-a'], null)).toEqual({
      order: ['site-c', 'site-b', 'site-a'],
      shouldPersist: false,
    })
  })

  it('prepends new sites and preserves the saved relative order of known sites', () => {
    expect(
      reconcileJoinedSiteOrder(['site-new', 'site-c', 'site-b', 'site-a'], ['site-a', 'site-c', 'site-b']),
    ).toEqual({
      order: ['site-new', 'site-a', 'site-c', 'site-b'],
      shouldPersist: true,
    })
  })

  it('garbage collects sites that are no longer joined', () => {
    expect(reconcileJoinedSiteOrder(['site-c', 'site-a'], ['site-a', 'site-removed', 'site-c'])).toEqual({
      order: ['site-a', 'site-c'],
      shouldPersist: true,
    })
  })

  it('does not request persistence when the stored order is already current', () => {
    expect(reconcileJoinedSiteOrder(['site-a', 'site-b'], ['site-b', 'site-a'])).toEqual({
      order: ['site-b', 'site-a'],
      shouldPersist: false,
    })
  })
})

describe('createJoinedSiteOrderWriter', () => {
  it('serializes writes so an older request cannot finish after a newer one', async () => {
    let resolveFirst: (() => void) | undefined
    const writes: string[][] = []
    const write = vi.fn((order: string[]) => {
      writes.push(order)
      if (writes.length === 1) return new Promise<void>((resolve) => (resolveFirst = resolve))
      return Promise.resolve()
    })
    const writer = createJoinedSiteOrderWriter(write)

    const first = writer(['site-b', 'site-a'])
    const second = writer(['site-a', 'site-b'])

    await Promise.resolve()
    expect(writes).toEqual([['site-b', 'site-a']])
    resolveFirst?.()
    await Promise.all([first, second])
    expect(writes).toEqual([
      ['site-b', 'site-a'],
      ['site-a', 'site-b'],
    ])
  })

  it('continues with the latest write after an earlier write fails', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined)
    const writer = createJoinedSiteOrderWriter(write)

    const first = writer(['site-b', 'site-a'])
    const second = writer(['site-a', 'site-b'])

    await expect(first).rejects.toThrow('disk full')
    await expect(second).resolves.toBeUndefined()
    expect(write).toHaveBeenCalledTimes(2)
  })
})
