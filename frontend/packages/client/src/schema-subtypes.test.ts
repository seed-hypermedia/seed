import {describe, expect, it} from 'vitest'
import {HM_SCHEMAS, nameToUrl, schemaCid} from './schema-engine'
import {closeOverSubtypes, extensionParentRef, inClosure, libraryCandidates, schemaRefKey} from './schema-subtypes'

const ANIMAL = 'hm://z6MkAnimalSpace/types/animal'
const DOG = 'hm://z6MkAnimalSpace/types/dog'
const PUPPY = 'hm://z6MkAnimalSpace/types/puppy'
const PLANT = 'hm://z6MkAnimalSpace/types/plant'
// Valid DAG-CBOR CIDs (codec 0x71), so they classify as blob references.
const DOG_CID = 'bafyreigkxnvamoxiyp2qvcn7qazdppwnt2mdnbojuehthjrk7yfpuhnmjq'
const PUPPY_CID = 'bafyreidedtokl6mruxplo3w6hgqmluuubnfgmz43c5zq7oqehysi5wo5ea'

const network = [
  {refs: [ANIMAL], parent: null},
  {refs: [DOG, `ipfs://${DOG_CID}`], parent: ANIMAL},
  {refs: [PUPPY, `ipfs://${PUPPY_CID}`], parent: DOG},
  {refs: [PLANT], parent: null},
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

describe('extensionParentRef', () => {
  it('reads the extended schema off `type`, ignoring kinds, unions and literals', () => {
    expect(extensionParentRef({type: ANIMAL, properties: {}})).toBe(ANIMAL)
    expect(extensionParentRef({type: ANIMAL})).toBe(ANIMAL)
    expect(extensionParentRef({type: 'hm://hyper.media/map', properties: {}})).toBeNull()
    expect(extensionParentRef({anyOf: ['a', 'b']})).toBeNull()
    expect(extensionParentRef('draft' as never)).toBeNull()
    expect(extensionParentRef(undefined)).toBeNull()
  })

  it('sees the library employee as an extension of person', () => {
    expect(extensionParentRef(HM_SCHEMAS['example/employee'])).toBe(nameToUrl('example/person'))
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
      {refs: ['hm://z6MkOther/a'], parent: 'hm://z6MkOther/b'},
      {refs: ['hm://z6MkOther/b'], parent: 'hm://z6MkOther/a'},
      {refs: ['hm://z6MkOther/c'], parent: 'garbage'},
    ])
    expect(closure.refs).toHaveLength(5)
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
