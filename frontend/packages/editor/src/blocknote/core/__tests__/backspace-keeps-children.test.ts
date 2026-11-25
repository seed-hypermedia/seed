// @vitest-environment jsdom
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
// BlockNoteEditor must load before the HM schema, which depends on it through a cycle.
import {BlockNoteEditor} from '../BlockNoteEditor'
import type {PartialBlock} from '../extensions/Blocks/api/blockTypes'
import {getReferenceableRevisionByBlockId} from '../extensions/BlockRevision/BlockRevisionInvalidation'
import {hmBlockSchema} from '../../../schema'

function createEditor(initialContent: PartialBlock<any>[]) {
  return new BlockNoteEditor({initialContent, blockSchema: hmBlockSchema})
}

const items = (): PartialBlock<any>[] => [
  {id: 'i1', type: 'paragraph', content: 'item 1'},
  {id: 'i2', type: 'paragraph', content: 'item 2'},
]

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

function cursorAt(editor: BlockNoteEditor<any>, blockId: string, where: 'start' | 'end' = 'start') {
  const {state, view} = editor._tiptapEditor
  const pos = blockPos(editor, blockId)
  const content = state.doc.nodeAt(pos)!.firstChild!
  const p = where === 'start' ? pos + 2 : pos + 2 + content.content.size
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, p)))
}

function press(editor: BlockNoteEditor<any>, key: string) {
  const {view} = editor._tiptapEditor
  const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})
  return view.someProp('handleKeyDown', (handler) => handler(view, event))
}

type BlockTree = {id: string; text: string; childrenType?: string; columnCount?: string; children: BlockTree[]}

function docTree(editor: BlockNoteEditor<any>): BlockTree[] {
  const walk = (group: any): BlockTree[] => {
    const result: BlockTree[] = []
    group.forEach((child: any) => {
      if (child.type.name !== 'blockNode') return
      const content = child.firstChild
      const tree: BlockTree = {id: child.attrs.id, text: content.textContent, children: []}
      if (child.childCount > 1) {
        const groupNode = child.lastChild
        tree.childrenType = groupNode.attrs.listType
        if (groupNode.attrs.columnCount) tree.columnCount = groupNode.attrs.columnCount
        tree.children = walk(groupNode)
      }
      result.push(tree)
    })
    return result
  }
  return walk(editor._tiptapEditor.state.doc.firstChild)
}

function expectTree(editor: BlockNoteEditor<any>, expected: BlockTree[]) {
  const actual = docTree(editor)
  const trailing = actual.slice(expected.length)
  trailing.forEach((block) => {
    expect(block.text).toBe('')
    expect(block.children).toEqual([])
  })
  expect(actual.slice(0, expected.length)).toEqual(expected)
}

function cursorInfo(editor: BlockNoteEditor<any>) {
  const sel = editor._tiptapEditor.state.selection
  let blockId: string | undefined
  for (let d = sel.$from.depth; d > 0; d--) {
    const n = sel.$from.node(d)
    if (n.type.name === 'blockNode') {
      blockId = n.attrs.id
      break
    }
  }
  return {blockId, offset: sel.$from.parentOffset}
}

