import {describe, expect, test} from 'vitest'
import {
  hmId,
  packHmId,
  parseCustomURL,
  parseFragment,
  unpackHmId,
} from '../entity-id-url'

describe('unpackHmId', () => {
  test('unpacks hm://abc', () => {
    expect(unpackHmId('hm://abc')).toEqual({
      id: 'hm://abc',
      scheme: 'hm',
      hostname: null,
      uid: 'abc',
      version: null,
      blockRange: null,
      blockRef: null,
      path: [],
      latest: true,
    })
  })
  test('unpacks hm://foo#bar - blockRef forces latest=false', () => {
    // When blockRef is present, latest should be false because
    // the block only exists in a specific version
    expect(unpackHmId('hm://foo#bar')).toEqual({
      id: 'hm://foo',
      scheme: 'hm',
      hostname: null,
      uid: 'foo',
      version: null,
      blockRange: {
        expanded: false,
      },
      blockRef: 'bar',
      path: [],
      latest: false,
    })
  })
  test('unpacks hm://foo?v=bar', () => {
    expect(unpackHmId('hm://foo?v=bar')).toEqual({
      id: 'hm://foo',
      scheme: 'hm',
      hostname: null,
      uid: 'foo',
      version: 'bar',
      blockRange: null,
      blockRef: null,
      path: [],
      latest: false,
    })
  })

  describe('web urls', () => {
    test('unpacks https://foobar.com/hm/a/b/c?v=2', () => {
      expect(unpackHmId('https://foobar.com/hm/a/b/c?v=2')).toEqual({
        scheme: 'https',
        hostname: 'foobar.com',
        uid: 'a',
        version: '2',
        blockRef: null,
        blockRange: null,
        id: 'hm://a/b/c',
        path: ['b', 'c'],
        latest: false,
      })
    })
    test('unpacks http://foobar.com/hm/1#block - blockRef forces latest=false', () => {
      expect(unpackHmId('http://foobar.com/hm/1#block')).toEqual({
        scheme: 'http',
        hostname: 'foobar.com',
        uid: '1',
        version: null,
        blockRange: {
          expanded: false,
        },
        latest: false,
        blockRef: 'block',
        id: 'hm://1',
        path: [],
      })
    })
    test('returns null for special static paths', () => {
      expect(unpackHmId('https://seed.hyper.media/hm/download')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/download?l')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/connect')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/register')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/device-link')).toBeNull()
      expect(unpackHmId('https://seed.hyper.media/hm/profile')).toBeNull()
    })
  })
})

describe('parseCustomURL', () => {
  test('parseCustomURL hm://a/b?foo=1&bar=2#block', () => {
    expect(parseCustomURL('hm://a/b?foo=1&bar=2#block')).toEqual({
      scheme: 'hm',
      path: ['a', 'b'],
      query: {foo: '1', bar: '2'},
      fragment: 'block',
    })
  })
})

describe('packHmId', () => {
  test('creates hm://abc', () => {
    expect(packHmId(hmId('abc'))).toEqual('hm://abc')
  })
  test('creates hm://123?v=foo', () => {
    expect(packHmId(hmId('123', {version: 'foo'}))).toEqual('hm://123?v=foo')
  })
  test('creates hm://123#block', () => {
    expect(packHmId(hmId('123', {blockRef: 'block'}))).toEqual('hm://123#block')
  })
  test('creates hm://123?v=foo#bar', () => {
    expect(packHmId(hmId('123', {version: 'foo', blockRef: 'bar'}))).toEqual(
      'hm://123?v=foo#bar',
    )
  })
})

describe('hmId', () => {
  test('creates hm://123/a/b?v=foo#bar', () => {
    expect(
      hmId('123', {version: 'foo', blockRef: 'bar', path: ['a', 'b']}),
    ).toEqual({
      id: 'hm://123/a/b',
      scheme: null,
      hostname: null,
      uid: '123',
      version: 'foo',
      blockRef: 'bar',
      blockRange: null,
      path: ['a', 'b'],
    })
  })
  test('creates hm://abc/def/a/b', () => {
    expect(hmId('abc/def/a/b')).toEqual({
      id: 'hm://abc/def/a/b',
      scheme: null,
      hostname: null,
      uid: 'abc',
      version: null,
      blockRef: null,
      blockRange: null,
      path: ['def', 'a', 'b'],
    })
  })
})

