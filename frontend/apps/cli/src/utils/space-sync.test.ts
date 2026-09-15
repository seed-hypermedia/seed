import {describe, expect, test} from 'bun:test'
import {applySchemaMetadata, findMovedFrom, metadataDiffOp} from './space-sync'

describe('findMovedFrom', () => {
  const byBlock = new Map<string, string>([
    ['a1', '/foo'],
    ['a2', '/foo'],
    ['a3', '/foo'],
    ['b1', '/bar'],
  ])

  test('a file whose ids all belong to one document is that document, moved', () => {
    expect(findMovedFrom(byBlock, ['a1', 'a2', 'a3'])).toBe('/foo')
  })

  test('a majority of known ids is enough (edits add new blocks)', () => {
    expect(findMovedFrom(byBlock, ['a1', 'a2', 'new1', 'new2'])).toBeNull()
    expect(findMovedFrom(byBlock, ['a1', 'a2', 'a3', 'new1', 'new2'])).toBe('/foo')
  })

  test('ids from several documents pick the dominant one', () => {
    expect(findMovedFrom(byBlock, ['a1', 'a2', 'b1'])).toBe('/foo')
  })

  test('unknown ids mean a new document', () => {
    expect(findMovedFrom(byBlock, ['x1', 'x2'])).toBeNull()
    expect(findMovedFrom(byBlock, [])).toBeNull()
  })

  test('the home document has the empty path', () => {
    expect(findMovedFrom(new Map([['h1', '']]), ['h1'])).toBe('')
  })
})

describe('metadataDiffOp', () => {
  test('no change yields no op', () => {
    expect(
      metadataDiffOp({name: 'A', theme: {headerLayout: 'Center'}}, {name: 'A', theme: {headerLayout: 'Center'}}),
    ).toBeNull()
  })

  test('changed, added and removed leaves', () => {
    const op = metadataDiffOp(
      {name: 'A', summary: 'old', theme: {headerLayout: 'Center'}},
      {name: 'B', icon: 'ipfs://x'},
    )
    expect(op).toEqual({
      type: 'SetAttributes',
      attrs: [
        {key: ['name'], value: 'B'},
        {key: ['icon'], value: 'ipfs://x'},
        {key: ['summary'], value: null},
        {key: ['theme', 'headerLayout'], value: null},
      ],
    })
  })
})

describe('applySchemaMetadata', () => {
  const TYPE = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example/employee'

  test('an instance file binds its document through attributesSchema, dropping the old `schema` key', () => {
    const out = applySchemaMetadata({name: 'Bob', schema: TYPE, schemaDefinition: 'ipfs://x'} as any, {
      kind: 'instance',
      type: TYPE,
    })
    expect(out).toEqual({name: 'Bob', attributesSchema: TYPE} as any)
  })

  test('a type file points schemaDefinition at its blob', () => {
    expect(applySchemaMetadata({name: 'Person'}, {kind: 'type', cid: 'bafyabc', data: new Uint8Array()})).toEqual({
      name: 'Person',
      schemaDefinition: 'ipfs://bafyabc',
    } as any)
  })

  test('the next import nulls the dropped `schema` attribute on the published document', () => {
    const published = {name: 'Bob', schema: TYPE, attributesSchema: TYPE}
    const next = applySchemaMetadata(published as any, {kind: 'instance', type: TYPE})
    expect(metadataDiffOp(published, next as any)).toEqual({
      type: 'SetAttributes',
      attrs: [{key: ['schema'], value: null}],
    })
  })
})
