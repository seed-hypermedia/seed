import {describe, expect, test} from 'vitest'
import {type BlobSchema, type SchemaRegistry} from '../blob-schema'
import {compileBlobSchemaForLLM} from '../blob-schema-compile'

const CID_A = 'bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'
const CID_B = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const NO_REGISTRY: SchemaRegistry = {}

describe('primitives and copy-through', () => {
  test('plain types pass through with bounds', () => {
    expect(compileBlobSchemaForLLM({type: 'string', minLength: 1, maxLength: 10}, NO_REGISTRY)).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 10,
    })
    expect(compileBlobSchemaForLLM({type: 'integer', minimum: 0, maximum: 5}, NO_REGISTRY)).toEqual({
      type: 'integer',
      minimum: 0,
      maximum: 5,
    })
  })

  test('composes title and description as "Title — description"', () => {
    expect(compileBlobSchemaForLLM({type: 'string', title: 'Name', description: 'the name'}, NO_REGISTRY)).toEqual({
      type: 'string',
      description: 'Name — the name',
    })
    expect(compileBlobSchemaForLLM({type: 'string', title: 'Name'}, NO_REGISTRY)).toEqual({
      type: 'string',
      description: 'Name',
    })
  })

  test('malformed numeric bounds are dropped', () => {
    expect(compileBlobSchemaForLLM({type: 'number', minimum: 'x' as never}, NO_REGISTRY)).toEqual({type: 'number'})
  })
})

describe('kinds', () => {
  test('link lowers to a described string', () => {
    expect(compileBlobSchemaForLLM({kind: 'link'}, NO_REGISTRY)).toEqual({
      type: 'string',
      description: 'IPFS CID or ipfs:// URL.',
    })
  })

  test('link names its target schema title when resolvable', () => {
    const registry: SchemaRegistry = {[CID_A]: {title: 'Article', type: 'object'}}
    expect(compileBlobSchemaForLLM({kind: 'link', targetSchema: {'/': CID_A}}, registry)).toEqual({
      type: 'string',
      description: 'IPFS CID or ipfs:// URL to a Article.',
    })
  })

  test('bytes lowers to a described string', () => {
    expect(compileBlobSchemaForLLM({kind: 'bytes'}, NO_REGISTRY)).toEqual({
      type: 'string',
      description: 'base64-encoded bytes.',
    })
  })
})

describe('formats', () => {
  test('hm-url and hm-profile', () => {
    expect(compileBlobSchemaForLLM({type: 'string', format: 'hm-url'}, NO_REGISTRY)).toEqual({
      type: 'string',
      description: 'hm:// document URL.',
    })
    expect(compileBlobSchemaForLLM({type: 'string', format: 'hm-profile'}, NO_REGISTRY)).toEqual({
      type: 'string',
      description: 'bare hm://<accountUid> account URL.',
    })
  })
})

describe('enums / literal unions', () => {
  test('keeps enum when all members are strings or numbers', () => {
    expect(compileBlobSchemaForLLM({type: 'string', enum: ['draft', 'published']}, NO_REGISTRY)).toEqual({
      type: 'string',
      enum: ['draft', 'published'],
    })
    expect(compileBlobSchemaForLLM({enum: [1, 2, 3]}, NO_REGISTRY)).toEqual({enum: [1, 2, 3]})
  })

  test('drops enum but notes values when a member is boolean/null', () => {
    const out = compileBlobSchemaForLLM({enum: ['a', true, null]}, NO_REGISTRY)
    expect(out.enum).toBeUndefined()
    expect(out.description).toBe('Allowed values: "a", true, null.')
  })
})

describe('null', () => {
  test('drops type and describes it', () => {
    expect(compileBlobSchemaForLLM({type: 'null'}, NO_REGISTRY)).toEqual({description: 'must be null.'})
  })
})

describe('pattern', () => {
  test('pattern is not emitted but noted in the description', () => {
    expect(compileBlobSchemaForLLM({type: 'string', pattern: '^[a-z]+$'}, NO_REGISTRY)).toEqual({
      type: 'string',
      description: 'Must match pattern ^[a-z]+$.',
    })
  })
})

describe('objects and arrays', () => {
  test('recurses properties, keeps required + boolean additionalProperties', () => {
    const schema: BlobSchema = {
      type: 'object',
      properties: {name: {type: 'string'}, body: {kind: 'link'}},
      required: ['name'],
      additionalProperties: false,
    }
    expect(compileBlobSchemaForLLM(schema, NO_REGISTRY)).toEqual({
      type: 'object',
      properties: {
        name: {type: 'string'},
        body: {type: 'string', description: 'IPFS CID or ipfs:// URL.'},
      },
      required: ['name'],
      additionalProperties: false,
    })
  })

  test('recurses items and notes minItems', () => {
    const schema: BlobSchema = {type: 'array', items: {type: 'string'}, minItems: 2}
    expect(compileBlobSchemaForLLM(schema, NO_REGISTRY)).toEqual({
      type: 'array',
      items: {type: 'string'},
      description: 'At least 2 items.',
    })
  })
})

