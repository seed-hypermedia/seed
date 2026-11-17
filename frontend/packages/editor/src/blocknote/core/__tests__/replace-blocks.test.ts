import {afterEach, describe, expect, it} from 'vitest'
import {BlockNoteEditor} from '../BlockNoteEditor'
import type {PartialBlock} from '../extensions/Blocks/api/blockTypes'

let editor: BlockNoteEditor<any>

afterEach(() => editor?._tiptapEditor.destroy())

function setup(blocks: PartialBlock<any>[]) {
  editor = new BlockNoteEditor({initialContent: blocks})
}

describe('replaceBlocks', () => {
  it('replaces content with retained IDs without exposing duplicate blocks to observers', () => {
    setup([
      {id: 'heading', type: 'heading', content: 'Issues'},
      {id: 'query', type: 'query', props: {style: 'Card'}},
    ])
    const observedIds: string[][] = []
    editor._tiptapEditor.on('transaction', ({editor: tiptap}) => {
      const ids: string[] = []
      tiptap.state.doc.descendants((node) => {
        if (node.type.name === 'blockNode') ids.push(node.attrs.id)
      })
      observedIds.push(ids)
    })

    editor.replaceBlocks(editor.topLevelBlocks, [
      {id: 'heading', type: 'heading', content: 'Updated issues'},
      {id: 'query', type: 'query', props: {style: 'Table'}},
    ])

    expect(editor.getBlock('heading')?.content).toEqual([{type: 'text', text: 'Updated issues', styles: {}}])
    expect(editor.getBlock('query')?.props.style).toBe('Table')
    expect(observedIds.length).toBeGreaterThan(0)
    for (const ids of observedIds) {
      expect(ids.filter((id) => id === 'heading')).toHaveLength(1)
      expect(ids.filter((id) => id === 'query')).toHaveLength(1)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('restores the previous document with one undo', () => {
    setup([{id: 'text', type: 'paragraph', content: 'Before'}])
    editor.replaceBlocks(['text'], [{id: 'text', type: 'paragraph', content: 'After'}])
    expect(editor.getBlock('text')?.content).toEqual([{type: 'text', text: 'After', styles: {}}])

    expect(editor._tiptapEditor.commands.undo()).toBe(true)
    expect(editor.getBlock('text')?.content).toEqual([{type: 'text', text: 'Before', styles: {}}])
    expect(editor._tiptapEditor.commands.redo()).toBe(true)
    expect(editor.getBlock('text')?.content).toEqual([{type: 'text', text: 'After', styles: {}}])
  })

  it('inserts at the first requested block even when removals are out of document order', () => {
    setup([
      ...['a', 'b', 'c', 'd'].map((id) => ({id, type: 'paragraph', content: id})),
      {id: 'trailing', type: 'paragraph'},
    ])
    editor.replaceBlocks(['c', 'a'], [{id: 'replacement', type: 'paragraph', content: 'Replacement'}])
    expect(editor.topLevelBlocks.map((block) => block.id)).toEqual(['b', 'replacement', 'd', 'trailing'])
  })

  it('replaces the only nested child without removing its parent or siblings', () => {
    setup([
      {
        id: 'parent',
        type: 'paragraph',
        content: 'Parent',
        children: [{id: 'child', type: 'paragraph', content: 'Child'}],
      },
      {id: 'sibling', type: 'paragraph', content: 'Sibling'},
      {id: 'trailing', type: 'paragraph'},
    ])
    editor.replaceBlocks(['child'], [{id: 'child', type: 'paragraph', content: 'Updated child'}])
    expect(editor.topLevelBlocks.map((block) => block.id)).toEqual(['parent', 'sibling', 'trailing'])
    expect(editor.getBlock('parent')?.children).toMatchObject([
      {id: 'child', content: [{type: 'text', text: 'Updated child'}]},
    ])
  })

  it('does not mutate the document when a requested block is missing', () => {
    setup([{id: 'original', type: 'paragraph', content: 'Original'}])
    const before = editor.topLevelBlocks
    expect(() =>
      editor.replaceBlocks(['original', 'missing'], [{id: 'replacement', type: 'paragraph', content: 'Replacement'}]),
    ).toThrow('Blocks with the following IDs could not be found')
    expect(editor.topLevelBlocks).toEqual(before)
  })
})
