import {describe, expect, test} from 'vitest'
import {validateValue, resolveSubschema, instantiateSchema, collectSchemaRefs, BLOB_META_SCHEMA} from '../blob-schema'
import type {BlobSchema} from '../blob-schema'

const log = (label: string, v: unknown) => console.log(label, JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) + 'n' : x)))

describe('probes', () => {
  test('cycles and pointers', () => {
    const selfRef: BlobSchema = {$ref: '#'}
    log('selfRef validate:', validateValue('x', selfRef, {}))
    log('selfRef resolve:', resolveSubschema(selfRef, [], {}))
    const ab: BlobSchema = {$defs: {A: {$ref: '#/$defs/B'}, B: {$ref: '#/$defs/A'}}, $ref: '#/$defs/A'}
    log('A<->B validate:', validateValue('x', ab, {}))
    const person: BlobSchema = {type: 'object', required: ['name'], properties: {name: {type: 'string'}, friend: {$ref: '#'}}}
    log('recursive person warnings:', validateValue({name: 'a', friend: {friend: {}}}, person, {}))
    log('#/ resolves:', resolveSubschema({$ref: '#/', type: 'string'}, [], {}))
    const esc: BlobSchema = {$defs: {'a/b': {type: 'string'}, 'a~b': {type: 'integer'}}, properties: {x: {$ref: '#/$defs/a~1b'}, y: {$ref: '#/$defs/a~0b'}}}
    log('escaped ~1:', resolveSubschema(esc, ['x'], {}))
    log('escaped ~0:', resolveSubschema(esc, ['y'], {}))
    const arrPtr: BlobSchema = {$defs: {list: [{type: 'string'}] as any}, properties: {x: {$ref: '#/$defs/list/0'}}}
    log('pointer into array:', resolveSubschema(arrPtr, ['x'], {}))
  })
  test('external ref root switching', () => {
    const extBlob: BlobSchema = {$defs: {Name: {type: 'string', minLength: 2}}, type: 'object', properties: {n: {$ref: '#/$defs/Name'}}}
    const rootS: BlobSchema = {type: 'object', properties: {p: {$ref: {'/': 'cidExt'}}}}
    log('ext then internal resolve:', resolveSubschema(rootS, ['p', 'n'], {cidExt: extBlob}))
    log('ext then internal warnings:', validateValue({p: {n: 'x'}}, rootS, {cidExt: extBlob}))
  })
  test('kinds vs type object, deepEqual bigint', () => {
    log('link vs type object:', validateValue({'/': 'bafy'}, {type: 'object'}, {}))
    log('bytes vs type object:', validateValue({'/': {bytes: 'aGk'}}, {type: 'object'}, {}))
    log('enum ["1"] vs 1n:', validateValue(1n, {enum: ['1']}, {}))
    log('enum [true] vs 1n:', validateValue(1n, {enum: [true]}, {}))
    log('const "5" vs 5n:', validateValue(5n, {const: '5'}, {}))
  })
  test('instantiate + misc', () => {
    const rec: BlobSchema = {type: 'object', required: ['self', 'name'], properties: {self: {$ref: '#'}, name: {type: 'string'}}}
    log('instantiate recursive:', instantiateSchema(rec, {}))
    log('bad base64 maxBytes:', validateValue({'/': {bytes: '!!!not-base64!!!'}}, {kind: 'bytes', maxBytes: 2}, {}))
    log('aP false w/ schema key:', validateValue({schema: {'/': 'cidS'}, a: 1}, {type: 'object', properties: {a: {}}, additionalProperties: false}, {}))
    const s2: BlobSchema = {properties: {q: {$ref: {'/': 'cid3'}}}}
    const s1: BlobSchema = {properties: {p: {$ref: {'/': 'cid2'}}, l: {kind: 'link', targetSchema: {'/': 'cidT'}}}}
    log('refs no registry:', collectSchemaRefs(s1))
    log('refs w/ registry:', collectSchemaRefs(s1, {cid2: s2}))
    log('required null:', validateValue({name: null}, {type: 'object', required: ['name'], properties: {name: {type: 'string'}}}, {}))
    log('bigint minLength keyword:', validateValue('a', {type: 'string', minLength: 5n as any}, {}))
    // instantiate through resolved-subschema (root loss)
    const withDefs: BlobSchema = {$defs: {N: {type: 'string', default: 'seeded'}}, type: 'object', properties: {person: {type: 'object', required: ['n'], properties: {n: {$ref: '#/$defs/N'}}}}}
    const resolved = resolveSubschema(withDefs, ['person'], {})
    log('instantiate from resolved subschema (root lost):', instantiateSchema(resolved as BlobSchema, {}))
    log('instantiate from root, whole:', instantiateSchema(withDefs, {}))
  })
  test('meta-schema honesty', () => {
    log('meta vs meta:', validateValue(BLOB_META_SCHEMA, BLOB_META_SCHEMA, {}))
    const bad = {type: 'strnig', required: [1, 2], properties: 'nope', kind: 'lnik'}
    log('meta vs bad schema:', validateValue(bad, BLOB_META_SCHEMA, {}))
  })
  test('pattern backtracking timing', () => {
    const schema: BlobSchema = {type: 'string', pattern: '(a+)+$'}
    const value = 'a'.repeat(28) + 'b'
    const t0 = performance.now()
    const w = validateValue(value, schema, {})
    const ms = performance.now() - t0
    console.log('pattern (a+)+$ on 28 a\'s + b took ms:', ms.toFixed(0), 'warnings:', w.length)
    expect(ms).toBeGreaterThan(0)
  }, 120000)
})
