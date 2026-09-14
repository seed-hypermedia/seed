import {hmId} from '../../utils/entity-id-url'
import {describe, expect, it} from 'vitest'
import {applySchemaToMetadata, createSchemaMetadata, inferDocumentSchema} from '../document-creation-schema'

const collectionId = hmId('alice', {path: ['projects']})

function item(path: string[], metadata: Record<string, unknown>) {
  return {id: hmId('alice', {path}), path, metadata} as any
}

describe('inferDocumentSchema', () => {
  it('uses published and draft direct children, excludes built-ins and deeper descendants, and keeps type', () => {
    const schema = inferDocumentSchema({
      collectionId,
      publishedChildren: [
        item(['projects', 'one'], {name: 'One', type: 'task', status: 'ready'}),
        item(['projects', 'one', 'note'], {ignored: 'nested'}),
        item(['elsewhere'], {ignored: 'outside'}),
      ],
      draftChildren: [
        {id: hmId('alice', {path: ['projects', 'two']}), metadata: {priority: 3}},
        {id: hmId('bob', {path: ['projects', 'three']}), metadata: {ignored: true}},
      ],
    })

    expect(schema.attributes).toEqual([
      {key: 'priority', type: 'number'},
      {key: 'status', type: 'text'},
      {key: 'type', type: 'text'},
    ])
  })

  it('infers types by frequency with deterministic ties and merges object shapes recursively', () => {
    const schema = inferDocumentSchema({
      collectionId,
      publishedChildren: [
        item(['projects', 'one'], {priority: 1, enabled: false, customer: {name: 'Alice', score: 9}}),
        item(['projects', 'two'], {priority: 'high', customer: {name: 'Bob', active: false}}),
        item(['projects', 'three'], {priority: 2}),
      ],
      draftChildren: [],
    })

    expect(schema.attributes).toEqual([
      {
        key: 'customer',
        type: 'object',
        attributes: [
          {key: 'active', type: 'toggle'},
          {key: 'name', type: 'text'},
          {key: 'score', type: 'number'},
        ],
      },
      {key: 'enabled', type: 'toggle'},
      {key: 'priority', type: 'number'},
    ])
    expect(createSchemaMetadata(schema)).toEqual({
      customer: {active: true, name: '', score: 0},
      enabled: true,
      priority: 0,
    })
  })

  it('preserves imported values and recursively adds only missing schema fields', () => {
    const schema = inferDocumentSchema({
      collectionId,
      publishedChildren: [
        item(['projects', 'one'], {status: 'ready', customer: {name: 'Alice', score: 9, active: true}}),
      ],
      draftChildren: [],
    })

    expect(applySchemaToMetadata({status: '', customer: {name: 'Imported', active: false}}, schema)).toEqual({
      status: '',
      customer: {name: 'Imported', active: false, score: 0},
    })
  })
})