describe('oneOf unions', () => {
  test('describes variants; keeps a shared type when all agree', () => {
    const schema: BlobSchema = {
      oneOf: [
        {type: 'string', title: 'Slug'},
        {type: 'string', title: 'Full URL'},
      ],
    }
    expect(compileBlobSchemaForLLM(schema, NO_REGISTRY)).toEqual({
      type: 'string',
      description: 'One of: Slug; Full URL.',
    })
  })

  test('drops type when variants disagree', () => {
    const schema: BlobSchema = {oneOf: [{type: 'string'}, {type: 'integer'}]}
    const out = compileBlobSchemaForLLM(schema, NO_REGISTRY)
    expect(out.type).toBeUndefined()
    expect(out.description).toBe('One of: string; integer.')
  })
})

describe('$ref inlining', () => {
  test('inlines an internal $ref before lowering', () => {
    const schema: BlobSchema = {
      type: 'object',
      properties: {author: {$ref: '#/$defs/Person'}},
      $defs: {Person: {type: 'object', properties: {name: {type: 'string'}}}},
    }
    expect(compileBlobSchemaForLLM(schema, NO_REGISTRY)).toEqual({
      type: 'object',
      properties: {author: {type: 'object', properties: {name: {type: 'string'}}}},
    })
  })

  test('inlines an external $ref from the registry', () => {
    const schema: BlobSchema = {type: 'object', properties: {reviewer: {$ref: {'/': CID_A}}}}
    const registry: SchemaRegistry = {[CID_A]: {type: 'string', title: 'Reviewer'}}
    expect(compileBlobSchemaForLLM(schema, registry)).toEqual({
      type: 'object',
      properties: {reviewer: {type: 'string', description: 'Reviewer'}},
    })
  })

  test('a missing external ref lowers to a permissive described node', () => {
    const schema: BlobSchema = {type: 'object', properties: {reviewer: {$ref: {'/': CID_A}}}}
    expect(compileBlobSchemaForLLM(schema, NO_REGISTRY)).toEqual({
      type: 'object',
      properties: {reviewer: {description: 'unresolved reference'}},
    })
  })

  test('a cyclic internal ref is guarded, not looped', () => {
    const schema: BlobSchema = {
      type: 'object',
      properties: {self: {$ref: '#/$defs/Node'}},
      $defs: {Node: {type: 'object', properties: {self: {$ref: '#/$defs/Node'}}}},
    }
    // The cycle terminates: the inner self resolves once then hits the guard,
    // lowering to a permissive node.
    const out = compileBlobSchemaForLLM(schema, NO_REGISTRY)
    expect(out.type).toBe('object')
    expect(out.properties!.self!.type).toBe('object')
  })
})

describe('robustness', () => {
  test('never throws on garbage', () => {
    const garbage = [null, undefined, 5, 'str', [], {type: 42}, {properties: 'no'}, {oneOf: 'no'}]
    for (const g of garbage) {
      expect(() => compileBlobSchemaForLLM(g as unknown as BlobSchema, NO_REGISTRY)).not.toThrow()
    }
  })

  test('a node with no type/kind lowers to an empty (or description-only) schema', () => {
    expect(compileBlobSchemaForLLM({}, NO_REGISTRY)).toEqual({})
    expect(compileBlobSchemaForLLM({description: 'hi'}, NO_REGISTRY)).toEqual({description: 'hi'})
  })
})

describe('end-to-end: an Article-like schema', () => {
  test('lowers link/bytes/hm/enum/union fields honestly', () => {
    const registry: SchemaRegistry = {[CID_B]: {title: 'Author', type: 'object'}}
    const article: BlobSchema = {
      type: 'object',
      title: 'Article',
      description: 'A published article.',
      properties: {
        title: {type: 'string', minLength: 1},
        status: {type: 'string', enum: ['draft', 'published']},
        cover: {kind: 'link', targetSchema: {'/': CID_B}},
        thumbnail: {kind: 'bytes'},
        author: {type: 'string', format: 'hm-profile'},
        home: {type: 'string', format: 'hm-url'},
        priority: {
          oneOf: [
            {type: 'integer', title: 'Rank'},
            {type: 'string', title: 'Label'},
          ],
        },
      },
      required: ['title'],
      additionalProperties: true,
    }
    expect(compileBlobSchemaForLLM(article, registry)).toEqual({
      type: 'object',
      description: 'Article — A published article.',
      properties: {
        title: {type: 'string', minLength: 1},
        status: {type: 'string', enum: ['draft', 'published']},
        cover: {type: 'string', description: 'IPFS CID or ipfs:// URL to a Author.'},
        thumbnail: {type: 'string', description: 'base64-encoded bytes.'},
        author: {type: 'string', description: 'bare hm://<accountUid> account URL.'},
        home: {type: 'string', description: 'hm:// document URL.'},
        priority: {description: 'One of: Rank; Label.'},
      },
      required: ['title'],
      additionalProperties: true,
    })
  })
})
