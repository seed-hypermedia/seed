// @vitest-environment jsdom

import {TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
import {BlockNoteEditor} from '../BlockNoteEditor'
import type {PartialBlock} from '../extensions/Blocks/api/blockTypes'
import {getBlockInfoWithManualOffset} from '../extensions/Blocks/helpers/getBlockInfoFromPos'

type PartialAnyBlock = PartialBlock<any>

function createEditor(initialContent: PartialAnyBlock[]) {
  return new BlockNoteEditor({
    initialContent,
  })
}

function getBlockInfo(editor: BlockNoteEditor<any>, blockId: string) {
  let result: ReturnType<typeof getBlockInfoWithManualOffset> | null = null

  editor._tiptapEditor.state.doc.descendants((node, pos) => {
    if (result) return false

    if (node.type.name === 'blockNode' && node.attrs.id === blockId) {
      result = getBlockInfoWithManualOffset(node, pos)
      return false
    }

    return true
  })

  if (!result) {
    throw new Error(`Block "${blockId}" not found`)
  }

  return result
}

function setTextSelection(editor: BlockNoteEditor<any>, from: number, to = from) {
  const {state, view} = editor._tiptapEditor
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

function blockElement(editor: BlockNoteEditor<any>, blockId: string) {
  const element = editor._tiptapEditor.view.dom.querySelector(`[data-id="${blockId}"]`)

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Block "${blockId}" element not found`)
  }

  return element
}

describe('heading section selection', () => {
  it('keeps heading-to-child text selections out of full-block selection', () => {
    const editor = createEditor([
      {
        id: 'section',
        type: 'heading',
        content: 'Heading',
        children: [{id: 'child', type: 'paragraph', content: 'Child text'}],
      },
    ])
    const heading = getBlockInfo(editor, 'section')
    const child = getBlockInfo(editor, 'child')

    setTextSelection(editor, heading.blockContent.beforePos + 2, child.blockContent.afterPos - 1)

    expect(blockElement(editor, 'section').classList.contains('bn-full-block-selected')).toBe(false)
    expect(blockElement(editor, 'child').classList.contains('bn-full-block-selected')).toBe(false)

    editor._tiptapEditor.destroy()
  })

  it('marks fully covered non-heading child blocks for side-menu dragging', () => {
    const editor = createEditor([
      {
        id: 'parent',
        type: 'paragraph',
        content: 'Parent',
        children: [{id: 'child', type: 'paragraph', content: 'Child text'}],
      },
    ])
    const parent = getBlockInfo(editor, 'parent')
    const child = getBlockInfo(editor, 'child')

    setTextSelection(editor, parent.blockContent.beforePos + 3, child.blockContent.afterPos - 1)

    expect(blockElement(editor, 'parent').classList.contains('bn-full-block-selected')).toBe(false)
    expect(blockElement(editor, 'child').classList.contains('bn-full-block-selected')).toBe(true)

    editor._tiptapEditor.destroy()
  })

  it('shows the side menu for fully covered non-heading child blocks', () => {
    const editor = createEditor([
      {
        id: 'parent',
        type: 'paragraph',
        content: 'Parent',
        children: [{id: 'child', type: 'paragraph', content: 'Child text'}],
      },
    ])
    const child = getBlockInfo(editor, 'child')
    let latestSideMenuState: {show: boolean; block: {id: string}} | undefined
    const unsubscribe = editor.sideMenu!.onUpdate((state) => {
      latestSideMenuState = state
    })

    setTextSelection(editor, child.blockContent.beforePos + 1, child.blockContent.afterPos - 1)

    expect(latestSideMenuState?.show).toBe(true)
    expect(latestSideMenuState?.block.id).toBe('child')

    unsubscribe()
    editor._tiptapEditor.destroy()
  })

  it('hides the heading section background while text is selected', () => {
    const editor = createEditor([
      {
        id: 'section',
        type: 'heading',
        content: 'Heading',
        children: [{id: 'child', type: 'paragraph', content: 'Child text'}],
      },
    ])
    const child = getBlockInfo(editor, 'child')
    const sectionElement = blockElement(editor, 'section')

    setTextSelection(editor, child.blockContent.beforePos + 2)
    expect(sectionElement.classList.contains('selection-in-section')).toBe(true)

    setTextSelection(editor, child.blockContent.beforePos + 2, child.blockContent.beforePos + 6)
    expect(sectionElement.classList.contains('selection-in-section')).toBe(false)

    editor._tiptapEditor.destroy()
  })
})
