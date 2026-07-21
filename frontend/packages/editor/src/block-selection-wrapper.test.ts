import {Schema} from 'prosemirror-model'
import {EditorState, NodeSelection, TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
import {isBlockSelected} from './block-selection-wrapper'
import {FullBlockSelectionProsemirrorPlugin} from './blocknote/core/extensions/FullBlockSelection/FullBlockSelectionPlugin'

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

const doc = schema.node('doc', null, [schema.node('blockNode', {id: 'image-block'}, [schema.node('image')])])

function makeEditor(selection: EditorState['selection'], {isEditable = true, hasFocus = false} = {}) {
  // Selection state comes from the FullBlockSelection plugin — the same single
  // source that drives the side-menu block tools and selection decorations.
  const fullBlockSelection = new FullBlockSelectionProsemirrorPlugin({} as any)
  const state = EditorState.create({schema, doc, selection, plugins: [fullBlockSelection.plugin]})
  return {
    isEditable,
    fullBlockSelection,
    _tiptapEditor: {
      view: {
        state,
        hasFocus: () => hasFocus,
      },
    },
  } as any
}

describe('isBlockSelected', () => {
  it('does not select empty media blocks for collapsed text selections', () => {
    const editor = makeEditor(TextSelection.create(doc, 2))

    expect(isBlockSelected(editor, 'image-block')).toBe(false)
  })

  it('selects media blocks for node selections on the block content', () => {
    const editor = makeEditor(NodeSelection.create(doc, 1))

    expect(isBlockSelected(editor, 'image-block')).toBe(true)
  })

  // Regression: a NodeSelection can also land on the blockNode itself (e.g.
  // from programmatic selection); that must count as selected too.
  it('selects media blocks for node selections on the blockNode wrapper', () => {
    const editor = makeEditor(NodeSelection.create(doc, 0))

    expect(isBlockSelected(editor, 'image-block')).toBe(true)
  })

  // A read-only, unfocused editor's selection is ProseMirror's mandatory
  // initial selection, not a user action — no selection chrome for readers.
  it('ignores the initial node selection in a read-only, unfocused editor', () => {
    const editor = makeEditor(NodeSelection.create(doc, 1), {isEditable: false, hasFocus: false})

    expect(isBlockSelected(editor, 'image-block')).toBe(false)
  })

  it('still selects in a read-only editor once it is focused', () => {
    const editor = makeEditor(NodeSelection.create(doc, 1), {isEditable: false, hasFocus: true})

    expect(isBlockSelected(editor, 'image-block')).toBe(true)
  })
})
