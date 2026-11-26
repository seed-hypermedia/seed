import {describe, expect, it} from 'vitest'
import {HM_SCHEMAS, nameToUrl, schemaCid} from './schema-engine'
import {closeOverSubtypes, extensionParentRefs, inClosure, libraryCandidates, schemaRefKey} from './schema-subtypes'

const ANIMAL = 'hm://z6MkAnimalSpace/types/animal'
const DOG = 'hm://z6MkAnimalSpace/types/dog'
const PUPPY = 'hm://z6MkAnimalSpace/types/puppy'
const PLANT = 'hm://z6MkAnimalSpace/types/plant'
// Valid DAG-CBOR CIDs (codec 0x71), so they classify as blob references.
const DOG_CID = 'bafyreigkxnvamoxiyp2qvcn7qazdppwnt2mdnbojuehthjrk7yfpuhnmjq'
const PUPPY_CID = 'bafyreidedtokl6mruxplo3w6hgqmluuubnfgmz43c5zq7oqehysi5wo5ea'

const network = [
  {refs: [ANIMAL], parents: []},
  {refs: [DOG, `ipfs://${DOG_CID}`], parents: [ANIMAL]},
  {refs: [PUPPY, `ipfs://${PUPPY_CID}`], parents: [DOG]},
  {refs: [PLANT], parents: []},
]

describe('schemaRefKey', () => {
  it('gives one key per schema whatever the spelling', () => {
    expect(schemaRefKey('hm://hyper.media/example/person')).toBe('lib:example/person')
    expect(schemaRefKey(`ipfs://${schemaCid('example/person')}`)).toBe('lib:example/person')
    expect(schemaRefKey(`${ANIMAL}?v=abc`)).toBe(ANIMAL)
    expect(schemaRefKey(`ipfs://${DOG_CID}`)).toBe(`cid:${DOG_CID}`)
    expect(schemaRefKey('')).toBeNull()
    expect(schemaRefKey('not a reference')).toBeNull()
  })
})

describe('extensionParentRefs', () => {
  it('reads the extended schema off `type`, ignoring kinds, unions and literals', () => {
    expect(extensionParentRefs({type: ANIMAL, properties: {}})).toEqual([ANIMAL])
    expect(extensionParentRefs({type: ANIMAL})).toEqual([ANIMAL])
    expect(extensionParentRefs({type: 'hm://hyper.media/map', properties: {}})).toEqual([])
    expect(extensionParentRefs({anyOf: ['a', 'b']})).toEqual([])
    expect(extensionParentRefs('draft' as never)).toEqual([])
    expect(extensionParentRefs(undefined)).toEqual([])
  })

  it('sees the library employee as an extension of person', () => {
    expect(extensionParentRefs(HM_SCHEMAS['example/employee'])).toEqual([nameToUrl('example/person')])
  })

  it('gives an intersection every arm as a parent, through nesting, each once', () => {
    expect(extensionParentRefs(HM_SCHEMAS['example/staff-member'])).toEqual([
      nameToUrl('example/employee'),
      nameToUrl('example/contact'),
    ])
    expect(
      extensionParentRefs({
        allOf: [{type: DOG, properties: {}}, {allOf: [{type: PLANT}, {type: DOG}]}, {type: 'hm://hyper.media/struct'}],
      }),
    ).toEqual([DOG, PLANT])
  })
})

describe('closeOverSubtypes', () => {
  it('collects the target and every transitive subtype, with every spelling', () => {
    const closure = closeOverSubtypes(ANIMAL, network)
    expect(closure.refs).toEqual([ANIMAL, DOG, `ipfs://${DOG_CID}`, PUPPY, `ipfs://${PUPPY_CID}`])
    expect(inClosure(closure, PLANT)).toBe(false)
    expect(inClosure(closure, `${PUPPY}?v=xyz`)).toBe(true)
    expect(inClosure(closure, `ipfs://${DOG_CID}`)).toBe(true)
    expect(inClosure(closure, null)).toBe(false)
  })

  it('narrows to the subtree when the target is a subtype', () => {
    const closure = closeOverSubtypes(DOG, network)
    expect(closure.refs).toEqual([DOG, `ipfs://${DOG_CID}`, PUPPY, `ipfs://${PUPPY_CID}`])
    expect(inClosure(closure, ANIMAL)).toBe(false)
  })

  it('adds the other spellings of a target given by blob CID', () => {
    const closure = closeOverSubtypes(`ipfs://${DOG_CID}`, network)
    expect(inClosure(closure, DOG)).toBe(true)
    expect(inClosure(closure, PUPPY)).toBe(true)
  })

  it('terminates on cycles and ignores unresolvable parents', () => {
    const closure = closeOverSubtypes(ANIMAL, [
      ...network,
      {refs: ['hm://z6MkOther/a'], parents: ['hm://z6MkOther/b']},
      {refs: ['hm://z6MkOther/b'], parents: ['hm://z6MkOther/a']},
      {refs: ['hm://z6MkOther/c'], parents: ['garbage']},
    ])
    expect(closure.refs).toHaveLength(5)
  })

  it('reaches an intersection from any of its arms', () => {
    const PET_PLANT = 'hm://z6MkAnimalSpace/types/pet-plant'
    const mixed = [...network, {refs: [PET_PLANT], parents: [DOG, PLANT]}]
    expect(inClosure(closeOverSubtypes(PLANT, mixed), PET_PLANT)).toBe(true)
    expect(inClosure(closeOverSubtypes(ANIMAL, mixed), PET_PLANT)).toBe(true)
    expect(inClosure(closeOverSubtypes(PUPPY, mixed), PET_PLANT)).toBe(false)
  })

  it('sees the library staff member as a subtype of employee, person and contact', () => {
    const staff = nameToUrl('example/staff-member')!
    for (const parent of ['example/person', 'example/employee', 'example/contact'])
      expect(inClosure(closeOverSubtypes(nameToUrl(parent)!, libraryCandidates()), staff)).toBe(true)
    expect(inClosure(closeOverSubtypes(nameToUrl('example/admin')!, libraryCandidates()), staff)).toBe(false)
  })

  it('yields nothing for a target that names no schema', () => {
    expect(closeOverSubtypes('', network).refs).toEqual([])
  })

  it('finds library subtypes through the bundled candidates', () => {
    const closure = closeOverSubtypes(nameToUrl('example/person')!, libraryCandidates())
    expect(inClosure(closure, 'hm://hyper.media/example/employee')).toBe(true)
    expect(inClosure(closure, `ipfs://${schemaCid('example/employee')}`)).toBe(true)
    expect(inClosure(closure, 'hm://hyper.media/example/address')).toBe(false)
  })
})
