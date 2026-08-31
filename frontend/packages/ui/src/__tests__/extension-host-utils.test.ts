import {describe, expect, it} from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  extensionIdString,
  extensionStorageKey,
  normalizeHmIdInput,
  normalizeQueryInput,
  toCloneable,
  validateExternalUrl,
  validateNavigateUrl,
} from '../extensions/host-utils'

describe('extensionIdString', () => {
  it('strips version and fragments from the install record ext URL', () => {
    expect(extensionIdString({ext: 'hm://z6MkAuthor/kanban'})).toBe('hm://z6MkAuthor/kanban')
    expect(extensionIdString({ext: 'hm://z6MkAuthor/kanban?v=bafy'})).toBe('hm://z6MkAuthor/kanban')
    expect(extensionIdString({ext: 'hm://z6MkAuthor'})).toBe('hm://z6MkAuthor')
    expect(extensionIdString({ext: 'https://example.com/x'})).toBeNull()
  })

  it('namespaces storage keys per extension and site', () => {
    expect(extensionStorageKey('hm://z6MkA/ext', 'z6MkSite', 'k')).toBe('seed.ext.hm://z6MkA/ext.z6MkSite.k')
  })
})

describe('normalizeHmIdInput', () => {
  it('accepts hm:// strings (version-less → latest)', () => {
    const id = normalizeHmIdInput('hm://z6MkA/docs/one')
    expect(id).toMatchObject({uid: 'z6MkA', path: ['docs', 'one'], version: null, latest: true})
  })

  it('accepts {id} wrappers with a version', () => {
    const id = normalizeHmIdInput({id: 'hm://z6MkA/docs?v=bafyV'})
    expect(id).toMatchObject({uid: 'z6MkA', path: ['docs'], version: 'bafyV', latest: false})
  })

  it('accepts already-unpacked ids', () => {
    const id = normalizeHmIdInput({uid: 'z6MkA', path: ['p'], version: null})
    expect(id).toMatchObject({uid: 'z6MkA', path: ['p'], id: 'hm://z6MkA/p', latest: true})
  })

  it('rejects garbage with invalid_params', () => {
    expect(() => normalizeHmIdInput('https://example.com')).toThrowError(/invalid|not a valid/i)
    expect(() => normalizeHmIdInput(42)).toThrowError(/hm:\/\//)
  })
})

describe('normalizeQueryInput', () => {
  it('unpacks the whole input for Resource / ResourceMetadata', () => {
    expect(normalizeQueryInput('Resource', {id: 'hm://z6MkA/x'})).toMatchObject({uid: 'z6MkA', path: ['x']})
    expect(normalizeQueryInput('ResourceMetadata', 'hm://z6MkA')).toMatchObject({uid: 'z6MkA'})
  })

  it('unpacks targetId / authorId / id fields and leaves the rest alone', () => {
    expect(normalizeQueryInput('ListComments', {targetId: 'hm://z6MkA/x'})).toMatchObject({
      targetId: {uid: 'z6MkA', path: ['x']},
    })
    expect(normalizeQueryInput('ListCommentsByAuthor', {authorId: {id: 'hm://z6MkB'}})).toMatchObject({
      authorId: {uid: 'z6MkB'},
    })
    expect(normalizeQueryInput('InteractionSummary', {id: 'hm://z6MkA'})).toMatchObject({id: {uid: 'z6MkA'}})
    expect(normalizeQueryInput('ListDiscussions', {targetId: 'hm://z6MkA', commentId: 'c'})).toMatchObject({
      commentId: 'c',
    })
  })

  it('passes through keys without id fields', () => {
    const search = {query: 'hello', accountUid: 'z6MkA'}
    expect(normalizeQueryInput('Search', search)).toEqual(search)
    expect(normalizeQueryInput('Account', 'z6MkA')).toBe('z6MkA')
    expect(normalizeQueryInput('Query', {includes: [{space: 'z6MkA', path: '', mode: 'Children'}]})).toEqual({
      includes: [{space: 'z6MkA', path: '', mode: 'Children'}],
    })
  })
})

describe('toCloneable', () => {
  it('converts bigints, drops functions and keeps typed arrays', () => {
    const bytes = new Uint8Array([1, 2])
    const out = toCloneable({
      generation: 123n,
      huge: 2n ** 70n,
      fn: () => 1,
      nested: [{ts: 5n}, undefined, null],
      bytes,
      date: new Date(0),
    }) as Record<string, unknown>
    expect(out.generation).toBe(123)
    expect(out.huge).toBe((2n ** 70n).toString())
    expect('fn' in out).toBe(false)
    expect(out.nested).toEqual([{ts: 5}, null, null])
    expect(out.bytes).toBe(bytes)
    expect(out.date).toBeInstanceOf(Date)
  })

  it('flattens class instances to plain objects', () => {
    class Thing {
      a = 1
      get b() {
        return 2
      }
    }
    expect(toCloneable(new Thing())).toEqual({a: 1})
  })
})

describe('url validation', () => {
  it('navigate accepts hm:// and site-relative paths only', () => {
    expect(validateNavigateUrl('hm://z6MkA/x')).toBe('hm://z6MkA/x')
    expect(validateNavigateUrl('/docs?x=1')).toBe('/docs?x=1')
    expect(() => validateNavigateUrl('//evil.com')).toThrow()
    expect(() => validateNavigateUrl('https://example.com')).toThrow()
    expect(() => validateNavigateUrl('hm://')).toThrow()
  })

  it('openExternal accepts http(s) only', () => {
    expect(validateExternalUrl('https://example.com/a?b')).toBe('https://example.com/a?b')
    expect(() => validateExternalUrl('javascript:alert(1)')).toThrow()
    expect(() => validateExternalUrl('file:///etc/passwd')).toThrow()
    expect(() => validateExternalUrl('not a url')).toThrow()
  })
})

describe('base64', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array(300).map((_, i) => i % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=')
    expect(() => base64ToBytes('***')).toThrow()
  })
})
