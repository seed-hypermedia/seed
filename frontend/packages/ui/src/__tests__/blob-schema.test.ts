import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {describe, expect, test} from 'vitest'
import {
  BLOB_META_SCHEMA,
  BLOB_META_SCHEMA_CID,
  BlobSchema,
  collectSchemaRefs,
  findDiscriminator,
  instantiateAtPath,
  instantiateSchema,
  isSchemaBlob,
  resolveSubschema,
  SCHEMA_KEYWORDS,
  SchemaRegistry,
  validateValue,
} from '../blob-schema'
import {dagJsonToIpld} from '../dag-json'

const CID_A = 'bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'
const CID_B = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const CID_C = 'bafyreib2rxk3rybt3qgqkrqvqs2wyfhrxgqzpqvbhqjqjqjqjqjqjqjqa'

const NO_REGISTRY: SchemaRegistry = {}

describe('resolveSubschema', () => {
  const root: BlobSchema = {
    type: 'object',
    properties: {
      title: {type: 'string'},
      tags: {type: 'array', items: {type: 'string'}},
      author: {$ref: '#/$defs/Person'},
      body: {kind: 'link'},
    },
    $defs: {
      Person: {
        type: 'object',
        properties: {name: {type: 'string'}, friend: {$ref: '#/$defs/Person'}},
      },
    },
  }

  test('walks properties by string segments', () => {
    expect(resolveSubschema(root, ['title'], NO_REGISTRY)).toEqual({type: 'string'})
  })

  test('walks items by number segments', () => {
    expect(resolveSubschema(root, ['tags', 0], NO_REGISTRY)).toEqual({type: 'string'})
  })

  test('returns the root for an empty path', () => {
    expect(resolveSubschema(root, [], NO_REGISTRY)).toBe(root)
  })

  test('dereferences internal $ref before descending', () => {
    expect(resolveSubschema(root, ['author', 'name'], NO_REGISTRY)).toEqual({type: 'string'})
  })

  test('undefined for an undeclared property', () => {
    expect(resolveSubschema(root, ['missing'], NO_REGISTRY)).toBeUndefined()
  })

  test('undefined when descending items on a non-array schema', () => {
    expect(resolveSubschema(root, ['title', 0], NO_REGISTRY)).toBeUndefined()
  })

  test('recursive internal refs terminate and resolve at each finite depth', () => {
    const deep = resolveSubschema(root, ['author', 'friend', 'friend', 'name'], NO_REGISTRY)
    expect(deep).toEqual({type: 'string'})
  })

  test('a self-referential ref chain yields unresolved rather than looping', () => {
    const looped: BlobSchema = {
      type: 'object',
      properties: {a: {$ref: '#/$defs/A'}},
      $defs: {A: {$ref: '#/$defs/A'}},
    }
    expect(resolveSubschema(looped, ['a'], NO_REGISTRY)).toBe('unresolved')
  })

  test('dangling internal pointer is unresolved', () => {
    const bad: BlobSchema = {properties: {a: {$ref: '#/$defs/Nope'}}}
    expect(resolveSubschema(bad, ['a'], NO_REGISTRY)).toBe('unresolved')
  })

  test('external ref resolves through the registry', () => {
    const withExt: BlobSchema = {properties: {reviewer: {$ref: {'/': CID_A}}}}
    const registry: SchemaRegistry = {[CID_A]: {type: 'object', properties: {name: {type: 'string'}}}}
    expect(resolveSubschema(withExt, ['reviewer', 'name'], registry)).toEqual({type: 'string'})
  })

  test('missing external ref is unresolved', () => {
    const withExt: BlobSchema = {properties: {reviewer: {$ref: {'/': CID_A}}}}
    expect(resolveSubschema(withExt, ['reviewer'], NO_REGISTRY)).toBe('unresolved')
  })

  test('internal pointer after an external ref resolves within the referenced blob', () => {
    const withExt: BlobSchema = {properties: {reviewer: {$ref: {'/': CID_A}}}}
    const registry: SchemaRegistry = {
      [CID_A]: {
        type: 'object',
        properties: {manager: {$ref: '#/$defs/Person'}},
        $defs: {Person: {type: 'object', properties: {name: {type: 'string'}}}},
      },
    }
    expect(resolveSubschema(withExt, ['reviewer', 'manager', 'name'], registry)).toEqual({type: 'string'})
  })
})