describe('unpackHmId - blockRef and version precedence', () => {
  test('blockRef with ?l param - blockRef takes precedence, latest=false', () => {
    // When blockRef is present, ?l should be ignored because
    // the block only exists in a specific version
    const result = unpackHmId('hm://uid?l#blockId')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: null,
      blockRange: {
        expanded: false,
      },
      blockRef: 'blockId',
      path: [],
      latest: false, // blockRef forces latest=false
    })
  })

  test('blockRef with ?v param - version is preserved, latest=false', () => {
    const result = unpackHmId('hm://uid?v=abc123#blockId')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: 'abc123',
      blockRange: {
        expanded: false,
      },
      blockRef: 'blockId',
      path: [],
      latest: false, // version is specified, so latest=false
    })
  })

  test('blockRef with both ?l and ?v params - version takes precedence', () => {
    // When both ?l and ?v are present with blockRef, version wins
    const result = unpackHmId('hm://uid?l&v=abc123#blockId')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: 'abc123',
      blockRange: {
        expanded: false,
      },
      blockRef: 'blockId',
      path: [],
      latest: false, // blockRef forces latest=false regardless of ?l
    })
  })

  test('no blockRef with ?l param - latest=true', () => {
    const result = unpackHmId('hm://uid?l')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: null,
      blockRange: null,
      blockRef: null,
      path: [],
      latest: true, // no blockRef, so ?l is respected
    })
  })

  test('expanded blockRef also forces latest=false', () => {
    // parseFragment expects 8-character block IDs
    const result = unpackHmId('hm://uid?l#XK6l8B4d+')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: null,
      blockRange: {
        expanded: true,
      },
      blockRef: 'XK6l8B4d',
      path: [],
      latest: false,
    })
  })

  test('blockRef with range also forces latest=false', () => {
    // parseFragment expects 8-character block IDs
    const result = unpackHmId('hm://uid?l#XK6l8B4d[21:41]')
    expect(result).toEqual({
      id: 'hm://uid',
      scheme: 'hm',
      hostname: null,
      uid: 'uid',
      version: null,
      blockRange: {
        start: 21,
        end: 41,
      },
      blockRef: 'XK6l8B4d',
      path: [],
      latest: false,
    })
  })
})

describe('parseFragment', () => {
  test('parses simple block reference', () => {
    expect(parseFragment('XK6l8B4d')).toEqual({
      blockId: 'XK6l8B4d',
      expanded: false,
    })
  })

  test('parses expanded block reference', () => {
    expect(parseFragment('XK6l8B4d+')).toEqual({
      blockId: 'XK6l8B4d',
      expanded: true,
    })
  })

  test('parses block range reference', () => {
    expect(parseFragment('XK6l8B4d[21:41]')).toEqual({
      blockId: 'XK6l8B4d',
      start: 21,
      end: 41,
    })
  })

  test('handles null input', () => {
    expect(parseFragment(null)).toBeNull()
  })

  test('handles invalid input', () => {
    expect(parseFragment('invalid')).toEqual({
      blockId: 'invalid',
      expanded: false,
    })
  })

  test('parses variable-length blockId with expanded suffix', () => {
    // Block IDs can be longer than 8 chars
    expect(parseFragment('UyXozrafan+')).toEqual({
      blockId: 'UyXozrafan',
      expanded: true,
    })
  })

  test('parses variable-length blockId with range suffix', () => {
    expect(parseFragment('UyXozrafan[10:20]')).toEqual({
      blockId: 'UyXozrafan',
      start: 10,
      end: 20,
    })
  })

  test('parses variable-length blockId without suffix', () => {
    expect(parseFragment('UyXozrafan')).toEqual({
      blockId: 'UyXozrafan',
      expanded: false,
    })
  })
})
