import {HMSearchResultItemSchema} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'

const validItem = {
  id: {
    id: 'hm://z6MkhUgmuFYwEDED4P5EdPKqh35ybJprcGxaVpK9u3H8vpGh',
    uid: 'z6MkhUgmuFYwEDED4P5EdPKqh35ybJprcGxaVpK9u3H8vpGh',
    path: null,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
  },
  title: 'Test Document',
  icon: '',
  parentNames: ['Parent'],
  versionTime: '3/10/2026, 12:00:00 PM',
  searchQuery: 'test',
  type: 'document' as const,
}

describe('HMSearchResultItemSchema', () => {
  it('accepts versionTime as a locale string', () => {
    const result = HMSearchResultItemSchema.safeParse(validItem)
    expect(result.success).toBe(true)
  })

  it('accepts versionTime as undefined', () => {
    const {versionTime, ...rest} = validItem
    const result = HMSearchResultItemSchema.safeParse(rest)
    expect(result.success).toBe(true)
  })

  it('rejects versionTime as a Timestamp-like object (regression for #305)', () => {
    const item = {
      ...validItem,
      versionTime: {seconds: BigInt(1741608000), nanos: 0},
    }
    const result = HMSearchResultItemSchema.safeParse(item)
    expect(result.success).toBe(false)
  })

  it('rejects versionTime as a number', () => {
    const item = {...validItem, versionTime: 1741608000}
    const result = HMSearchResultItemSchema.safeParse(item)
    expect(result.success).toBe(false)
  })
})
