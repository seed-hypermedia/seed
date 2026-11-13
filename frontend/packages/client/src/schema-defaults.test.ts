import {describe, expect, it} from 'vitest'
import {
  HM_SCHEMAS,
  collectRefs,
  fieldsToProperties,
  isHypermediaSchema,
  missingPropertyDefaults,
  propertyDefaults,
  resolveSchema,
  schemaErrors,
  seedField,
  seedValue,
  structFields,
  validate,
  validateDefaults,
  type HypermediaSchema,
  type SchemaRegistry,
} from './schema-engine'
import {externalSchemaRefs, newDocumentDefaults} from './schema-resolve'
import {unpackHmId} from './hm-types'
import {encodeDagCbor} from './signed-blob'

const U = (kind: string) => `hm://hyper.media/${kind}`
const struct = (properties: Record<string, any>, extra: Record<string, any> = {}): HypermediaSchema => ({
  type: U('struct'),
  properties,
  ...extra,
})
const withDefault = (value: any, def: unknown, extra: Record<string, any> = {}) =>
  struct({a: {value, default: def, ...extra}})
const task = HM_SCHEMAS['example/task-doc']!

describe('property defaults: the schema', () => {
  it('a property with a default is a valid schema, whatever kind the default is', () => {
    for (const [value, def] of [
      [{type: U('string')}, 'todo'],
      [{type: U('null')}, null],
      [{type: U('boolean')}, false],
      [{type: U('integer')}, 0],
      [{type: U('list'), items: {type: U('string')}}, ['a']],
      [{type: U('map'), values: {type: U('integer')}}, {n: 1}],
      [{type: U('link')}, {'/': 'bafy'}],
    ] as const) {
      const schema = withDefault(value, def)
      expect(isHypermediaSchema(schema)).toBe(true)
      expect(schemaErrors(schema)).toEqual([])
    }
  })

  it('reads a default off a property and writes it back, keeping null, false, 0 and empty values', () => {
    for (const def of [null, false, 0, '', [], {}]) {
      const field = structFields(withDefault({}, def))[0]!
      expect('default' in field).toBe(true)
      expect(field.default).toEqual(def)
      expect(fieldsToProperties([field]).a).toEqual({value: {}, default: def})
    }
    const plain = structFields(struct({a: {value: {type: U('string')}}}))[0]!
    expect('default' in plain).toBe(false)
    expect(fieldsToProperties([plain]).a).toEqual({value: {type: U('string')}})
  })

  it('checks every default against its own property', () => {
    expect(validateDefaults(withDefault({type: U('string')}, 'todo'))).toEqual([])
    expect(validateDefaults(withDefault({type: U('string')}, 3))).toEqual([
      '$.properties.a.default: expected string, got integer',
    ])
    expect(validateDefaults(withDefault({anyOf: ['todo', 'done']}, 'todo'))).toEqual([])
    expect(validateDefaults(withDefault({anyOf: ['todo', 'done']}, 'later'))[0]).toContain('$.properties.a.default')
    expect(validateDefaults(withDefault({type: U('integer'), minimum: 1}, 0))).toHaveLength(1)
    expect(validateDefaults(withDefault({type: U('list'), items: {type: U('string')}}, ['a', 1]))).toEqual([
      '$.properties.a.default[1]: expected string, got integer',
    ])
    expect(validateDefaults(withDefault({type: U('link')}, {'/': 'bafy'}))).toEqual([])
    expect(validateDefaults(withDefault({type: U('link')}, 'bafy'))).toHaveLength(1)
    // A reference is a string: its default is the URL itself and is never fetched.
    expect(
      validateDefaults(withDefault({type: U('hm-url'), target: 'hm://acme/types/place'}, 'hm://acme/places/home')),
    ).toEqual([])
  })

  it('finds a bad default at any depth and names where it is', () => {
    const inner = struct({n: {value: {type: U('integer')}, default: 'one'}})
    expect(validateDefaults(struct({a: {value: inner}}))).toEqual([
      '$.properties.a.value.properties.n.default: expected integer, got string',
    ])
    expect(validateDefaults({type: U('list'), items: inner})[0]).toContain('$.items.properties.n.default')
    expect(validateDefaults({type: U('map'), values: inner})[0]).toContain('$.values.properties.n.default')
    expect(validateDefaults({anyOf: [{type: U('string')}, inner]})[0]).toContain('$.anyOf[1].properties.n.default')
  })

  it('checks a default on a type-parameter field against the parameter', () => {
    const generic = (def: unknown) => ({params: {T: {type: U('integer')}}, ...withDefault({var: 'T'}, def)})
    expect(validateDefaults(generic(1))).toEqual([])
    expect(validateDefaults(generic('x'))).toHaveLength(1)
  })

  it('a struct default must be a valid value of the nested struct', () => {
    const nested = struct({n: {value: {type: U('integer')}, required: true, default: 1}})
    expect(validateDefaults(withDefault(nested, {n: 2}))).toEqual([])
    expect(validateDefaults(withDefault(nested, {}))).toEqual(['$.properties.a.default: missing required "n"'])
  })

  it('schemaErrors reports meta-schema violations first, then defaults', () => {
    expect(schemaErrors({type: U('string'), items: {}})[0]).toContain('matches none')
    expect(schemaErrors(withDefault({type: U('string')}, 3))).toEqual([
      '$.properties.a.default: expected string, got integer',
    ])
    for (const [name, schema] of Object.entries(HM_SCHEMAS)) expect([name, schemaErrors(schema)]).toEqual([name, []])
  })

  it('a default is data: it is never read as a schema reference', () => {
    const schema = withDefault({type: U('map'), values: {}}, {type: 'hm://acme/not-a-schema', target: 'x'})
    expect(externalSchemaRefs(schema)).toEqual([])
    expect([...collectRefs(schema)].sort()).toEqual(['map', 'struct'])
  })
})

