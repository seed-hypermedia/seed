import {describe, expect, test} from 'vitest'
import {createHmId, parseCustomURL, unpackHmId} from '../entity-id-url'

describe('unpackHmId', () => {
  test('unpacks hm://a/abc', () => {
    expect(unpackHmId('hm://a/abc')).toEqual({
      id: 'hm://a/abc',
      qid: 'hm://a/abc',
      scheme: 'hm',
      hostname: null,
      type: 'a',
      eid: 'abc',
      version: null,
      blockRange: null,
      blockRef: null,
      path: [],
      latest: false,
    })
  })
  test('unpacks hm://a/foo#bar', () => {
    expect(unpackHmId('hm://a/foo#bar')).toEqual({
      id: 'hm://a/foo#bar',
      qid: 'hm://a/foo',
      scheme: 'hm',
      hostname: null,
      type: 'a',
      eid: 'foo',
      version: null,
      blockRange: null,
      blockRef: 'bar',
      path: [],
      latest: false,
    })
  })
  test('unpacks hm://a/foo?v=bar', () => {
    expect(unpackHmId('hm://a/foo?v=bar')).toEqual({
      id: 'hm://a/foo?v=bar',
      qid: 'hm://a/foo',
      scheme: 'hm',
      hostname: null,
      type: 'a',
      eid: 'foo',
      version: 'bar',
      blockRange: null,
      blockRef: null,
      path: [],
      latest: false,
    })
  })
  test('unpacks https://foobar.com/a/1?v=2', () => {
    expect(unpackHmId('https://foobar.com/a/1?v=2')).toEqual({
      scheme: 'https',
      hostname: 'foobar.com',
      type: 'a',
      eid: '1',
      version: '2',
      blockRef: null,
      blockRange: null,
      id: 'https://foobar.com/a/1?v=2',
      qid: 'hm://a/1',
      path: ['1'],
      latest: false,
    })
  })
  test('unpacks http://foobar.com/a/1#block', () => {
    expect(unpackHmId('http://foobar.com/a/1#block')).toEqual({
      scheme: 'http',
      hostname: 'foobar.com',
      type: 'a',
      eid: '1',
      version: null,
      blockRange: null,
      latest: false,
      blockRef: 'block',
      id: 'http://foobar.com/a/1#block',
      qid: 'hm://a/1',
      path: ['1'],
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
describe('createHmId', () => {
  test('creates hm://d/abc', () => {
    expect(createHmId('a', 'abc')).toEqual('hm://a/abc')
  })
  test('creates hm://g/123?v=foo', () => {
    expect(createHmId('a', '123', {version: 'foo'})).toEqual('hm://a/123?v=foo')
  })
  test('creates hm://a/123#block', () => {
    expect(createHmId('a', '123', {blockRef: 'block'})).toEqual(
      'hm://a/123#block',
    )
  })
  test('creates hm://a/123?v=foo#bar', () => {
    expect(createHmId('a', '123', {version: 'foo', blockRef: 'bar'})).toEqual(
      'hm://a/123?v=foo#bar',
    )
  })
})
