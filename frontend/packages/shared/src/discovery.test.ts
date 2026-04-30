import {describe, expect, it} from 'vitest'
import {discoveryUrl} from './discovery'

describe('discoveryUrl', () => {
  it('returns just the account root when no path/recursion/scope', () => {
    expect(discoveryUrl({uid: 'A'})).toBe('hm://A')
  })

  it('treats null path the same as no path', () => {
    expect(discoveryUrl({uid: 'A', path: null})).toBe('hm://A')
  })

  it('treats empty array path the same as no path', () => {
    expect(discoveryUrl({uid: 'A', path: []})).toBe('hm://A')
  })

  it('joins path components with slashes', () => {
    expect(discoveryUrl({uid: 'A', path: ['notes', 'foo']})).toBe('hm://A/notes/foo')
  })

  it('emits /* for children recursion at root', () => {
    expect(discoveryUrl({uid: 'A', recursion: 'children'})).toBe('hm://A/*')
  })

  it('emits /** for descendants recursion at root', () => {
    expect(discoveryUrl({uid: 'A', recursion: 'descendants'})).toBe('hm://A/**')
  })

  it('appends children wildcard to a non-empty path', () => {
    expect(discoveryUrl({uid: 'A', path: ['notes'], recursion: 'children'})).toBe('hm://A/notes/*')
  })

  it('appends descendants wildcard to a non-empty path', () => {
    expect(discoveryUrl({uid: 'A', path: ['notes'], recursion: 'descendants'})).toBe('hm://A/notes/**')
  })

  it('emits /:profile for profile scope at root', () => {
    expect(discoveryUrl({uid: 'A', scope: 'profile'})).toBe('hm://A/:profile')
  })

  it('appends :profile directly when path is non-empty', () => {
    expect(discoveryUrl({uid: 'A', path: ['notes', 'foo'], scope: 'profile'})).toBe('hm://A/notes/foo:profile')
  })

  it('produces a canonical, byte-stable string for identical inputs', () => {
    const a = discoveryUrl({uid: 'A', path: ['notes'], scope: 'profile'})
    const b = discoveryUrl({uid: 'A', path: ['notes'], scope: 'profile'})
    expect(a).toBe(b)
  })

  it('throws when recursion and scope are both non-default', () => {
    expect(() => discoveryUrl({uid: 'A', recursion: 'descendants', scope: 'profile'})).toThrow(/mutually exclusive/)
  })

  it('does not throw with default scope alongside non-default recursion', () => {
    expect(() => discoveryUrl({uid: 'A', recursion: 'descendants', scope: 'all'})).not.toThrow()
  })
})
