// @vitest-environment jsdom
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
// BlockNoteEditor must load before the HM schema, which depends on it through a cycle.
import {BlockNoteEditor} from '../BlockNoteEditor'
import type {Block, PartialBlock} from '../extensions/Blocks/api/blockTypes'
import {isSlashMenuItemAvailable} from '../extensions/SlashMenu/BaseSlashMenuItem'
import {hmBlockSchema} from '../../../schema'
import {getSlashMenuItems} from '../../../slash-menu-items'

function createEditor(initialContent: PartialBlock<any>[]) {
  return new BlockNoteEditor({initialContent, blockSchema: hmBlockSchema})
}

const card = (id: string): PartialBlock<any> => ({id, type: 'embed', props: {url: `hm://uid/${id}`, view: 'Card'}})

function cardGrid(cardIds: string[]): PartialBlock<any>[] {
  return [
    {
      id: 'parent',
      type: 'paragraph',
      content: 'test',
      props: {childrenType: 'Grid', columnCount: '3'},
      children: cardIds.map(card),
    },
  ]
}

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

/** Selects a block's content node, as clicking a card does. */
function selectBlockContent(editor: BlockNoteEditor<any>, blockId: string) {
  const {state, view} = editor._tiptapEditor
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, blockPos(editor, blockId) + 1)))
}

function placeCursor(editor: BlockNoteEditor<any>, blockId: string) {
  const {state, view} = editor._tiptapEditor
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, blockPos(editor, blockId) + 2)))
}

function pressEnter(editor: BlockNoteEditor<any>) {
  const {view} = editor._tiptapEditor
  const event = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})
  view.someProp('handleKeyDown', (handler) => handler(view, event))
}

const shape = (blocks: Block<any>[]): unknown[] =>
  blocks.map((block) => (block.children.length ? {[block.type]: shape(block.children)} : block.type))

const cursorBlockId = (editor: BlockNoteEditor<any>) => editor.getTextCursorPosition().block.id

const gridItem = () => getSlashMenuItems().find((item) => item.name === 'Grid')!

describe('Enter on a selected card in a grid', () => {
  it('adds a new cell after the last card instead of leaving the grid', () => {
    const editor = createEditor(cardGrid(['a', 'b', 'c']))
    selectBlockContent(editor, 'c')

    pressEnter(editor)

    const [parent] = editor.topLevelBlocks
    expect(shape([parent!])).toEqual([{paragraph: ['embed', 'embed', 'embed', 'paragraph']}])
    expect(cursorBlockId(editor)).toBe(parent!.children[3]!.id)
  })

  it('adds exactly one cell after a card in the middle of the grid', () => {
    const editor = createEditor(cardGrid(['a', 'b', 'c']))
    selectBlockContent(editor, 'b')

    pressEnter(editor)

    const [parent] = editor.topLevelBlocks
    expect(shape([parent!])).toEqual([{paragraph: ['embed', 'embed', 'paragraph', 'embed']}])
    expect(cursorBlockId(editor)).toBe(parent!.children[2]!.id)
  })
})

describe('Grid slash command', () => {
  it('is not offered inside a grid cell', () => {
    const editor = createEditor([
      {
        id: 'parent',
        type: 'paragraph',
        props: {childrenType: 'Grid', columnCount: '3'},
        children: [{id: 'cell', type: 'paragraph'}],
      },
    ])
    placeCursor(editor, 'cell')

    expect(isSlashMenuItemAvailable(gridItem(), editor)).toBe(false)
  })

  it('is offered outside grids', () => {
    const editor = createEditor([{id: 'p', type: 'paragraph'}])
    placeCursor(editor, 'p')

    expect(isSlashMenuItemAvailable(gridItem(), editor)).toBe(true)
  })

  it('moves the cursor into the first cell when the grid goes under the current block', async () => {
    // The block above already has children, so the grid is added under the current block.
    const editor = createEditor([...cardGrid(['a']), {id: 'current', type: 'paragraph'}])
    placeCursor(editor, 'current')

    gridItem().execute(editor)
    await new Promise((resolve) => setTimeout(resolve))

    const current = editor.topLevelBlocks.find((block) => block.id === 'current')!
    expect(current.props.childrenType).toBe('Grid')
    expect(current.children).toHaveLength(3)
    expect(cursorBlockId(editor)).toBe(current.children[0]!.id)
  })
})

describe('Clicking an image in a grid', () => {
  it('selects the image, like images outside grids', () => {
    const url = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
    const editor = createEditor([
      {
        id: 'parent',
        type: 'paragraph',
        content: 'test',
        props: {childrenType: 'Grid', columnCount: '3'},
        children: [{id: 'img', type: 'image', props: {url, name: ''}}],
      },
    ])
    const {view} = editor._tiptapEditor
    const imagePos = blockPos(editor, 'img') + 1
    const event = new MouseEvent('click')
    Object.defineProperty(event, 'target', {value: document.createElement('img')})

    const handled = view.someProp('handleClickOn', (handler) =>
      handler(view, imagePos, view.state.doc.nodeAt(imagePos)!, imagePos, event, true),
    )

    expect(handled).toBe(true)
    const {selection} = view.state
    expect(selection instanceof NodeSelection && selection.node.type.name).toBe('image')
    expect(selection.from).toBe(imagePos)
  })
})
