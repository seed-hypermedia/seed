import {describe, expect, test} from 'vitest'
import type {BlobSchema} from '../blob-schema'
import {
  addProperty,
  isRequiredProperty,
  removeProperty,
  renameProperty,
  schemaNodeKind,
  setRequiredProperty,
  setSchemaKeyword,
  setSchemaNodeKind,
} from '../blob-schema-edit'

describe('schemaNodeKind', () => {
  test('classifies identity keywords with $ref > kind > type precedence', () => {
    expect(schemaNodeKind({type: 'object'})).toBe('object')
    expect(schemaNodeKind({type: 'string'})).toBe('text')
    expect(schemaNodeKind({type: 'integer'})).toBe('integer')
    expect(schemaNodeKind({type: 'number'})).toBe('number')
    expect(schemaNodeKind({type: 'boolean'})).toBe('toggle')
    expect(schemaNodeKind({type: 'array'})).toBe('list')
    expect(schemaNodeKind({type: 'null'})).toBe('null')
    expect(schemaNodeKind({kind: 'link'})).toBe('link')
    expect(schemaNodeKind({kind: 'bytes'})).toBe('bytes')
    expect(schemaNodeKind({$ref: '#/$defs/X'})).toBe('ref')
    expect(schemaNodeKind({$ref: {'/': 'bafyX'}})).toBe('ref')
    expect(schemaNodeKind({})).toBe('any')
    // kind wins over type (dialect: mutually exclusive, kind takes precedence)
    expect(schemaNodeKind({type: 'object', kind: 'link'} as BlobSchema)).toBe('link')
  })
})

describe('setSchemaNodeKind', () => {
  test('changes only identity keywords, preserving everything else', () => {
    const node: BlobSchema = {type: 'string', minLength: 2, title: 'Name', customKeyword: true}
    const asObject = setSchemaNodeKind(node, 'object')
    expect(asObject.type).toBe('object')
    expect(asObject.kind).toBeUndefined()
    expect(asObject.minLength).toBe(2) // inert but preserved
    expect(asObject.title).toBe('Name')
    expect(asObject.customKeyword).toBe(true)
    // switching back restores the original semantics
    expect(setSchemaNodeKind(asObject, 'text')).toEqual(node)
  })

  test('kind and ref forms', () => {
    expect(setSchemaNodeKind({type: 'string'}, 'link')).toEqual({kind: 'link'})
    expect(setSchemaNodeKind({type: 'string'}, 'bytes')).toEqual({kind: 'bytes'})
    expect(setSchemaNodeKind({type: 'string'}, 'ref')).toEqual({$ref: ''})
    expect(setSchemaNodeKind({kind: 'link'}, 'any')).toEqual({})
  })
})

describe('required toggles', () => {
  const parent: BlobSchema = {type: 'object', properties: {a: {}, b: {}}, required: ['a']}

  test('isRequiredProperty', () => {
    expect(isRequiredProperty(parent, 'a')).toBe(true)
    expect(isRequiredProperty(parent, 'b')).toBe(false)
  })

  test('setRequiredProperty adds, removes, and drops an empty list', () => {
    expect(setRequiredProperty(parent, 'b', true).required).toEqual(['a', 'b'])
    expect(setRequiredProperty(parent, 'a', true).required).toEqual(['a']) // idempotent
    expect(setRequiredProperty(parent, 'a', false).required).toBeUndefined()
  })
})

describe('property operations', () => {
  const parent: BlobSchema = {
    type: 'object',
    properties: {title: {type: 'string'}, body: {kind: 'link'}},
    required: ['title'],
  }

  test('renameProperty preserves order and required membership', () => {
    const renamed = renameProperty(parent, 'title', 'headline')
    expect(Object.keys(renamed.properties!)).toEqual(['headline', 'body'])
    expect(renamed.required).toEqual(['headline'])
    // collisions, empty, and "/" are refused (unchanged object back)
    expect(renameProperty(parent, 'title', 'body')).toBe(parent)
    expect(renameProperty(parent, 'title', '')).toBe(parent)
    expect(renameProperty(parent, 'title', '/')).toBe(parent)
  })

  test('removeProperty clears required and drops empty containers', () => {
    const removed = removeProperty(parent, 'title')
    expect(removed.properties).toEqual({body: {kind: 'link'}})
    expect(removed.required).toBeUndefined()
    const emptied = removeProperty(removeProperty(parent, 'title'), 'body')
    expect(emptied.properties).toBeUndefined()
  })

  test('addProperty rejects duplicates, empty, and "/"', () => {
    expect(addProperty(parent, 'tags', {type: 'array'})!.properties!.tags).toEqual({type: 'array'})
    expect(addProperty(parent, 'title', {})).toBeNull()
    expect(addProperty(parent, '', {})).toBeNull()
    expect(addProperty(parent, '/', {})).toBeNull()
  })
})

describe('setSchemaKeyword', () => {
  test('sets and clears keywords without touching others', () => {
    const node: BlobSchema = {type: 'string', minLength: 1}
    expect(setSchemaKeyword(node, 'maxLength', 5)).toEqual({type: 'string', minLength: 1, maxLength: 5})
    expect(setSchemaKeyword(node, 'minLength', undefined)).toEqual({type: 'string'})
  })
})
