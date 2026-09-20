import {describe, expect, test} from 'bun:test'
import {mergeUpdateMetadata, metadataToSetAttributes} from './document-metadata'

describe('cover metadata updates', () => {
  const existing = {
    cover: 'ipfs://old-cover',
    coverPosition: {x: 20, y: 80},
  }

  test('clears a stale focal point when replacing the cover', () => {
    expect(mergeUpdateMetadata({cover: 'ipfs://new-cover'}, {}, existing)).toEqual({
      cover: 'ipfs://new-cover',
      coverPosition: null,
    })
  })

  test('clears a stale focal point when removing the cover', () => {
    expect(mergeUpdateMetadata({cover: ''}, {}, existing)).toEqual({
      cover: '',
      coverPosition: null,
    })
  })

  test('preserves an explicit focal point for the replacement cover', () => {
    expect(mergeUpdateMetadata({cover: 'ipfs://new-cover', coverPosition: {x: 65, y: 35}}, {}, existing)).toEqual({
      cover: 'ipfs://new-cover',
      coverPosition: {x: 65, y: 35},
    })
  })

  test('does not clear the focal point when the cover is not being updated', () => {
    expect(mergeUpdateMetadata({summary: 'Updated'}, {}, existing)).toEqual({summary: 'Updated'})
  })

  test('expands focal-point removal into leaf tombstones', () => {
    expect(metadataToSetAttributes({coverPosition: null}, existing)).toEqual({
      type: 'SetAttributes',
      attrs: [
        {key: ['coverPosition', 'x'], value: null},
        {key: ['coverPosition', 'y'], value: null},
      ],
    })
  })
})