describe('property defaults: validation never uses them', () => {
  it('a required field with a default is still required of a value', () => {
    const schema = withDefault({type: U('string')}, 'todo', {required: true})
    expect(validate(schema, {})).toEqual(['$: missing required "a"'])
    expect(validate(schema, {a: 'done'})).toEqual([])
  })
  it('an optional field with a default may be absent', () => {
    expect(validate(withDefault({type: U('string')}, 'todo'), {})).toEqual([])
  })
})

describe('property defaults: a new value', () => {
  it('starts from every default, required or optional, and leaves out optional fields without one', () => {
    expect(seedValue(task)).toEqual({status: 'todo', priority: 2, tags: [], checklist: {done: false, steps: []}})
    expect(validate(task, seedValue(task))).toEqual([])
  })

  it('seeds a required field without a default from its schema, as before', () => {
    const schema = struct({a: {value: {type: U('string')}, required: true}, b: {value: {type: U('string')}}})
    expect(seedValue(schema)).toEqual({a: ''})
  })

  it('uses a struct property default whole, without merging the nested defaults', () => {
    const nested = struct({
      n: {value: {type: U('integer')}, required: true, default: 1},
      label: {value: {type: U('string')}, default: 'none'},
    })
    expect(seedValue(struct({a: {value: nested, required: true}}))).toEqual({a: {n: 1, label: 'none'}})
    expect(seedValue(withDefault(nested, {n: 7}))).toEqual({a: {n: 7}})
  })

  it('hands out a copy, so editing the new value leaves the schema alone', () => {
    const seeded = seedValue(task) as {tags: string[]}
    seeded.tags.push('x')
    expect(structFields(task).find((f) => f.name === 'tags')!.default).toEqual([])
  })

  it('an extension inherits defaults, replaces one by restating the property, and can drop one', () => {
    const adds = {type: U('example/task-doc'), properties: {owner: {value: {type: U('string')}, default: 'nobody'}}}
    expect(seedValue(adds)).toMatchObject({status: 'todo', priority: 2, owner: 'nobody'})
    const replaces = {
      type: U('example/task-doc'),
      properties: {status: {value: {type: U('example/task-status')}, default: 'doing'}},
    }
    expect((seedValue(replaces) as any).status).toBe('doing')
    const drops = {type: U('example/task-doc'), properties: {priority: {value: {type: U('integer')}}}}
    expect('priority' in (seedValue(drops) as object)).toBe(false)
    expect(structFields(resolveSchema(adds).schema).find((f) => f.name === 'status')!.default).toBe('todo')
  })

  it('a field added later starts from its default, else from a seed of its schema', () => {
    const [status, , , , due] = structFields(task)
    expect(seedField(status!)).toBe('todo')
    expect(seedField(due!)).toBe('')
  })

  it('does not loop on a required field of a recursive schema', () => {
    const registry: SchemaRegistry = {
      'acme/node': struct({next: {value: {type: 'hm://hyper.media/acme/node'}, required: true}}),
    }
    expect(() => seedValue(registry['acme/node']!, registry)).not.toThrow()
  })
})

describe('property defaults: a new typed document', () => {
  it('lists only declared defaults', () => {
    expect(propertyDefaults(task)).toEqual({status: 'todo', priority: 2, tags: []})
    expect(propertyDefaults(undefined)).toEqual({})
    expect(propertyDefaults({type: U('string')})).toEqual({})
  })

  it('fills only the keys the document has never held', () => {
    expect(missingPropertyDefaults(task, {})).toEqual({status: 'todo', priority: 2, tags: []})
    expect(missingPropertyDefaults(task, {status: 'done'})).toEqual({priority: 2, tags: []})
    // A null tombstone is a field the author removed: it stays removed.
    expect(missingPropertyDefaults(task, {status: 'done', priority: null, tags: ['a']})).toEqual({})
    expect(missingPropertyDefaults(task, {status: '', priority: 0, tags: []})).toEqual({})
  })

  const TYPE = 'hm://acme/types/task'
  // A type published outside the library: the same struct under a CID the bundle does not know.
  const published = {...task, description: 'A task type published by Acme.'}
  const client = (parentMetadata: Record<string, unknown>) => ({
    request: async (key: string, input: any) => {
      if (key === 'GetCID') return {value: published}
      const path = (input?.path ?? []).join('/')
      if (path === 'types/task') {
        const {cid} = await encodeDagCbor(published)
        return {type: 'document', document: {metadata: {schemaDefinition: `ipfs://${cid}`}}}
      }
      if (path === 'tasks') return {type: 'document', document: {metadata: parentMetadata}}
      throw new Error('not found')
    },
  })
  const id = unpackHmId('hm://acme/tasks/write-docs')!

  it('takes defaults from its own attributesSchema', async () => {
    const got = await newDocumentDefaults(client({}) as any, id, {name: 'Write docs', attributesSchema: TYPE})
    expect(got).toEqual({status: 'todo', priority: 2, tags: []})
  })
  it("takes defaults from the parent's childAttributesSchema", async () => {
    const got = await newDocumentDefaults(client({childAttributesSchema: TYPE}) as any, id, {status: 'doing'})
    expect(got).toEqual({priority: 2, tags: []})
  })
  it('gives an untyped document nothing, and never throws on a type it cannot load', async () => {
    expect(await newDocumentDefaults(client({}) as any, id, {name: 'x'})).toEqual({})
    expect(await newDocumentDefaults(client({}) as any, id, {attributesSchema: 'hm://acme/missing'})).toEqual({})
  })
})
