import {TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
import {BlockNoteEditor} from '../BlockNoteEditor'
import type {PartialBlock} from '../extensions/Blocks/api/blockTypes'
import blockStyles from '../extensions/Blocks/nodes/Block.module.css'

type PartialAnyBlock = PartialBlock<any>

function createEditor(initialContent: PartialAnyBlock[], renderType: 'document' | 'comment' = 'document') {
  return new BlockNoteEditor({
    initialContent,
    renderType,
  })
}

function getBlockContentStartPos(editor: BlockNoteEditor<any>, blockId: string) {
  let target: number | null = null

  editor._tiptapEditor.state.doc.descendants((node, pos) => {
    if (target !== null) {
      return false
    }

    if (node.type.name === 'blockNode' && node.attrs.id === blockId) {
      target = pos + 1 /* enter blockNode */ + 1 /* enter blockContent */
      return false
    }

    return true
  })

  if (target === null) {
    throw new Error(`Block "${blockId}" not found`)
  }

  return target
}

function placeCursorInBlock(editor: BlockNoteEditor<any>, blockId: string, offset = 0) {
  const start = getBlockContentStartPos(editor, blockId)
  const tr = editor._tiptapEditor.state.tr.setSelection(TextSelection.create(editor._tiptapEditor.state.doc, start + offset))
  editor._tiptapEditor.view.dispatch(tr)
}

function getBlockContentElement(editor: BlockNoteEditor<any>, blockId: string) {
  const element = editor._tiptapEditor.view.dom.querySelector(`[data-id="${blockId}"] > [data-content-type]`)

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Block content for "${blockId}" not found`)
  }

  return element
}

function hasFirstBlockPlaceholder(editor: BlockNoteEditor<any>, blockId: string) {
  return getBlockContentElement(editor, blockId).classList.contains(blockStyles.isFirstEmptyBlock)
}

function insertText(editor: BlockNoteEditor<any>, text: string) {
  const {from, to} = editor._tiptapEditor.state.selection
  editor._tiptapEditor.view.dispatch(editor._tiptapEditor.state.tr.insertText(text, from, to))
}

function deleteTextFromBlock(editor: BlockNoteEditor<any>, blockId: string, length: number) {
  const start = getBlockContentStartPos(editor, blockId)
  const tr = editor._tiptapEditor.state.tr
    .setSelection(TextSelection.create(editor._tiptapEditor.state.doc, start, start + length))
    .deleteSelection()
  editor._tiptapEditor.view.dispatch(tr)
}

describe('first-block placeholder behavior', () => {
  it('shows the placeholder only on the first empty block when the second block is focused', () => {
    const editor = createEditor([
      {id: 'b1', type: 'paragraph'},
      {id: 'b2', type: 'paragraph'},
    ])
    placeCursorInBlock(editor, 'b2')

    expect(hasFirstBlockPlaceholder(editor, 'b1')).toBe(true)
    expect(hasFirstBlockPlaceholder(editor, 'b2')).toBe(false)

    editor._tiptapEditor.destroy()
  })

  it('keeps the placeholder on the first block when later blocks have content', () => {
    const editor = createEditor([
      {id: 'b1', type: 'paragraph'},
      {id: 'b2', type: 'paragraph', content: 'second block'},
    ])
    placeCursorInBlock(editor, 'b2', 'second block'.length)

    expect(hasFirstBlockPlaceholder(editor, 'b1')).toBe(true)
    expect(hasFirstBlockPlaceholder(editor, 'b2')).toBe(false)

    editor._tiptapEditor.destroy()
  })

  it('shows no placeholder when the first block has content and a later block is empty', () => {
    const editor = createEditor([
      {id: 'b1', type: 'paragraph', content: 'first block'},
      {id: 'b2', type: 'paragraph'},
    ])
    placeCursorInBlock(editor, 'b2')

    expect(hasFirstBlockPlaceholder(editor, 'b1')).toBe(false)
    expect(hasFirstBlockPlaceholder(editor, 'b2')).toBe(false)

    editor._tiptapEditor.destroy()
  })

  it('reapplies the placeholder when the first block is cleared back to empty', () => {
    const editor = createEditor([{id: 'b1', type: 'paragraph'}])
    placeCursorInBlock(editor, 'b1')
    insertText(editor, 'hello')

    expect(hasFirstBlockPlaceholder(editor, 'b1')).toBe(false)

    deleteTextFromBlock(editor, 'b1', 'hello'.length)

    expect(hasFirstBlockPlaceholder(editor, 'b1')).toBe(true)

    editor._tiptapEditor.destroy()
  })

  it('keeps the same first-block-only behavior in comment editors', () => {
    const editor = createEditor(
      [
        {id: 'b1', type: 'paragraph'},
        {id: 'b2', type: 'paragraph'},
      ],
      'comment',
    )
    placeCursorInBlock(editor, 'b2')

    expect(hasFirstBlockPlaceholder(editor, 'b1')).toBe(true)
    expect(hasFirstBlockPlaceholder(editor, 'b2')).toBe(false)

    editor._tiptapEditor.destroy()
  })
})
