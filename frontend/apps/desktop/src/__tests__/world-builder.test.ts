// The World Builder plan: schema blobs whose targets point at THIS world's
// type documents, a document per type/folder/starter with the right binding
// metadata, and a publisher that sends blobs first, then documents in order.
import * as cbor from '@ipld/dag-cbor'
import {describe, expect, it, vi} from 'vitest'
import {nameToUrl} from '@shm/ui/onyx/onyx-engine'
import {buildWorldPlan, docChanges, publishWorld, retargetSchema, slugify, WORLD_KIT_TYPES} from '../world-builder'

const UID = 'z6MkfakeWorldOwner'

describe('slugify', () => {
  it('makes a path segment from a title', () => {
    expect(slugify('The Shattered Coast')).toBe('the-shattered-coast')
    expect(slugify('  Ünïcode!! ')).toBe('unicode')
    expect(slugify('')).toBe('world')
  })
})

describe('buildWorldPlan', () => {
  it('lays out the world, types, folders and starters with the right bindings', async () => {
    const plan = await buildWorldPlan({
      uid: UID,
      basePath: ['notes'],
      name: 'Test World',
      genre: 'fantasy',
      epoch: '1000-01-01',
      types: [...WORLD_KIT_TYPES],
    })
    expect(plan.rootId.uid).toBe(UID)
    expect(plan.rootId.path).toEqual(['notes', 'test-world'])
    const byPath = new Map(plan.docs.map((d) => [d.path.join('/'), d]))

    // 1 world + 4 types + 4 folders + 4 starters
    expect(plan.docs).toHaveLength(13)
    expect(plan.blobs).toHaveLength(4)

    const world = byPath.get('notes/test-world')!
    expect(world.metadata).toMatchObject({name: 'Test World', genre: 'fantasy', epoch: '1000-01-01'})
    expect(world.metadata.schema).toBe(nameToUrl('example-world-doc'))

    // Each type document DEFINES its schema; each folder's children CONFORM to it.
    const place = byPath.get('notes/test-world/types/place')!
    expect(place.metadata.schemaDefinition).toMatch(/^ipfs:\/\/bafyrei/)
    const placeCid = place.metadata.schemaDefinition!.replace('ipfs://', '')
    expect(plan.blobs.map((b) => b.cid)).toContain(placeCid)
    const places = byPath.get('notes/test-world/places')!
    expect(places.metadata.childrenSchema).toBe(`hm://${UID}/notes/test-world/types/place`)
    expect(places.metadata.schema).toBeUndefined()

    // Folders render a query over their own children.
    const query = places.blocks.find((b) => b.type === 'Query')!
    expect(query.attributes).toMatchObject({
      style: 'Table',
      query: {includes: [{space: UID, path: 'notes/test-world/places', mode: 'Children'}]},
    })

    // The character schema's references target THIS world's types, not the library's.
    const character = byPath.get('notes/test-world/types/character')!
    const blob = plan.blobs.find((b) => b.cid === character.metadata.schemaDefinition!.replace('ipfs://', ''))!
    const schema = cbor.decode(blob.data) as any
    expect(schema.properties.metadata.properties.home.target).toBe(`hm://${UID}/notes/test-world/types/place`)
    expect(schema.properties.metadata.properties.faction.target).toBe(`hm://${UID}/notes/test-world/types/faction`)
    // …while an object target stays on the library type it was defined against.
    expect(schema.properties.metadata.properties.stats.target).toBe(nameToUrl('example-stats'))

    // Starters cross-reference each other and carry ISO dates.
    const wanderer = byPath.get('notes/test-world/characters/the-wanderer')!
    expect(wanderer.metadata).toMatchObject({
      role: 'hero',
      born: '0969-01-01',
      home: `hm://${UID}/notes/test-world/places/the-capital`,
      faction: `hm://${UID}/notes/test-world/factions/the-founders`,
    })
    const founding = byPath.get('notes/test-world/events/the-founding')!
    expect(founding.metadata.date).toBe('1000-01-01')
    expect(founding.metadata.protagonist).toBe(`hm://${UID}/notes/test-world/characters/the-wanderer`)
  })

  it('omits types (and their references) that are not selected', async () => {
    const plan = await buildWorldPlan({
      uid: UID,
      basePath: [],
      name: 'Small',
      genre: 'mythic',
      types: ['character', 'place'],
    })
    expect(plan.docs.map((d) => d.path.join('/'))).toEqual([
      'small',
      'small/types/character',
      'small/types/place',
      'small/characters',
      'small/places',
      'small/places/the-capital',
      'small/characters/the-wanderer',
    ])
    const wanderer = plan.docs.find((d) => d.path.at(-1) === 'the-wanderer')!
    expect(wanderer.metadata.faction).toBeUndefined()
    // The character schema still targets the library Faction type for the missing one.
    const character = plan.docs.find((d) => d.path.join('/') === 'small/types/character')!
    const blob = plan.blobs.find((b) => b.cid === character.metadata.schemaDefinition!.replace('ipfs://', ''))!
    const schema = cbor.decode(blob.data) as any
    expect(schema.properties.metadata.properties.faction.target).toBe(nameToUrl('example-faction-doc'))
    expect(schema.properties.metadata.properties.home.target).toBe(`hm://${UID}/small/types/place`)
  })

  it('retargetSchema only rewrites target keys', () => {
    const out = retargetSchema(
      {properties: {a: {ref: 'x', target: nameToUrl('example-place-doc')!}, b: {ref: nameToUrl('example-place-doc')!}}},
      {place: 'hm://me/w/types/place'},
    ) as any
    expect(out.properties.a.target).toBe('hm://me/w/types/place')
    expect(out.properties.b.ref).toBe(nameToUrl('example-place-doc'))
  })
})

describe('docChanges', () => {
  it('emits metadata then move+replace per block', async () => {
    const plan = await buildWorldPlan({
      uid: UID,
      basePath: [],
      name: 'W',
      genre: 'fantasy',
      types: ['place'],
      starters: false,
    })
    const folder = plan.docs.find((d) => d.role === 'folder')!
    const changes = docChanges(folder).map((c) => c.op.case)
    expect(changes.slice(0, 2)).toEqual(['setMetadata', 'setMetadata'])
    expect(changes.slice(2)).toEqual(['moveBlock', 'replaceBlock', 'moveBlock', 'replaceBlock'])
    const replace = docChanges(folder).filter((c) => c.op.case === 'replaceBlock')[1]!.op.value as any
    expect(replace.type).toBe('Query')
    expect(replace.attributes.toJson()).toMatchObject({style: 'Table'})
  })
})

describe('publishWorld', () => {
  it('publishes blobs first, then each document in order with an API path', async () => {
    const plan = await buildWorldPlan({
      uid: UID,
      basePath: [],
      name: 'W',
      genre: 'fantasy',
      types: ['place'],
      starters: false,
    })
    const calls: string[] = []
    const publishBlobs = vi.fn(async (blobs: unknown[]) => calls.push(`blobs:${blobs.length}`))
    const publishDocument = vi.fn(async (input: {path?: string; account: string; signerAccountUid: string}) => {
      expect(input.account).toBe(UID)
      expect(input.signerAccountUid).toBe(UID)
      calls.push(input.path!)
    })
    const progress: number[] = []
    await publishWorld(plan, {publishBlobs, publishDocument}, (done) => progress.push(done))
    expect(calls).toEqual(['blobs:1', '/w', '/w/types/place', '/w/places'])
    expect(progress).toEqual([1, 2, 3])
  })
})
