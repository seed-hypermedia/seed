import {describe, expect, it} from 'vitest'
import {HM_SCHEMAS, isHypermediaSchema, kindOf, requiredFieldNames, validate} from '../engine'
import {documentMetadataSchema} from '../metadata-schema-keys'
import {subschemaAt, parseSchemaError} from '../schema-context'
import {literalOptions, suggestedFieldType} from '../value-editor-schema'

const S = (n: string) => HM_SCHEMAS[n]

describe('isHypermediaSchema', () => {
  it('true for a real Hypermedia schema, false for data and for v1-dialect shapes', () => {
    expect(isHypermediaSchema(S('example/person'))).toBe(true)
    expect(isHypermediaSchema(S('string'))).toBe(true)
    expect(isHypermediaSchema({name: 'Alice', age: 30})).toBe(false) // plain data
    expect(isHypermediaSchema({type: 'object', properties: {}})).toBe(false) // v1 JSON-Schema dialect
    expect(isHypermediaSchema(null)).toBe(false)
    expect(isHypermediaSchema('hi')).toBe(false)
  })
})

describe('parseSchemaError', () => {
  it('parses the $.a.b[2] path prefix and the message', () => {
    expect(parseSchemaError('$.name: expected string, got integer')).toEqual({
      path: ['name'],
      message: 'expected string, got integer',
    })
    expect(parseSchemaError('$[0]: expected map, got list')).toEqual({path: [0], message: 'expected map, got list'})
    expect(parseSchemaError('$.a.b[2].c: nope')).toEqual({path: ['a', 'b', 2, 'c'], message: 'nope'})
    expect(parseSchemaError('$: matches none of the 4 variants')).toEqual({
      path: [],
      message: 'matches none of the 4 variants',
    })
  })

  it('round-trips real validate() errors into the right leaf path', () => {
    const errs = validate(S('example/geo'), {lat: 'x', lng: 0})
    expect(errs.length).toBeGreaterThan(0)
    expect(parseSchemaError(errs[0]!).path).toEqual(['lat'])
  })
})

describe('subschemaAt', () => {
  it('descends a map to a field and resolves its ref', () => {
    const sub = subschemaAt(S('example/person'), ['name'], {})
    expect(sub && sub !== 'unresolved' && kindOf(sub.type)).toBe('string')
  })
  it('undefined for an unknown key on a closed struct', () => {
    expect(subschemaAt(S('example/geo'), ['nope'], {})).toBeUndefined()
  })
})

describe('suggestedFieldType', () => {
  it('maps kinds to add-form field types', () => {
    expect(suggestedFieldType(S('string'))).toBe('text')
    expect(suggestedFieldType(S('integer'))).toBe('number')
    expect(suggestedFieldType(S('float'))).toBe('number')
    expect(suggestedFieldType(S('boolean'))).toBe('toggle')
    expect(suggestedFieldType(S('map'))).toBe('object')
    expect(suggestedFieldType(S('list'))).toBe('list')
    expect(suggestedFieldType(S('null'))).toBe('null')
    expect(suggestedFieldType(S('link'))).toBe('link')
    expect(suggestedFieldType(S('bytes'))).toBe('bytes')
  })
})

describe('documentMetadataSchema (document-schema extension)', () => {
  it('inherits the base metadata fields and adds the document type fields', () => {
    const merged = documentMetadataSchema(S('example/employee'))
    // inherited from hypermedia-metadata (the base document schema)
    expect(merged.properties).toHaveProperty('name')
    expect(merged.properties).toHaveProperty('summary')
    // added by the employee schema (which extends example-person)
    expect(merged.properties).toHaveProperty('employeeId')
    expect(merged.properties).toHaveProperty('department')
    expect(merged.properties).toHaveProperty('name') // person's name too, same key
    // employee's required field surfaces as required
    expect(requiredFieldNames(merged)).toContain('employeeId')
    // open: arbitrary keys (e.g. schemaDefinition itself) are accepted
    expect(merged.values).toEqual({})
    expect(
      validate(merged, {name: 'Acme Co', schemaDefinition: 'ipfs://x', employeeId: '7', department: 'Eng'}),
    ).toEqual([])
  })

  it('folds in schema-keyed extra properties', () => {
    const merged = documentMetadataSchema(S('example/geo'), {'ipfs://cidkey': S('string')})
    expect(merged.properties).toHaveProperty('ipfs://cidkey')
  })
})

describe('literalOptions', () => {
  it('returns dropdown options for a union of literals', () => {
    const opts = literalOptions(S('example/status')) // anyOf: draft/published/archived
    expect(opts?.map((o) => o.value)).toEqual(['draft', 'published', 'archived'])
  })
  it('null when the schema is not a union of literals', () => {
    expect(literalOptions(S('string'))).toBeNull()
  })
})
