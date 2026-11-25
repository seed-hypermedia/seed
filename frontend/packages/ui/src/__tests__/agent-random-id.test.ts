import {afterEach, describe, expect, it, vi} from 'vitest'
import {randomUUID} from '../agents/random-id'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUUID', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses crypto.randomUUID where the page is a secure context', () => {
    const native = vi.spyOn(crypto, 'randomUUID')
    expect(randomUUID()).toMatch(UUID_V4)
    expect(native).toHaveBeenCalled()
  })

  it('still returns v4 UUIDs on plain-http pages, which lack crypto.randomUUID', () => {
    // Shadows the prototype's method the way an insecure context leaves it out.
    Object.defineProperty(crypto, 'randomUUID', {value: undefined, configurable: true})
    try {
      const ids = new Set(Array.from({length: 50}, () => randomUUID()))
      expect(ids.size).toBe(50)
      for (const id of ids) expect(id).toMatch(UUID_V4)
    } finally {
      delete (crypto as {randomUUID?: unknown}).randomUUID
    }
  })
})
