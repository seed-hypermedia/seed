import {describe, expect, it} from 'vitest'
import {seedEditUrl} from './seedEditUrl'

describe('seedEditUrl', () => {
  it('builds the editor URL when both origin and cid are present', () => {
    expect(seedEditUrl('https://seed.example', 'bafyCID')).toBe('https://seed.example/hm/blob/ipfs/bafyCID')
  })

  it('trims a trailing slash on the origin', () => {
    expect(seedEditUrl('https://seed.example/', 'bafyCID')).toBe('https://seed.example/hm/blob/ipfs/bafyCID')
  })

  it('returns null when origin is missing', () => {
    expect(seedEditUrl(undefined, 'bafyCID')).toBeNull()
    expect(seedEditUrl('', 'bafyCID')).toBeNull()
  })

  it('returns null when cid is missing', () => {
    expect(seedEditUrl('https://seed.example', undefined)).toBeNull()
    expect(seedEditUrl('https://seed.example', '')).toBeNull()
  })
})
