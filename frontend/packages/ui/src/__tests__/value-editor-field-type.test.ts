import {describe, expect, test} from 'vitest'
import {CBOR_VALUE_RULES, METADATA_VALUE_RULES, coerceFieldValue, valueToFieldType} from '../value-editor'

describe('valueToFieldType', () => {
  test('maps each value shape to its field type', () => {
    expect(valueToFieldType('hi')).toBe('text')
    expect(valueToFieldType(3)).toBe('number')
    expect(valueToFieldType(true)).toBe('toggle')
    expect(valueToFieldType(null)).toBe('null')
    expect(valueToFieldType(undefined)).toBe('null')
    expect(valueToFieldType([])).toBe('list')
    expect(valueToFieldType({a: 1})).toBe('object')
  })

  test('recognizes DAG-JSON link and bytes leaves before plain objects', () => {
    expect(valueToFieldType({'/': 'bafyabc'})).toBe('link')
    expect(valueToFieldType({'/': {bytes: 'AAAA'}})).toBe('bytes')
  })
})

describe('coerceFieldValue (preserve when compatible, else reset)', () => {
  test('same type is returned untouched', () => {
    const obj = {a: 1}
    expect(coerceFieldValue(obj, 'object', CBOR_VALUE_RULES)).toBe(obj)
    expect(coerceFieldValue('x', 'text', CBOR_VALUE_RULES)).toBe('x')
  })

  test('number <-> text round-trips losslessly', () => {
    expect(coerceFieldValue(42, 'text', CBOR_VALUE_RULES)).toBe('42')
    expect(coerceFieldValue('42', 'number', CBOR_VALUE_RULES)).toBe(42)
  })

  test('non-numeric text falls back to 0 when retyped to number', () => {
    expect(coerceFieldValue('hello', 'number', CBOR_VALUE_RULES)).toBe(0)
  })

  test('integer rules reject a fractional text; float rules keep it', () => {
    expect(coerceFieldValue('1.5', 'number', METADATA_VALUE_RULES)).toBe(0)
    expect(coerceFieldValue('1.5', 'number', CBOR_VALUE_RULES)).toBe(1.5)
  })

  test('boolean coerces across text and number', () => {
    expect(coerceFieldValue(true, 'text', CBOR_VALUE_RULES)).toBe('true')
    expect(coerceFieldValue('true', 'toggle', CBOR_VALUE_RULES)).toBe(true)
    expect(coerceFieldValue('nope', 'toggle', CBOR_VALUE_RULES)).toBe(false)
    expect(coerceFieldValue(0, 'toggle', CBOR_VALUE_RULES)).toBe(false)
    expect(coerceFieldValue(2, 'toggle', CBOR_VALUE_RULES)).toBe(true)
  })

  test('a valid CID string becomes a link; otherwise an empty link', () => {
    const cid = 'bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'
    expect(coerceFieldValue(cid, 'link', CBOR_VALUE_RULES)).toEqual({'/': cid})
    expect(coerceFieldValue(`ipfs://${cid}`, 'link', CBOR_VALUE_RULES)).toEqual({'/': cid})
    expect(coerceFieldValue('not-a-cid', 'link', CBOR_VALUE_RULES)).toEqual({'/': ''})
  })

  test('incompatible container conversions reset to the target default', () => {
    expect(coerceFieldValue({a: 1}, 'list', CBOR_VALUE_RULES)).toEqual([])
    expect(coerceFieldValue([1, 2], 'object', CBOR_VALUE_RULES)).toEqual({})
    expect(coerceFieldValue('x', 'null', CBOR_VALUE_RULES)).toBe(null)
    expect(coerceFieldValue({a: 1}, 'bytes', CBOR_VALUE_RULES)).toEqual({'/': {bytes: ''}})
  })
})
