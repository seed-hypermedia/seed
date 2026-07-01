import {describe, expect, test} from 'vitest'
import {dagCborKeyCompare, diffMetadata} from '../document-metadata-view'

describe('dagCborKeyCompare', () => {
  test('shorter keys sort first (length-first, per DAG-CBOR spec)', () => {
    const keys = ['name', 'icon', 'seedExperimentalLogo', 'summary', 'theme', 'a']
    const sorted = [...keys].sort(dagCborKeyCompare)
    expect(sorted).toEqual(['a', 'icon', 'name', 'theme', 'summary', 'seedExperimentalLogo'])
  })

  test('equal-length keys compare bytewise', () => {
    expect(['cover', 'aaaaa'].sort(dagCborKeyCompare)).toEqual(['aaaaa', 'cover'])
    expect(['b', 'a'].sort(dagCborKeyCompare)).toEqual(['a', 'b'])
  })

  test('multi-byte UTF-8 keys sort by encoded length, not code-point count', () => {
    // 'é' encodes to 2 bytes, so 'é' sorts after single-byte 2-char keys of equal char count
    expect(['é', 'zz'].sort(dagCborKeyCompare)).toEqual(['zz', 'é'])
    expect(['é', 'z'].sort(dagCborKeyCompare)).toEqual(['z', 'é'])
  })
})

describe('diffMetadata', () => {
  test('includes only changed keys', () => {
    expect(diffMetadata({name: 'A', icon: 'x'}, {name: 'B', icon: 'x'})).toEqual({name: 'B'})
  })

  test('removed top-level keys become null tombstones', () => {
    expect(diffMetadata({name: 'A', icon: 'x'}, {name: 'A'})).toEqual({icon: null})
  })

  test('removed nested keys become null tombstones inside the object', () => {
    expect(diffMetadata({theme: {headerLayout: 'Center', extra: 'y'}}, {theme: {headerLayout: 'Center'}})).toEqual({
      theme: {headerLayout: 'Center', extra: null},
    })
  })

  test('existing nested tombstones survive unrelated edits to the same object', () => {
    // 'extra' was already staged as deleted; editing headerLayout must not resurrect it
    expect(diffMetadata({theme: {headerLayout: '', extra: null}}, {theme: {headerLayout: 'Center'}})).toEqual({
      theme: {headerLayout: 'Center', extra: null},
    })
  })

  test('added keys and unchanged objects produce a minimal patch', () => {
    expect(diffMetadata({theme: {headerLayout: ''}}, {theme: {headerLayout: ''}, name: 'New'})).toEqual({name: 'New'})
  })

  test('lists replace wholesale', () => {
    expect(diffMetadata({tags: ['a', 'b']}, {tags: ['b', 'a']})).toEqual({tags: ['b', 'a']})
  })
})
