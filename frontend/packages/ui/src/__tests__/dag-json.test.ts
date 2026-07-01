import {describe, expect, test} from 'vitest'
import {base64ToBytes, bytesToBase64, dagJsonToIpld, isDagJsonBytes, isDagJsonLink} from '../dag-json'
import {CBOR_VALUE_RULES, findInvalidValue, METADATA_VALUE_RULES} from '../value-editor'

const CID_STR = 'bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'

describe('dag-json form detection', () => {
  test('detects links and bytes', () => {
    expect(isDagJsonLink({'/': CID_STR})).toBe(true)
    expect(isDagJsonBytes({'/': {bytes: 'AQID'}})).toBe(true)
  })

  test('rejects near-misses', () => {
    expect(isDagJsonLink({'/': CID_STR, extra: 1})).toBe(false)
    expect(isDagJsonLink({'/': 42})).toBe(false)
    expect(isDagJsonLink({slash: CID_STR})).toBe(false)
    expect(isDagJsonBytes({'/': {bytes: 'AQID', extra: 1}})).toBe(false)
    expect(isDagJsonBytes({'/': {notBytes: 'AQID'}})).toBe(false)
    expect(isDagJsonBytes({'/': 'AQID'})).toBe(false)
  })
})

describe('base64 helpers', () => {
  test('round-trips bytes with unpadded output', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const b64 = bytesToBase64(bytes)
    expect(b64).toBe('AQID')
    expect([...base64ToBytes(b64)]).toEqual([1, 2, 3])
  })

  test('decodes both padded and unpadded input', () => {
    expect([...base64ToBytes('AQ')]).toEqual([1])
    expect([...base64ToBytes('AQ==')]).toEqual([1])
  })

  test('throws on invalid base64', () => {
    expect(() => base64ToBytes('!!not-base64!!')).toThrow()
  })
})

describe('dagJsonToIpld', () => {
  test('converts nested links and bytes to CID and Uint8Array', () => {
    const result = dagJsonToIpld({
      link: {'/': CID_STR},
      nested: {data: {'/': {bytes: 'AQID'}}},
      items: [{'/': CID_STR}, 'plain', 42],
    }) as any
    expect(result.link.toString()).toBe(CID_STR)
    expect(result.nested.data).toBeInstanceOf(Uint8Array)
    expect([...result.nested.data]).toEqual([1, 2, 3])
    expect(result.items[0].toString()).toBe(CID_STR)
    expect(result.items[1]).toBe('plain')
    expect(result.items[2]).toBe(42)
  })

  test('throws on invalid CID links', () => {
    expect(() => dagJsonToIpld({link: {'/': 'not-a-cid'}})).toThrow()
  })
})

describe('findInvalidValue with IPLD forms', () => {
  test('CBOR rules accept valid links and bytes', () => {
    expect(findInvalidValue({'/': CID_STR}, CBOR_VALUE_RULES)).toBeNull()
    expect(findInvalidValue({'/': {bytes: 'AQID'}}, CBOR_VALUE_RULES)).toBeNull()
  })

  test('CBOR rules reject invalid links and bytes', () => {
    expect(findInvalidValue({'/': 'not-a-cid'}, CBOR_VALUE_RULES)).toMatch(/CID/)
    expect(findInvalidValue({'/': {bytes: '!!bad!!'}}, CBOR_VALUE_RULES)).toMatch(/base64/)
  })

  test('metadata rules reject IPLD forms', () => {
    expect(findInvalidValue({'/': CID_STR}, METADATA_VALUE_RULES)).toMatch(/link/)
    expect(findInvalidValue({'/': {bytes: 'AQID'}}, METADATA_VALUE_RULES)).toMatch(/bytes/)
  })
})