describe('collectSchemaRefs', () => {
  test('collects external $ref and targetSchema links, deduped', () => {
    const schema: BlobSchema = {
      properties: {
        a: {$ref: {'/': CID_A}},
        b: {kind: 'link', targetSchema: {'/': CID_B}},
        c: {$ref: {'/': CID_A}},
        d: {$ref: '#/$defs/Local'},
      },
      items: {$ref: {'/': CID_B}},
      $defs: {Local: {type: 'string'}},
    }
    const refs = collectSchemaRefs(schema)
    expect(refs.sort()).toEqual([CID_A, CID_B].sort())
  })

  test('is transitive through registry entries already present', () => {
    const schema: BlobSchema = {properties: {a: {$ref: {'/': CID_A}}}}
    const registry: SchemaRegistry = {
      [CID_A]: {properties: {b: {$ref: {'/': CID_B}}}},
      [CID_B]: {properties: {c: {$ref: {'/': CID_C}}}},
    }
    expect(collectSchemaRefs(schema, registry).sort()).toEqual([CID_A, CID_B, CID_C].sort())
  })

  test('stops at missing registry entries but still reports them', () => {
    const schema: BlobSchema = {properties: {a: {$ref: {'/': CID_A}}}}
    expect(collectSchemaRefs(schema, {})).toEqual([CID_A])
  })

  test('empty for a schema with no external refs', () => {
    expect(collectSchemaRefs({type: 'string'})).toEqual([])
  })
})

describe('validateValue — type checks', () => {
  test('accepts matching primitive types', () => {
    expect(validateValue('hi', {type: 'string'}, NO_REGISTRY)).toEqual([])
    expect(validateValue(true, {type: 'boolean'}, NO_REGISTRY)).toEqual([])
    expect(validateValue(null, {type: 'null'}, NO_REGISTRY)).toEqual([])
    expect(validateValue([], {type: 'array'}, NO_REGISTRY)).toEqual([])
    expect(validateValue({}, {type: 'object'}, NO_REGISTRY)).toEqual([])
  })

  test('warns on type mismatch with a gentle message', () => {
    const w = validateValue(5, {type: 'string'}, NO_REGISTRY)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({keyword: 'type', message: 'expected a string', path: []})
  })

  test('integer vs number', () => {
    expect(validateValue(3, {type: 'integer'}, NO_REGISTRY)).toEqual([])
    expect(validateValue(3.5, {type: 'integer'}, NO_REGISTRY)[0]!.message).toBe('expected a whole number')
    expect(validateValue(3.5, {type: 'number'}, NO_REGISTRY)).toEqual([])
  })

  test('tolerates bigint for integer and number', () => {
    expect(validateValue(10n, {type: 'integer'}, NO_REGISTRY)).toEqual([])
    expect(validateValue(10n, {type: 'number'}, NO_REGISTRY)).toEqual([])
  })

  test('a DAG-JSON link does not satisfy type object', () => {
    const w = validateValue({'/': CID_A}, {type: 'object'}, NO_REGISTRY)
    expect(w).toHaveLength(1)
    expect(w[0]!.keyword).toBe('type')
  })

  test('unknown or malformed type keyword is ignored', () => {
    expect(validateValue(5, {type: 'weird' as never}, NO_REGISTRY)).toEqual([])
  })
})

describe('validateValue — kind checks', () => {
  test('kind link matches a link form', () => {
    expect(validateValue({'/': CID_A}, {kind: 'link'}, NO_REGISTRY)).toEqual([])
    const w = validateValue('nope', {kind: 'link'}, NO_REGISTRY)
    expect(w[0]).toMatchObject({keyword: 'kind', message: 'expected a link'})
  })

  test('kind bytes matches a bytes form', () => {
    expect(validateValue({'/': {bytes: 'AQID'}}, {kind: 'bytes'}, NO_REGISTRY)).toEqual([])
    const w = validateValue({'/': CID_A}, {kind: 'bytes'}, NO_REGISTRY)
    expect(w[0]).toMatchObject({keyword: 'kind', message: 'expected bytes'})
  })

  test('kind wins over type when both present', () => {
    // kind:link + type:object — a link value is fine, no type warning
    expect(validateValue({'/': CID_A}, {kind: 'link', type: 'object'}, NO_REGISTRY)).toEqual([])
  })

  test('maxBytes warns when the decoded payload is too large', () => {
    const big = {'/': {bytes: 'AQIDBAU'}} // 5 bytes
    expect(validateValue(big, {kind: 'bytes', maxBytes: 3}, NO_REGISTRY)[0]!.keyword).toBe('maxBytes')
    expect(validateValue(big, {kind: 'bytes', maxBytes: 5}, NO_REGISTRY)).toEqual([])
  })
})

