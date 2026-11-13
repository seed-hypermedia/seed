// @vitest-environment jsdom
import {TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
// BlockNoteEditor must load before the HM schema, which depends on it through a cycle.
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import type {PartialBlock} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {replaceEditorContent} from './replace-editor-content'
import {hmBlockSchema} from './schema'

function createEditor(initialContent: PartialBlock<any>[]) {
  return new BlockNoteEditor({initialContent, blockSchema: hmBlockSchema})
}

const paragraph = (id: string, text = `text ${id}`): PartialBlock<any> => ({
  id,
  type: 'paragraph',
  content: text,
})

const draftCard = (id: string, draftId: string): PartialBlock<any> => ({
  id,
  type: 'embed',
  props: {url: '', view: 'Card', draftId},
})

const card = (id: string, url: string): PartialBlock<any> => ({
  id,
  type: 'embed',
  props: {url, view: 'Card'},
})

function blockPos(editor: BlockNoteEditor<any>, blockId: string) {
  let found = -1
  editor._tiptapEditor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name === 'blockNode' && node.attrs.id === blockId) found = pos
    return true
  })
  if (found < 0) throw new Error(`Block "${blockId}" not found`)
  return found
}

describe('replaceEditorContent', () => {
  it('converts a tracked draft card in place', () => {
    const editor = createEditor([paragraph('p1'), draftCard('card', 'child-draft'), paragraph('p2')])

    replaceEditorContent(editor, [
      paragraph('p1'),
      {id: 'card', type: 'embed', props: {url: 'hm://uid/child', view: 'Card'}},
      paragraph('p2'),
    ])

    const card = editor.topLevelBlocks.find((b) => b.id === 'card')
    expect(card?.props.url).toBe('hm://uid/child')
    expect(card?.props.draftId).toBe('')
  })

  it('keeps the caret in the same block at the same offset when a card is inserted above it', () => {
    const editor = createEditor([paragraph('p1', 'hello 1'), paragraph('p2', 'hello 2')])
    const view = editor._tiptapEditor.view
    const oldP2Pos = blockPos(editor, 'p2')
    const caretOffset = oldP2Pos + 2 + 3
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caretOffset)))

    replaceEditorContent(editor, [
      paragraph('p1', 'hello 1'),
      card('new-card', 'hm://uid/new-child'),
      paragraph('p2', 'hello 2'),
    ])

    expect(editor.getTextCursorPosition().block.id).toBe('p2')
    expect(view.state.selection.from - blockPos(editor, 'p2')).toBe(caretOffset - oldP2Pos)
  })

  it('leaves a single empty paragraph when the replacement is empty', () => {
    const editor = createEditor([paragraph('p1'), paragraph('p2')])

    replaceEditorContent(editor, [])

    expect(editor.topLevelBlocks.length).toBe(1)
    expect(editor.topLevelBlocks[0].type).toBe('paragraph')
    expect(editor.topLevelBlocks[0].content).toEqual([])
  })
})
