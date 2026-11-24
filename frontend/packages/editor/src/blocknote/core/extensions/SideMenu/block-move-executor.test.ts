import {Node as PMNode} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'
import {describe, expect, it, vi} from 'vitest'
import {buildDoc, createMinimalSchema} from '../../api/blockManipulation/__tests__/test-helpers-prosemirror'
import {executeBlockMove} from './block-move-executor'

/** Block ids in document order, indented by nesting. */
function outline(doc: PMNode): string[] {
  const lines: string[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockNode') lines.push(`${'  '.repeat((doc.resolve(pos).depth - 1) / 2)}${node.attrs.id}`)
    return true
  })
  return lines
}

function makeEditor(state: EditorState) {
  const view = {
    state,
    dispatch: vi.fn((tr) => {
      view.state = view.state.apply(tr)
    }),
    focus: vi.fn(),
  }
  return {prosemirrorView: view} as any
}

describe('executeBlockMove', () => {
  it('moves a selected parent once, with its nested blocks, when a nested block is also selected', () => {
    const schema = createMinimalSchema()
    const doc = buildDoc(schema, [
      {id: 'first', text: 'first'},
      {
        id: 'parent',
        text: 'parent',
        children: {
          blocks: [
            {id: 'child-1', text: 'child 1'},
            {id: 'child-2', text: 'child 2'},
          ],
        },
      },
    ])
    const editor = makeEditor(EditorState.create({schema, doc}))

    executeBlockMove(editor, ['parent', 'child-1'], {type: 'reorder-above', targetBlockId: 'first', level: 0})

    expect(outline(editor.prosemirrorView.state.doc)).toEqual(['parent', '  child-1', '  child-2', 'first'])
  })
})
