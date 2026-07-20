import {describe, expect, it} from 'vitest'
import {isOnyxSchema, ONYX_SCHEMAS, validate} from '../onyx-engine'
import {onyxSubschema, parseOnyxError} from '../onyx-schema-context'
import {literalEnumOptions, suggestedFieldType} from '../onyx-value-editor-schema'

const S = (n: string) => ONYX_SCHEMAS[n]

describe('isOnyxSchema', () => {
  it('true for a real Onyx schema, false for data and for v1-dialect shapes', () => {
    expect(isOnyxSchema(S('example-person'))).toBe(true)
    expect(isOnyxSchema(S('onyx-string'))).toBe(true)
    expect(isOnyxSchema({name: 'Alice', age: 30})).toBe(false) // plain data
    expect(isOnyxSchema({type: 'object', properties: {}})).toBe(false) // v1 JSON-Schema dialect
    expect(isOnyxSchema(null)).toBe(false)
    expect(isOnyxSchema('hi')).toBe(false)
  })
})

describe('parseOnyxError', () => {
  it('parses the $.a.b[2] path prefix and the message', () => {
    expect(parseOnyxError('$.name: expected string, got integer')).toEqual({
      path: ['name'],
      message: 'expected string, got integer',
    })
    expect(parseOnyxError('$[0]: expected map, got list')).toEqual({path: [0], message: 'expected map, got list'})
    expect(parseOnyxError('$.a.b[2].c: nope')).toEqual({path: ['a', 'b', 2, 'c'], message: 'nope'})
    expect(parseOnyxError('$: matches none of the 4 variants')).toEqual({
      path: [],
      message: 'matches none of the 4 variants',
    })
  })

  it('round-trips real validate() errors into the right leaf path', () => {
    const errs = validate(S('example-geo'), {lat: 'x', lng: 0})
    expect(errs.length).toBeGreaterThan(0)
    expect(parseOnyxError(errs[0]!).path).toEqual(['lat'])
  })
})

describe('onyxSubschema', () => {
  it('descends a map to a field and resolves its ref', () => {
    const sub = onyxSubschema(S('example-person'), ['name'], {})
    expect(sub && sub !== 'unresolved' && sub.type).toBe('hm://hyper.media/string')
  })
  it('undefined for an unknown key on a closed struct', () => {
    expect(onyxSubschema(S('example-geo'), ['nope'], {})).toBeUndefined()
  })
})

describe('suggestedFieldType', () => {
  it('maps Onyx kinds to add-form field types', () => {
    expect(suggestedFieldType(S('onyx-string'))).toBe('text')
    expect(suggestedFieldType(S('onyx-integer'))).toBe('number')
    expect(suggestedFieldType(S('onyx-float'))).toBe('number')
    expect(suggestedFieldType(S('onyx-boolean'))).toBe('toggle')
    expect(suggestedFieldType(S('onyx-map'))).toBe('object')
    expect(suggestedFieldType(S('onyx-list'))).toBe('list')
    expect(suggestedFieldType(S('onyx-null'))).toBe('null')
    expect(suggestedFieldType(S('onyx-link'))).toBe('link')
    expect(suggestedFieldType(S('onyx-bytes'))).toBe('bytes')
  })
})

describe('literalEnumOptions', () => {
  it('returns dropdown options for a scalar enum', () => {
    const opts = literalEnumOptions(S('example-status')) // enum: draft/published/archived
    expect(opts?.map((o) => o.value)).toEqual(['draft', 'published', 'archived'])
  })
  it('null when there is no enum', () => {
    expect(literalEnumOptions(S('onyx-string'))).toBeNull()
  })
})