describe('validateValue — enum / const', () => {
  test('enum member passes, non-member warns', () => {
    expect(validateValue('draft', {enum: ['draft', 'published']}, NO_REGISTRY)).toEqual([])
    expect(validateValue('x', {enum: ['draft', 'published']}, NO_REGISTRY)[0]!.keyword).toBe('enum')
  })

  test('enum uses deep equality including link/bytes forms', () => {
    expect(validateValue({'/': CID_A}, {enum: [{'/': CID_A}]}, NO_REGISTRY)).toEqual([])
    expect(validateValue({'/': CID_B}, {enum: [{'/': CID_A}]}, NO_REGISTRY)[0]!.keyword).toBe('enum')
  })

  test('const deep equality', () => {
    expect(validateValue({a: 1, b: [2]}, {const: {a: 1, b: [2]}}, NO_REGISTRY)).toEqual([])
    expect(validateValue(null, {const: null}, NO_REGISTRY)).toEqual([])
    expect(validateValue(2, {const: 1}, NO_REGISTRY)[0]!.keyword).toBe('const')
  })
})

describe('validateValue — objects', () => {
  test('missing required key warns and names the key', () => {
    const w = validateValue({}, {type: 'object', required: ['name']}, NO_REGISTRY)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({keyword: 'required', message: 'missing required property "name"', path: []})
  })

  test('recurses into declared properties with correct paths', () => {
    const schema: BlobSchema = {type: 'object', properties: {age: {type: 'integer'}}}
    const w = validateValue({age: 'old'}, schema, NO_REGISTRY)
    expect(w[0]).toMatchObject({keyword: 'type', path: ['age']})
  })

  test('additionalProperties:false warns per unknown key, path at the key', () => {
    const schema: BlobSchema = {type: 'object', properties: {a: {}}, additionalProperties: false}
    const w = validateValue({a: 1, b: 2, c: 3}, schema, NO_REGISTRY)
    expect(w).toHaveLength(2)
    expect(w.map((x) => x.path)).toEqual([['b'], ['c']])
    expect(w[0]!.keyword).toBe('additionalProperties')
  })

  test('additionalProperties:true (default) permits extra keys', () => {
    const schema: BlobSchema = {type: 'object', properties: {a: {}}, additionalProperties: true}
    expect(validateValue({a: 1, extra: 2}, schema, NO_REGISTRY)).toEqual([])
  })
})

