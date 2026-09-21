import {describe, expect, expectTypeOf, it} from 'vitest'
import {HM_SCHEMAS, LIBRARY_CORE, literalSchema, schemaCid, schemaForCid, validate} from './schema-engine'
import type {HMNone} from './schema-types.generated'

const none = {type: 'hm://hyper.media/none'}
const values = [null, false, true, 0, 1.5, '', 'null', [], {}, {'/': {bytes: 'QQ'}}, {'/': 'bafy'}]

describe('None, Null, and Any', () => {
  it('registers None as a valid schema with a content address and a never type', () => {
    expect(HM_SCHEMAS.none).toEqual({anyOf: []})
    expect(validate(HM_SCHEMAS.schema!, HM_SCHEMAS.none)).toEqual([])
    expect(validate(HM_SCHEMAS.schema!, none)).toEqual([])
    expect(LIBRARY_CORE.has('none')).toBe(true)
    const cid = schemaCid(none.type)
    expect(cid).toMatch(/^bafy/)
    expect(schemaForCid(cid!)).toEqual(HM_SCHEMAS.none)
    expectTypeOf<HMNone>().toEqualTypeOf<never>()
  })

  for (const value of values) {
    it(`rejects ${JSON.stringify(value)} with None, but accepts it with Any`, () => {
      const errors = ['$: no value matches an empty union (none)']
      expect(validate(none, value)).toEqual(errors)
      expect(validate({anyOf: []}, value)).toEqual(errors)
      expect(validate({type: 'hm://hyper.media/any'}, value)).toEqual([])
    })

    it(`accepts ${JSON.stringify(value)} with Null only if it is null`, () => {
      for (const schema of [literalSchema(null), {type: 'hm://hyper.media/null'}]) {
        expect(validate(schema, value).length === 0).toBe(value === null)
      }
    })
  }

  it('does not add values to a union or prevent its other alternatives from matching', () => {
    const schema = {anyOf: [none, null]}
    expect(validate(schema, null)).toEqual([])
    expect(validate(schema, false).length).toBeGreaterThan(0)
    expect(validate({anyOf: [none, {anyOf: []}]}, null).length).toBeGreaterThan(0)
  })

  it('allows only empty containers of None', () => {
    const list = {type: 'hm://hyper.media/list', items: none}
    expect(validate(list, [])).toEqual([])
    expect(validate(list, [null])).toEqual(['$[0]: no value matches an empty union (none)'])
    const map = {type: 'hm://hyper.media/map', values: none}
    expect(validate(map, {})).toEqual([])
    expect(validate(map, {extra: null})).toEqual(['$.extra: no value matches an empty union (none)'])
  })

  it('forbids additional fields without forbidding declared fields', () => {
    const schema = {
      type: 'hm://hyper.media/struct',
      properties: {name: {value: {type: 'hm://hyper.media/string'}, required: true}},
      values: none,
    }
    expect(validate(schema, {name: 'Ada'})).toEqual([])
    expect(validate(schema, {name: 'Ada', extra: null})).toEqual(['$.extra: no value matches an empty union (none)'])
  })

  it('allows an optional None field to be absent, while a required None field is unsatisfiable', () => {
    for (const required of [false, true]) {
      const schema = {
        type: 'hm://hyper.media/struct',
        properties: {forbidden: {value: none, required}},
      }
      expect(validate(schema, {})).toEqual(required ? ['$: missing required "forbidden"'] : [])
      expect(validate(schema, {forbidden: null})).toEqual(['$.forbidden: no value matches an empty union (none)'])
    }
  })
})
