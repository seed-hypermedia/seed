import {describe, expect, it} from 'bun:test'
import {isDenied} from './seedcli.js'

describe('isDenied', () => {
  it('blocks key mutations', () => {
    expect(isDenied('key', 'generate')).toBe(true)
    expect(isDenied('key', 'remove')).toBe(true)
    expect(isDenied('key', 'import')).toBe(true)
    expect(isDenied('key', 'rename')).toBe(true)
  })

  it('allows key reads (needed at boot for accountId resolution)', () => {
    expect(isDenied('key', 'list')).toBe(false)
    expect(isDenied('key', 'show')).toBe(false)
    expect(isDenied('key', 'default')).toBe(false)
    expect(isDenied('key', 'derive')).toBe(false)
  })

  it('blocks capability mutations', () => {
    expect(isDenied('capability', 'create')).toBe(true)
  })

  it('allows ordinary read commands', () => {
    expect(isDenied('document', 'get')).toBe(false)
    expect(isDenied('comment', 'list')).toBe(false)
    expect(isDenied('search', '')).toBe(false)
    expect(isDenied('activity', '')).toBe(false)
  })
})
