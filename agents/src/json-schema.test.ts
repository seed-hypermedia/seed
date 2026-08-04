/**
 * Guards findings from live gpt-5-mini gate runs (e2e/run.ts): models declare top-level array
 * output schemas (providers 400 on non-object function parameters) and reach for the standard
 * bounds keywords (minItems/maxItems/maxLength/maximum) our bounded subset must accept.
 */
import {describe, expect, test} from 'bun:test'

import type {JsonSchema} from '@seed-hypermedia/agents-protocol'
import {validateJsonSchemaShape, validateJsonSchemaValue} from './json-schema'

describe('validateJsonSchemaShape', () => {
  test('rejects a non-object root so the error reaches the model at spawn time', () => {
    const errors = validateJsonSchemaShape({type: 'array', items: {type: 'string'}})
    expect(errors.some((e) => e.path === '$.type' && e.message.includes('type "object"'))).toBe(true)
  })

  test('accepts an object root with array properties using bounds keywords', () => {
    const schema = {
      type: 'object',
      properties: {
        items: {type: 'array', items: {type: 'string', maxLength: 80}, minItems: 1, maxItems: 5},
        score: {type: 'number', minimum: 0, maximum: 1},
      },
      required: ['items'],
    }
    expect(validateJsonSchemaShape(schema)).toEqual([])
  })

  test('non-object types remain valid below the root', () => {
    expect(validateJsonSchemaShape({type: 'array', items: {type: 'string'}}, '$.properties.list')).toEqual([])
  })
})

describe('validateJsonSchemaValue bounds', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      items: {type: 'array', items: {type: 'string', maxLength: 5}, minItems: 2, maxItems: 3},
      score: {type: 'number', maximum: 10},
    },
  }

  test('flags arrays outside minItems/maxItems and strings over maxLength', () => {
    expect(validateJsonSchemaValue(schema, {items: ['a']}).map((e) => e.message)).toEqual([
      'array shorter than minItems 2',
    ])
    expect(validateJsonSchemaValue(schema, {items: ['a', 'b', 'c', 'd']}).map((e) => e.message)).toEqual([
      'array longer than maxItems 3',
    ])
    expect(validateJsonSchemaValue(schema, {items: ['abcdef', 'b']}).map((e) => e.message)).toEqual([
      'string longer than maxLength 5',
    ])
    expect(validateJsonSchemaValue(schema, {items: ['a', 'b'], score: 11}).map((e) => e.message)).toEqual([
      'number above maximum 10',
    ])
    expect(validateJsonSchemaValue(schema, {items: ['a', 'b'], score: 10})).toEqual([])
  })
})