describe('Backspace re-homes children of the removed block', () => {
  it('Enter then Backspace: the list returns to the block above', () => {
    const editor = createEditor([
      {id: 'A', type: 'paragraph', content: 'one block', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'A', 'end')

    press(editor, 'Enter')

    const afterEnter = docTree(editor)
    expect(afterEnter[0]).toMatchObject({id: 'A', text: 'one block', children: []})
    expect(afterEnter[1]!.text).toBe('')
    expect(afterEnter[1]!.childrenType).toBe('Unordered')
    expect(afterEnter[1]!.children.map((c) => c.id)).toEqual(['i1', 'i2'])

    press(editor, 'Backspace')

    expectTree(editor, [
      {
        id: 'A',
        text: 'one block',
        childrenType: 'Unordered',
        children: [
          {id: 'i1', text: 'item 1', children: []},
          {id: 'i2', text: 'item 2', children: []},
        ],
      },
    ])
    expect(cursorInfo(editor)).toEqual({blockId: 'A', offset: 'one block'.length})
  })

  it('empty block owning an Unordered list merges into the block above', () => {
    const editor = createEditor([
      {id: 'A', type: 'paragraph', content: 'one block'},
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    expectTree(editor, [
      {
        id: 'A',
        text: 'one block',
        childrenType: 'Unordered',
        children: [
          {id: 'i1', text: 'item 1', children: []},
          {id: 'i2', text: 'item 2', children: []},
        ],
      },
    ])
    expect(cursorInfo(editor)).toEqual({blockId: 'A', offset: 'one block'.length})
  })

  it('same listType appends the items to the existing list', () => {
    const editor = createEditor([
      {
        id: 'A',
        type: 'paragraph',
        content: 'one block',
        props: {childrenType: 'Unordered'},
        children: [{id: 'x', type: 'paragraph', content: 'x'}],
      },
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    expectTree(editor, [
      {
        id: 'A',
        text: 'one block',
        childrenType: 'Unordered',
        children: [
          {id: 'x', text: 'x', children: []},
          {id: 'i1', text: 'item 1', children: []},
          {id: 'i2', text: 'item 2', children: []},
        ],
      },
    ])
    expect(cursorInfo(editor)).toEqual({blockId: 'x', offset: 1})
  })

  it('different listType walks down to the bottom-most block', () => {
    const editor = createEditor([
      {
        id: 'A',
        type: 'paragraph',
        content: 'one block',
        children: [{id: 'x', type: 'paragraph', content: 'x'}],
      },
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    expectTree(editor, [
      {
        id: 'A',
        text: 'one block',
        childrenType: 'Group',
        children: [
          {
            id: 'x',
            text: 'x',
            childrenType: 'Unordered',
            children: [
              {id: 'i1', text: 'item 1', children: []},
              {id: 'i2', text: 'item 2', children: []},
            ],
          },
        ],
      },
    ])
    expect(cursorInfo(editor)).toEqual({blockId: 'x', offset: 1})
  })

  it('nested append: items join the matching list deeper down', () => {
    const editor = createEditor([
      {
        id: 'A',
        type: 'paragraph',
        content: 'one block',
        children: [
          {
            id: 'x',
            type: 'paragraph',
            content: 'x',
            props: {childrenType: 'Unordered'},
            children: [{id: 'y', type: 'paragraph', content: 'y'}],
          },
        ],
      },
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    expectTree(editor, [
      {
        id: 'A',
        text: 'one block',
        childrenType: 'Group',
        children: [
          {
            id: 'x',
            text: 'x',
            childrenType: 'Unordered',
            children: [
              {id: 'y', text: 'y', children: []},
              {id: 'i1', text: 'item 1', children: []},
              {id: 'i2', text: 'item 2', children: []},
            ],
          },
        ],
      },
    ])
  })

  it('non-empty block merges text and re-homes children', () => {
    const editor = createEditor([
      {id: 'A', type: 'paragraph', content: 'one block'},
      {id: 'B', type: 'paragraph', content: 'foo', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    expectTree(editor, [
      {
        id: 'A',
        text: 'one blockfoo',
        childrenType: 'Unordered',
        children: [
          {id: 'i1', text: 'item 1', children: []},
          {id: 'i2', text: 'item 2', children: []},
        ],
      },
    ])
    expect(cursorInfo(editor)).toEqual({blockId: 'A', offset: 'one block'.length})
  })

  it.each([
    ['Ordered', {childrenType: 'Ordered'}, 'Ordered', undefined],
    ['Blockquote', {childrenType: 'Blockquote'}, 'Blockquote', undefined],
    ['Grid', {childrenType: 'Grid', columnCount: '3'}, 'Grid', '3'],
    ['Group', {}, 'Group', undefined],
  ] as const)('children of type %s keep their type when re-homed', (_name, props, listType, columnCount) => {
    const editor = createEditor([
      {id: 'A', type: 'paragraph', content: 'one block'},
      {id: 'B', type: 'paragraph', content: '', props, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    const [a] = docTree(editor)
    expect(a!.id).toBe('A')
    expect(a!.childrenType).toBe(listType)
    if (columnCount) expect(a!.columnCount).toBe(columnCount)
    expect(a!.children.map((c) => c.id)).toEqual(['i1', 'i2'])
  })

  it('nested context: siblings after the removed block stay put', () => {
    const editor = createEditor([
      {
        id: 'P',
        type: 'paragraph',
        content: 'parent',
        children: [
          {id: 'A', type: 'paragraph', content: 'one block'},
          {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
          {id: 'C', type: 'paragraph', content: 'after'},
        ],
      },
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    expectTree(editor, [
      {
        id: 'P',
        text: 'parent',
        childrenType: 'Group',
        children: [
          {
            id: 'A',
            text: 'one block',
            childrenType: 'Unordered',
            children: [
              {id: 'i1', text: 'item 1', children: []},
              {id: 'i2', text: 'item 2', children: []},
            ],
          },
          {id: 'C', text: 'after', children: []},
        ],
      },
    ])
  })

  it('previous sibling is a root Slot list with the same type: items append to it', () => {
    const editor = createEditor([
      {
        id: 'S',
        type: 'slot',
        props: {childrenType: 'Unordered'},
        children: [{id: 'a', type: 'paragraph', content: 'a'}],
      },
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    const [s] = docTree(editor)
    expect(s!.id).toBe('S')
    expect(s!.childrenType).toBe('Unordered')
    expect(s!.children.map((c) => c.id)).toEqual(['a', 'i1', 'i2'])
  })

  it('previous sibling is a root Slot list with a different type: its last item adopts', () => {
    const editor = createEditor([
      {
        id: 'S',
        type: 'slot',
        props: {childrenType: 'Ordered'},
        children: [{id: 'a', type: 'paragraph', content: 'a'}],
      },
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    const [s] = docTree(editor)
    expect(s!.id).toBe('S')
    expect(s!.childrenType).toBe('Ordered')
    expect(s!.children).toHaveLength(1)
    expect(s!.children[0]!.id).toBe('a')
    expect(s!.children[0]!.childrenType).toBe('Unordered')
    expect(s!.children[0]!.children.map((c) => c.id)).toEqual(['i1', 'i2'])
  })

  it('embed above an empty block with children: embed adopts them, embed stays selected', () => {
    const editor = createEditor([
      {id: 'A', type: 'embed', props: {url: 'hm://uid/x', view: 'Card'}},
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    const [a] = docTree(editor)
    expect(a!.id).toBe('A')
    expect(a!.childrenType).toBe('Unordered')
    expect(a!.children.map((c) => c.id)).toEqual(['i1', 'i2'])
    const sel = editor._tiptapEditor.state.selection
    expect(sel).toBeInstanceOf(NodeSelection)
    expect(sel.node.type.name).toBe('embed')
    const aPos = blockPos(editor, 'A')
    expect(sel.$from.pos).toBeGreaterThan(aPos)
    expect(sel.$from.pos).toBeLessThan(aPos + editor._tiptapEditor.state.doc.nodeAt(aPos)!.nodeSize)
  })

  it('forward Delete at the end of a block merges the next block the same way', () => {
    const editor = createEditor([
      {id: 'A', type: 'paragraph', content: 'one block'},
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'A', 'end')

    press(editor, 'Delete')

    expectTree(editor, [
      {
        id: 'A',
        text: 'one block',
        childrenType: 'Unordered',
        children: [
          {id: 'i1', text: 'item 1', children: []},
          {id: 'i2', text: 'item 2', children: []},
        ],
      },
    ])
  })

  it('undo restores the original document', () => {
    const editor = createEditor([
      {id: 'A', type: 'paragraph', content: 'one block'},
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')
    const before = docTree(editor)

    press(editor, 'Backspace')
    editor._tiptapEditor.commands.undo()

    expectTree(editor, before)
  })

  it('moved children and untouched ancestors keep their revisions', () => {
    const rev = (id: string) => ({props: {revision: `rev-${id}`}})
    const editor = createEditor([
      {
        id: 'A',
        type: 'paragraph',
        content: 'one block',
        ...rev('A'),
        children: [{id: 'x', type: 'paragraph', content: 'x', ...rev('x')}],
      },
      {
        id: 'B',
        type: 'paragraph',
        content: '',
        props: {childrenType: 'Unordered', revision: 'rev-B'},
        children: [
          {id: 'i1', type: 'paragraph', content: 'item 1', ...rev('i1')},
          {id: 'i2', type: 'paragraph', content: 'item 2', ...rev('i2')},
        ],
      },
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    const doc = editor._tiptapEditor.state.doc
    expect(getReferenceableRevisionByBlockId(doc, 'A')).toBe('rev-A')
    expect(getReferenceableRevisionByBlockId(doc, 'x')).toBe('rev-x')
    expect(getReferenceableRevisionByBlockId(doc, 'i1')).toBe('rev-i1')
    expect(getReferenceableRevisionByBlockId(doc, 'i2')).toBe('rev-i2')
  })

  it('a text-merged block loses its revision', () => {
    const editor = createEditor([
      {id: 'A', type: 'paragraph', content: 'one block', props: {revision: 'rev-A'}},
      {
        id: 'B',
        type: 'paragraph',
        content: 'foo',
        props: {childrenType: 'Unordered', revision: 'rev-B'},
        children: items(),
      },
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    expect(getReferenceableRevisionByBlockId(editor._tiptapEditor.state.doc, 'A')).toBe('')
  })
})

describe('Backspace regressions', () => {
  it('empty block WITHOUT children still merges as before', () => {
    const editor = createEditor([
      {id: 'A', type: 'paragraph', content: 'one block'},
      {id: 'B', type: 'paragraph', content: ''},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    expectTree(editor, [{id: 'A', text: 'one block', children: []}])
    expect(cursorInfo(editor)).toEqual({blockId: 'A', offset: 'one block'.length})
  })

  it('non-empty paragraph with children below an embed: only NodeSelects the embed', () => {
    const editor = createEditor([
      {id: 'A', type: 'embed', props: {url: 'hm://uid/x', view: 'Card'}},
      {id: 'B', type: 'paragraph', content: 'foo', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')

    press(editor, 'Backspace')

    const tree = docTree(editor)
    expect(tree).toHaveLength(2)
    expect(tree[1]).toMatchObject({id: 'B', text: 'foo', childrenType: 'Unordered'})
    expect(tree[1]!.children.map((c) => c.id)).toEqual(['i1', 'i2'])
    const sel = editor._tiptapEditor.state.selection
    expect(sel).toBeInstanceOf(NodeSelection)
    expect(sel.node.type.name).toBe('embed')
  })

  it('empty block with children below a table: nothing happens', () => {
    const editor = createEditor([
      {
        id: 'T',
        type: 'table',
        props: {},
        content: [],
        children: [
          {id: 'col-0', type: 'tableColumn', props: {}, content: [], children: []},
          {
            id: 'row-0',
            type: 'tableRow',
            props: {},
            content: [],
            children: [
              {
                id: 'cell-0',
                type: 'paragraph',
                props: {columnId: 'col-0'},
                content: [{type: 'text', text: 'c', styles: {}}],
                children: [],
              },
            ],
          },
        ] as any,
      } as PartialBlock<any>,
      {id: 'B', type: 'paragraph', content: '', props: {childrenType: 'Unordered'}, children: items()},
    ])
    cursorAt(editor, 'B')
    const before = editor._tiptapEditor.state.doc.toJSON()

    press(editor, 'Backspace')

    expect(editor._tiptapEditor.state.doc.toJSON()).toEqual(before)
  })
})
