import {Schema} from 'prosemirror-model'
import {EditorState, NodeSelection, TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
import {computeSelected} from './block-selection-wrapper'

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
    image: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['figure', {'data-content-type': 'image'}, 0],
    },
    text: {
      group: 'inline',
    },
  },
})

function makeEditor(selection: EditorState['selection']) {
  const state = EditorState.create({schema, doc, selection})
  return {
    _tiptapEditor: {
      view: {
        state,
      },
    },
  } as any
}

const doc = schema.node('doc', null, [schema.node('blockNode', {id: 'image-block'}, [schema.node('image')])])
const block = {id: 'image-block'} as any

describe('computeSelected', () => {
  it('does not select empty media blocks for collapsed text selections', () => {
    const editor = makeEditor(TextSelection.create(doc, 2))

    expect(computeSelected(editor, block)).toBe(false)
  })

  it('selects media blocks for node selections', () => {
    const editor = makeEditor(NodeSelection.create(doc, 1))

    expect(computeSelected(editor, block)).toBe(true)
  })
})
