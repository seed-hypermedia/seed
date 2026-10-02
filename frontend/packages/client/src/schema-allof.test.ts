import {describe, expect, expectTypeOf, it} from 'vitest'
import {
  HM_SCHEMAS,
  LIBRARY_CORE,
  kindOf,
  resolveSchema,
  schemaCid,
  schemaShape,
  structFields,
  validate,
} from './schema-engine'
import type {HMExampleContact, HMExampleEmployee, HMExampleStaffMember} from './schema-types.generated'

const U = (k: string) => `hm://hyper.media/${k}`
const P = (n: string) => U(`example/${n}`)
const meta = HM_SCHEMAS['schema']!
const staff = HM_SCHEMAS['example/staff-member']!
const staffOk = {name: 'Grace', employeeId: 'E-1', email: 'grace@example.org'}
const struct = (properties: Record<string, unknown>, values?: unknown) => ({
  type: U('struct'),
  properties,
  ...(values === undefined ? {} : {values}),
})

describe('allOf: the intersection variant of the meta-schema', () => {
  it('is a library core variant with a content address', () => {
    expect(LIBRARY_CORE.has('schema/allof')).toBe(true)
    expect(schemaCid('schema/allof')).toMatch(/^bafy/)
    expect(validate(meta, HM_SCHEMAS['schema/allof']!)).toEqual([])
    expect(schemaShape({allOf: []})).toEqual({label: 'Intersection', slug: 'schema/allof'})
  })

  it('accepts intersections of structs and rejects malformed ones', () => {
    expect(validate(meta, staff)).toEqual([])
    expect(validate(meta, {allOf: [{type: P('person')}, struct({badge: {value: {type: U('string')}}})]})).toEqual([])
    expect(validate(meta, {allOf: []})).not.toEqual([])
    expect(validate(meta, {allOf: [{type: P('person')}], type: P('contact')})).not.toEqual([])
    expect(validate(meta, {allOf: [{type: P('person')}], properties: {}})).not.toEqual([])
    expect(validate(meta, {allOf: [{nope: 1}]})).not.toEqual([])
  })
})

describe('allOf: validation merges the arms', () => {
  it('unites the fields of every arm, closed, with required fields from each', () => {
    expect(validate(staff, {...staffOk, age: 36, department: 'R&D', phone: '+1 555 0100', nicknames: ['G']})).toEqual(
      [],
    )
    expect(validate(staff, {name: 'Grace', email: 'g@example.org'})).toEqual(['$: missing required "employeeId"'])
    expect(validate(staff, {name: 'Grace', employeeId: 'E-1'})).toEqual(['$: missing required "email"'])
    expect(validate(staff, {employeeId: 'E-1', email: 'g@example.org'})).toEqual(['$: missing required "name"'])
    expect(validate(staff, {...staffOk, badge: 7})).toEqual(['$: unexpected key "badge"'])
    expect(validate(staff, {...staffOk, age: 'old'})).toEqual(['$.age: expected integer, got string'])
  })

  it('resolves to one struct with every field once', () => {
    const merged = resolveSchema(staff).schema
    expect(kindOf(merged.type)).toBe('struct')
    expect(structFields(merged).map((f) => f.name)).toEqual([
      'name',
      'age',
      'active',
      'home',
      'nicknames',
      'employeeId',
      'department',
      'email',
      'phone',
    ])
    expect(
      structFields(merged)
        .filter((f) => f.required)
        .map((f) => f.name),
    ).toEqual(['name', 'employeeId', 'email'])
    expect(merged.values).toBeUndefined()
  })

  it('lets an inline struct arm add and require fields', () => {
    const withBadge = {allOf: [{type: P('employee')}, struct({badge: {value: {type: U('integer')}, required: true}})]}
    expect(validate(withBadge, {name: 'A', employeeId: 'E', badge: 1})).toEqual([])
    expect(validate(withBadge, {name: 'A', employeeId: 'E'})).toEqual(['$: missing required "badge"'])
  })

  it('accepts a field two arms agree on and rejects one they define differently', () => {
    const agree = {allOf: [{type: P('person')}, struct({name: {value: {type: U('string')}, required: true}})]}
    expect(validate(agree, {name: 'A'})).toEqual([])
    const conflict = {allOf: [{type: P('person')}, struct({name: {value: {type: U('integer')}}})]}
    expect(validate(conflict, {name: 'A'})).toEqual(['$: allOf arms define the field "name" differently'])
  })

  it('rejects arms that are not structs or maps', () => {
    expect(validate({allOf: [{type: P('person')}, {type: U('string')}]}, {name: 'A'})).toEqual([
      '$: allOf arm 2 is not a struct or map',
    ])
    expect(validate({allOf: [{type: P('person')}, {type: P('status')}]}, {name: 'A'})).toEqual([
      '$: allOf arm 2 is not a struct or map',
    ])
    expect(validate({allOf: [{type: P('person')}, 'x']}, {name: 'A'})).toEqual([
      '$: allOf arm 2 is not a struct or map',
    ])
    expect(validate({allOf: [{type: P('person')}, {type: 'hm://z6MkNowhere/type'}]}, {name: 'A'})).toEqual([
      '$: unresolved reference "hm://z6MkNowhere/type"',
    ])
  })

  it('keeps shared `values` when every arm is open, and closes when any arm is closed', () => {
    const int = {type: U('integer')}
    const openBoth = {allOf: [{type: U('map'), values: int}, struct({total: {value: int}}, int)]}
    expect(validate(openBoth, {total: 3, extra: 4})).toEqual([])
    expect(validate(openBoth, {total: 3, extra: 'x'})).toEqual(['$.extra: expected integer, got string'])
    expect(
      validate(
        {
          allOf: [
            {type: U('map'), values: int},
            {type: U('map'), values: {type: U('string')}},
          ],
        },
        {},
      ),
    ).toEqual(['$: allOf arms constrain extra keys (`values`) differently'])
    expect(validate({allOf: [{type: P('person')}, {type: U('map'), values: int}]}, {name: 'A', extra: 1})).toEqual([
      '$: unexpected key "extra"',
    ])
  })

  it('nests and binds generic parameters', () => {
    expect(validate({allOf: [staff, struct({badge: {value: {type: U('integer')}}})]}, {...staffOk, badge: 1})).toEqual(
      [],
    )
    const generic = {params: {Extra: {type: P('geo')}}, allOf: [{type: P('contact')}, {var: 'Extra'}]}
    expect(validate(generic, {email: 'e', lat: 1, lng: 2})).toEqual([])
    expect(validate(generic, {email: 'e'})).toEqual(['$: missing required "lat"', '$: missing required "lng"'])
    expect(validate({allOf: [{type: P('contact')}, {var: 'Extra'}]}, {email: 'e'})).toEqual([
      '$: unbound type variable "Extra"',
    ])
  })

  it('generates a TypeScript intersection', () => {
    expectTypeOf<HMExampleStaffMember>().toEqualTypeOf<HMExampleEmployee & HMExampleContact>()
  })
})
