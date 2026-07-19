import {describe, expect, test} from 'vitest'
import {HYPERMEDIA_BLOB_TYPES, hypermediaBlobType} from '../hypermedia-blob-type'

describe('hypermediaBlobType', () => {
  test.each(HYPERMEDIA_BLOB_TYPES)('recognizes a signed %s blob', (type) => {
    const value = {type, signer: {'/': {bytes: 'AAAA'}}, sig: {'/': {bytes: 'BBBB'}}, ts: 1}
    expect(hypermediaBlobType(value)).toBe(type)
  })

  test('does not match JSON-Schema-style {type: "object"} data', () => {
    expect(hypermediaBlobType({type: 'object', properties: {}})).toBeNull()
  })

  test('does not match a blob missing signer', () => {
    expect(hypermediaBlobType({type: 'Change', sig: {'/': {bytes: 'BBBB'}}})).toBeNull()
  })

  test('does not match a blob missing sig', () => {
    expect(hypermediaBlobType({type: 'Comment', signer: {'/': {bytes: 'AAAA'}}})).toBeNull()
  })

  test('does not match a non-object value', () => {
    expect(hypermediaBlobType('Change')).toBeNull()
    expect(hypermediaBlobType(42)).toBeNull()
    expect(hypermediaBlobType(null)).toBeNull()
    expect(hypermediaBlobType(undefined)).toBeNull()
  })

  test('does not match an array (even one shaped like a blob)', () => {
    expect(hypermediaBlobType([{type: 'Change', signer: 1, sig: 1}])).toBeNull()
  })

  test('does not match an unknown type string', () => {
    expect(hypermediaBlobType({type: 'Widget', signer: 1, sig: 1})).toBeNull()
  })
})