describe('validateValue — arrays & strings & numbers', () => {
  test('items recursion and item bounds', () => {
    const schema: BlobSchema = {type: 'array', items: {type: 'string'}, minItems: 2, maxItems: 3}
    expect(validateValue(['a', 'b'], schema, NO_REGISTRY)).toEqual([])
    const short = validateValue(['a'], schema, NO_REGISTRY)
    expect(short[0]!.keyword).toBe('minItems')
    const long = validateValue(['a', 'b', 'c', 'd'], schema, NO_REGISTRY)
    expect(long[0]!.keyword).toBe('maxItems')
    const badItem = validateValue([1], {type: 'array', items: {type: 'string'}}, NO_REGISTRY)
    expect(badItem[0]).toMatchObject({keyword: 'type', path: [0]})
  })

  test('string length by code points and pattern', () => {
    const schema: BlobSchema = {type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$'}
    expect(validateValue('abc', schema, NO_REGISTRY)).toEqual([])
    expect(validateValue('a', schema, NO_REGISTRY)[0]!.keyword).toBe('minLength')
    expect(validateValue('abcde', schema, NO_REGISTRY)[0]!.keyword).toBe('maxLength')
    expect(validateValue('AB', schema, NO_REGISTRY).some((w) => w.keyword === 'pattern')).toBe(true)
    // emoji is a single code point pair — counts as its code points, not UTF-16 units
    expect(validateValue('😀😀', {type: 'string', maxLength: 2}, NO_REGISTRY)).toEqual([])
  })

  test('invalid regex in the schema is ignored', () => {
    expect(validateValue('x', {type: 'string', pattern: '('}, NO_REGISTRY)).toEqual([])
  })

  test('numeric bounds inclusive, malformed bounds ignored', () => {
    const schema: BlobSchema = {type: 'number', minimum: 0, maximum: 10}
    expect(validateValue(0, schema, NO_REGISTRY)).toEqual([])
    expect(validateValue(10, schema, NO_REGISTRY)).toEqual([])
    expect(validateValue(-1, schema, NO_REGISTRY)[0]!.keyword).toBe('minimum')
    expect(validateValue(11, schema, NO_REGISTRY)[0]!.keyword).toBe('maximum')
    expect(validateValue(5, {minimum: 'x' as never, maximum: 'y' as never}, NO_REGISTRY)).toEqual([])
  })

  test('bigint honors numeric bounds', () => {
    expect(validateValue(5n, {minimum: 0, maximum: 10}, NO_REGISTRY)).toEqual([])
    expect(validateValue(20n, {maximum: 10}, NO_REGISTRY)[0]!.keyword).toBe('maximum')
  })
})

describe('validateValue — refs', () => {
  test('validates against an internal $ref target', () => {
    const schema: BlobSchema = {
      type: 'object',
      properties: {author: {$ref: '#/$defs/Person'}},
      $defs: {Person: {type: 'object', required: ['name']}},
    }
    const w = validateValue({author: {}}, schema, NO_REGISTRY)
    expect(w[0]).toMatchObject({keyword: 'required', path: ['author']})
  })

  test('validates against an external $ref target', () => {
    const schema: BlobSchema = {type: 'object', properties: {reviewer: {$ref: {'/': CID_A}}}}
    const registry: SchemaRegistry = {[CID_A]: {type: 'string'}}
    expect(validateValue({reviewer: 5}, schema, registry)[0]).toMatchObject({keyword: 'type', path: ['reviewer']})
  })

  test('unresolved external ref produces no warning (neutral)', () => {
    const schema: BlobSchema = {type: 'object', properties: {reviewer: {$ref: {'/': CID_A}}}}
    expect(validateValue({reviewer: 5}, schema, NO_REGISTRY)).toEqual([])
  })

  test('cyclic internal ref does not warn or hang', () => {
    const schema: BlobSchema = {$ref: '#/$defs/A', $defs: {A: {$ref: '#/$defs/A'}}}
    expect(validateValue('anything', schema, NO_REGISTRY)).toEqual([])
  })
})

describe('validateValue — unknown keywords and robustness', () => {
  test('unknown keywords are silently ignored', () => {
    expect(validateValue('x', {type: 'string', madeUpKeyword: 42} as BlobSchema, NO_REGISTRY)).toEqual([])
  })

  test('never throws on garbage schemas', () => {
    const garbage = [null, undefined, 5, 'str', [], {type: 42}, {properties: 'no'}, {enum: 'no'}]
    for (const g of garbage) {
      expect(() => validateValue({any: 'value'}, g as unknown as BlobSchema, NO_REGISTRY)).not.toThrow()
    }
  })

  test('never throws and does not hang on a circular value', () => {
    const circular: Record<string, unknown> = {a: 1}
    circular.self = circular
    const schema: BlobSchema = {type: 'object', properties: {self: {type: 'string'}}}
    let out: unknown
    expect(() => {
      out = validateValue(circular, schema, NO_REGISTRY)
    }).not.toThrow()
    expect(Array.isArray(out)).toBe(true)
  })
})

describe('instantiateSchema', () => {
  test('default wins over everything', () => {
    expect(instantiateSchema({type: 'string', default: 'hi', enum: ['a']}, NO_REGISTRY)).toBe('hi')
  })

  test('const then enum head', () => {
    expect(instantiateSchema({const: 7}, NO_REGISTRY)).toBe(7)
    expect(instantiateSchema({enum: ['a', 'b']}, NO_REGISTRY)).toBe('a')
  })

  test('per-type empties', () => {
    expect(instantiateSchema({type: 'string'}, NO_REGISTRY)).toBe('')
    expect(instantiateSchema({type: 'integer'}, NO_REGISTRY)).toBe(0)
    expect(instantiateSchema({type: 'number'}, NO_REGISTRY)).toBe(0)
    expect(instantiateSchema({type: 'boolean'}, NO_REGISTRY)).toBe(false)
    expect(instantiateSchema({type: 'null'}, NO_REGISTRY)).toBe(null)
    expect(instantiateSchema({type: 'array'}, NO_REGISTRY)).toEqual([])
    expect(instantiateSchema({type: 'object'}, NO_REGISTRY)).toEqual({})
  })

  test('object seeds only required properties, recursively', () => {
    const schema: BlobSchema = {
      type: 'object',
      required: ['title', 'meta'],
      properties: {
        title: {type: 'string', default: 'Untitled'},
        optional: {type: 'string'},
        meta: {type: 'object', required: ['n'], properties: {n: {type: 'integer'}}},
      },
    }
    expect(instantiateSchema(schema, NO_REGISTRY)).toEqual({title: 'Untitled', meta: {n: 0}})
  })

  test('omits required link/bytes properties (cannot fabricate a CID/bytes)', () => {
    const schema: BlobSchema = {
      type: 'object',
      required: ['body', 'cover', 'title'],
      properties: {body: {kind: 'link'}, cover: {kind: 'bytes'}, title: {type: 'string'}},
    }
    expect(instantiateSchema(schema, NO_REGISTRY)).toEqual({title: ''})
  })

  test('link/bytes at the root returns undefined', () => {
    expect(instantiateSchema({kind: 'link'}, NO_REGISTRY)).toBeUndefined()
    expect(instantiateSchema({kind: 'bytes'}, NO_REGISTRY)).toBeUndefined()
  })

  test('no type/kind at the root returns undefined', () => {
    expect(instantiateSchema({title: 'nothing to build'}, NO_REGISTRY)).toBeUndefined()
  })

  test('recursive required type omits the cyclic branch instead of hanging', () => {
    const schema: BlobSchema = {
      type: 'object',
      required: ['name', 'self'],
      properties: {name: {type: 'string'}, self: {$ref: '#/$defs/Node'}},
      $defs: {Node: {type: 'object', required: ['self'], properties: {self: {$ref: '#/$defs/Node'}}}},
    }
    // self dereferences to Node whose only required prop refs back to Node — the
    // cycle guard omits it, leaving the object empty; the outer name is seeded.
    expect(instantiateSchema(schema, NO_REGISTRY)).toEqual({name: '', self: {}})
  })

  test('seeds a required property from an external ref target', () => {
    const schema: BlobSchema = {
      type: 'object',
      required: ['person'],
      properties: {person: {$ref: {'/': CID_A}}},
    }
    const registry: SchemaRegistry = {
      [CID_A]: {type: 'object', required: ['name'], properties: {name: {type: 'string'}}},
    }
    expect(instantiateSchema(schema, registry)).toEqual({person: {name: ''}})
  })
})

describe('isSchemaBlob', () => {
  test('true when schema key links the meta-schema CID', () => {
    expect(isSchemaBlob({schema: {'/': BLOB_META_SCHEMA_CID}, type: 'object'})).toBe(true)
  })

  test('false for other schema link targets or shapes', () => {
    expect(isSchemaBlob({schema: {'/': CID_A}})).toBe(false)
    expect(isSchemaBlob({schema: 'not-a-link'})).toBe(false)
    expect(isSchemaBlob({type: 'object'})).toBe(false)
    expect(isSchemaBlob(null)).toBe(false)
    expect(isSchemaBlob([{schema: {'/': BLOB_META_SCHEMA_CID}}])).toBe(false)
  })
})

describe('meta-schema', () => {
  test('BLOB_META_SCHEMA_CID matches the freshly computed CID of BLOB_META_SCHEMA', async () => {
    const data = cbor.encode(dagJsonToIpld(BLOB_META_SCHEMA))
    const digest = await sha256.digest(data)
    const cid = CID.createV1(0x71, digest).toString()
    expect(cid).toBe(BLOB_META_SCHEMA_CID)
  })

  test('the meta-schema carries no reserved schema key (bootstrap exception)', () => {
    expect('schema' in BLOB_META_SCHEMA).toBe(false)
  })

  test('offers type and kind enum selects for the schema editor', () => {
    expect(BLOB_META_SCHEMA.properties!.type!.enum).toContain('string')
    expect(BLOB_META_SCHEMA.properties!.kind!.enum).toEqual(['link', 'bytes'])
  })

  test('SCHEMA_KEYWORDS lists the dialect keywords', () => {
    expect(SCHEMA_KEYWORDS).toContain('type')
    expect(SCHEMA_KEYWORDS).toContain('targetSchema')
    expect(SCHEMA_KEYWORDS).toContain('$ref')
  })

  test('validating a schema against the meta-schema is clean for a well-formed schema', () => {
    const registry: SchemaRegistry = {[BLOB_META_SCHEMA_CID]: BLOB_META_SCHEMA}
    const articleSchema = {
      title: 'Article',
      type: 'object',
      required: ['title'],
      properties: {title: {type: 'string'}},
      additionalProperties: true,
    }
    expect(validateValue(articleSchema, BLOB_META_SCHEMA, registry)).toEqual([])
  })
})

describe('hardening: adversarial review fixes', () => {
  test('required/properties/additionalProperties use own properties, not the prototype chain', () => {
    // required 'toString' on {} must warn despite Object.prototype.toString
    expect(validateValue({}, {type: 'object', required: ['toString']}, {})).toHaveLength(1)
    // a declared property named 'constructor' absent from the value must not
    // produce a phantom warning against Object.prototype.constructor
    const ctorSchema = {type: 'object', properties: {constructor: {type: 'string'}}} as BlobSchema
    expect(validateValue({}, ctorSchema, {})).toEqual([])
    // additionalProperties:false must catch a real key named like a prototype member
    const warnings = validateValue({toString: 1}, {type: 'object', additionalProperties: false}, {})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.keyword).toBe('additionalProperties')
  })

  test('bigint enum/const tolerance is numeric-only', () => {
    expect(validateValue(10n, {enum: [10]}, {})).toEqual([])
    expect(validateValue(10n, {enum: ['10']}, {})).toHaveLength(1)
    expect(validateValue(1n, {enum: [true]}, {})).toHaveLength(1)
    expect(validateValue(5n, {const: '5'}, {})).toHaveLength(1)
  })

  test('catastrophic-backtracking patterns are skipped (neutral), safe patterns still warn', () => {
    const risky: BlobSchema = {type: 'string', pattern: '(a+)+$'}
    const start = Date.now()
    expect(validateValue('a'.repeat(40) + '!', risky, {})).toEqual([]) // skipped, not hung
    expect(Date.now() - start).toBeLessThan(200)
    expect(validateValue('a'.repeat(40) + '!', {type: 'string', pattern: '(?:a|a)+$'}, {})).toEqual([])
    expect(validateValue('a'.repeat(40) + '!', {type: 'string', pattern: '((a+)b)+$'}, {})).toEqual([])
    // plain patterns still validate both ways
    expect(validateValue('abc', {type: 'string', pattern: '^a'}, {})).toEqual([])
    expect(validateValue('xbc', {type: 'string', pattern: '^a'}, {})).toHaveLength(1)
    // oversized subjects are neutral
    expect(validateValue('x'.repeat(5000), {type: 'string', pattern: '^a'}, {})).toEqual([])
  })

  test('a $ref chain exceeding the depth guard is unresolved, not resolved-as-is', () => {
    const defs: Record<string, BlobSchema> = {}
    for (let i = 0; i < 250; i++) defs[`s${i}`] = {$ref: `#/$defs/s${i + 1}`}
    defs.s250 = {type: 'string'}
    const root: BlobSchema = {$defs: defs, properties: {a: {$ref: '#/$defs/s0'}}, type: 'object'}
    expect(resolveSubschema(root, ['a'], {})).toBe('unresolved')
    // unresolved is neutral: no warnings against the value
    expect(validateValue({a: 42}, root, {})).toEqual([])
  })

  test('JSON pointers can traverse arrays', () => {
    const root: BlobSchema = {
      type: 'object',
      $defs: {list: [{type: 'string'}] as any},
      properties: {a: {$ref: '#/$defs/list/0'}},
    }
    expect(resolveSubschema(root, ['a'], {})).toEqual({type: 'string'})
  })

  test('instantiateAtPath resolves internal $defs refs against the correct root', () => {
    const root: BlobSchema = {
      type: 'object',
      properties: {
        author: {
          type: 'object',
          required: ['boss'],
          properties: {boss: {$ref: '#/$defs/Person'}},
        },
      },
      $defs: {Person: {type: 'object', required: ['name'], properties: {name: {type: 'string', default: 'N'}}}},
    }
    expect(instantiateAtPath(root, ['author'], {})).toEqual({boss: {name: 'N'}})
    // the old path (instantiating the resolved subschema as its own root) lost the ref
    const sub = resolveSubschema(root, ['author'], {}) as BlobSchema
    expect(instantiateSchema(sub, {})).toEqual({})
  })
})

