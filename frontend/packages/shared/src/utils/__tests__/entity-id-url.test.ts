import {describe, expect, test} from 'vitest'
import {hmId, packHmId, parseCustomURL, unpackHmId} from '../entity-id-url'

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
      latest: false,
    })
  })
  test('unpacks hm://foo#bar', () => {
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
    test('unpacks http://foobar.com/hm/1#block', () => {
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
