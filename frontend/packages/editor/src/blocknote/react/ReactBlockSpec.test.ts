import {Schema} from 'prosemirror-model'
import {describe, expect, it} from 'vitest'
import {getBlockNodeFromPos} from './block-node-position'

const schema = new Schema({
  nodes: {
    doc: {
      content: 'blockNode+',
    },
    blockNode: {
      group: 'blockNodeChild',
      attrs: {
        id: {default: ''},
      },
      content: 'block',
      toDOM: () => ['div', {'data-node-type': 'blockNode'}, 0],
    },
    query: {
      group: 'block',
      content: 'text*',
      attrs: {
        queryFilters: {default: '[]'},
      },
      toDOM: () => ['div', {'data-content-type': 'query'}, 0],
    },
    text: {
      group: 'inline',
    },
  },
})

const doc = schema.node('doc', null, [
  schema.node('blockNode', {id: 'query-block'}, [schema.node('query', {queryFilters: '[]'}, schema.text('x'))]),
])

describe('getBlockNodeFromPos', () => {
  it('finds the containing block when the position points at the first block node', () => {
    expect(getBlockNodeFromPos(doc, 0)?.attrs.id).toBe('query-block')
  })

  it('finds the containing block when the position resolves inside block content', () => {
    expect(getBlockNodeFromPos(doc, 2)?.attrs.id).toBe('query-block')
  })
})