describe('oneOf unions', () => {
  const CIRCLE: BlobSchema = {
    type: 'object',
    required: ['kind', 'radius'],
    properties: {kind: {enum: ['circle']}, radius: {type: 'number'}},
  }
  const SQUARE: BlobSchema = {
    type: 'object',
    required: ['kind', 'side'],
    properties: {kind: {const: 'square'}, side: {type: 'number'}},
  }
  const SHAPE: BlobSchema = {oneOf: [CIRCLE, SQUARE]}

  test('a clean variant match produces no warnings', () => {
    expect(validateValue({kind: 'circle', radius: 2}, SHAPE, {})).toEqual([])
    expect(validateValue({kind: 'square', side: 3}, SHAPE, {})).toEqual([])
  })

  test('mixed-type literal unions validate any member', () => {
    const schema: BlobSchema = {enum: ['draft', 42, true, null]}
    expect(validateValue('draft', schema, {})).toEqual([])
    expect(validateValue(42, schema, {})).toEqual([])
    expect(validateValue(true, schema, {})).toEqual([])
    expect(validateValue(null, schema, {})).toEqual([])
    expect(validateValue('other', schema, {})).toHaveLength(1)
  })

  test('discriminated mismatch recurses into the tagged variant', () => {
    const warnings = validateValue({kind: 'circle', radius: 'big'}, SHAPE, {})
    expect(warnings.some((warning) => warning.path.join('.') === 'radius')).toBe(true)
    expect(warnings.some((warning) => warning.keyword === 'oneOf')).toBe(false)
  })

  test('no variant match yields one gentle summary warning', () => {
    const warnings = validateValue({kind: 'triangle'}, SHAPE, {})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.keyword).toBe('oneOf')
  })

  test('an unresolved variant makes the union check neutral', () => {
    const schema: BlobSchema = {oneOf: [{$ref: {'/': 'bafyMissing'}}, CIRCLE]}
    expect(validateValue({kind: 'nope'}, schema, {})).toEqual([])
  })

  test('external-ref variants resolve through the registry', () => {
    const registry: SchemaRegistry = {bafyCircle: CIRCLE}
    const schema: BlobSchema = {oneOf: [{$ref: {'/': 'bafyCircle'}}, SQUARE]}
    expect(validateValue({kind: 'circle', radius: 1}, schema, registry)).toEqual([])
    const warnings = validateValue({kind: 'circle', radius: 'big'}, schema, registry)
    expect(warnings.some((warning) => warning.path.join('.') === 'radius')).toBe(true)
  })

  test('collectSchemaRefs walks oneOf variants', () => {
    const schema: BlobSchema = {oneOf: [{$ref: {'/': 'bafyA'}}, {properties: {x: {$ref: {'/': 'bafyB'}}}}]}
    expect(collectSchemaRefs(schema, {}).sort()).toEqual(['bafyA', 'bafyB'])
  })

  test('instantiateSchema materializes the first variant', () => {
    expect(instantiateSchema(SHAPE, {})).toEqual({kind: 'circle', radius: 0})
  })

  test('findDiscriminator finds the shared tag and rejects non-distinct tags', () => {
    expect(findDiscriminator([CIRCLE, SQUARE])).toBe('kind')
    expect(findDiscriminator([CIRCLE, CIRCLE])).toBeUndefined()
    expect(findDiscriminator([{type: 'string'} as BlobSchema, SQUARE])).toBeUndefined()
  })
})
