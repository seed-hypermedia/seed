import {Node as PMNode, Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock(
  '../../../extensions/BlockManipulation/BlockManipulationExtension',
  () => ({
    selectableNodeTypes: [
      'image',
      'file',
      'embed',
      'video',
      'web-embed',
      'math',
      'button',
      'query',
    ],
  }),
)

import {splitBlockCommand} from '../commands/splitBlock'
import {
  buildDoc,
  createMinimalSchema,
  findPosInBlock,
} from './test-helpers-prosemirror'

describe('splitBlockCommand', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
  })

  // Helper: create state, run splitBlock, return new state
  function runSplit(
    doc: PMNode,
    pos: number,
    keepType?: boolean,
    keepProps?: boolean,
  ): EditorState {
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, pos),
    })
    let newState = state
    splitBlockCommand(pos, keepType, keepProps)({
      state,
      dispatch: (tr: any) => {
        newState = state.apply(tr)
      },
    })
    return newState
  }

  // Test 1: Split mid-text
  //
  // BEFORE:                                AFTER:
  //   blockChildren (Group)                  blockChildren (Group)
  //     blockNode (block-1)                    blockNode (block-1)
  //       paragraph "First"        →             paragraph "Fi"
  //     blockNode (block-2)                  blockNode (new)
  //       paragraph "Second"                     paragraph "rst"
  //                                          blockNode (block-2)
  //                                              paragraph "Second"
  //
  describe('split mid-text', () => {
    it('splits text at cursor into two blocks', () => {
      const doc = buildDoc(schema, [
        {id: 'block-1', text: 'First'},
        {id: 'block-2', text: 'Second'},
      ])
      const splitPos = findPosInBlock(doc, 'block-1') + 2 // after "Fi", before "r"
      const newState = runSplit(doc, splitPos)

      const topGroup = newState.doc.firstChild!
      expect(topGroup.childCount).toBe(3)

      expect(topGroup.child(0).firstChild!.textContent).toBe('Fi')
      expect(topGroup.child(1).firstChild!.textContent).toBe('rst')
      expect(topGroup.child(2).firstChild!.textContent).toBe('Second')
    })
  })

  // Test 2: Split at end of block
  //
  // BEFORE:                                AFTER:
  //   blockChildren (Group)                  blockChildren (Group)
  //     blockNode (block-1)                    blockNode (block-1)
  //       paragraph "First"        →             paragraph "First"
  //     blockNode (block-2)                  blockNode (new)
  //       paragraph "Second"                     paragraph ""
  //                                          blockNode (block-2)
  //                                              paragraph "Second"
  //
  describe('split at end of block', () => {
    it('creates empty new block after current', () => {
      const doc = buildDoc(schema, [
        {id: 'block-1', text: 'First'},
        {id: 'block-2', text: 'Second'},
      ])
      const splitPos = findPosInBlock(doc, 'block-1') + 5
      const newState = runSplit(doc, splitPos)

      const topGroup = newState.doc.firstChild!
      expect(topGroup.childCount).toBe(3)

      expect(topGroup.child(0).firstChild!.textContent).toBe('First')
      expect(topGroup.child(1).firstChild!.textContent).toBe('')
      expect(topGroup.child(2).firstChild!.textContent).toBe('Second')
    })
  })

  // Test 3: Split in Unordered list preserves list attrs
  //
  // BEFORE:                                    AFTER:
  //   blockChildren (Unordered, '1')             blockChildren (Unordered, '1')
  //     blockNode (item-1)                         blockNode (item-1)
  //       paragraph "Hello World"    →               paragraph "Hello"
  //                                              blockNode (new)
  //                                                  paragraph " World"
  //
  describe('split in Unordered list', () => {
    it('both blocks remain in the same list', () => {
      const doc = buildDoc(
        schema,
        [{id: 'item-1', text: 'Hello World'}],
        {listType: 'Unordered'},
      )
      const splitPos = findPosInBlock(doc, 'item-1') + 5
      const newState = runSplit(doc, splitPos)

      const topGroup = newState.doc.firstChild!
      expect(topGroup.type.name).toBe('blockChildren')
      expect(topGroup.attrs.listType).toBe('Unordered')
      expect(topGroup.attrs.listLevel).toBe('1')
      expect(topGroup.childCount).toBe(2)

      expect(topGroup.child(0).firstChild!.textContent).toBe('Hello')
      expect(topGroup.child(1).firstChild!.textContent).toBe(' World')
    })
  })

  // Test 4: Split block with children — children move to new block
  //
  // BEFORE:                                     AFTER:
  //   blockChildren (Group)                       blockChildren (Group)
  //     blockNode (test-root)                       blockNode (test-root)
  //       paragraph "Root paragraph"    →             paragraph "Root"
  //       blockChildren (Group)                     blockNode (new)
  //         blockNode (test-1)                        paragraph " paragraph"
  //           paragraph "Hello"                       blockChildren (Group)
  //                                                     blockNode (test-1)
  //                                                       paragraph "Hello"
  //
  describe('split block with children', () => {
    it('children move to the new block after split', () => {
      const doc = buildDoc(schema, [
        {
          id: 'test-root',
          text: 'Root paragraph',
          children: {blocks: [{id: 'test-1', text: 'Hello'}]},
        },
      ])
      const splitPos = findPosInBlock(doc, 'test-root') + 4
      const newState = runSplit(doc, splitPos)

      const topGroup = newState.doc.firstChild!
      expect(topGroup.childCount).toBe(2)

      // Original block: just "Root", no children
      const original = topGroup.child(0)
      expect(original.firstChild!.textContent).toBe('Root')
      expect(original.childCount).toBe(1) // paragraph only

      // New block: " paragraph" + blockChildren with test-1
      const newBlock = topGroup.child(1)
      expect(newBlock.firstChild!.textContent).toBe(' paragraph')
      expect(newBlock.childCount).toBe(2) // paragraph + blockChildren

      const childGroup = newBlock.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      expect(childGroup.firstChild!.attrs.id).toBe('test-1')
      expect(childGroup.firstChild!.firstChild!.textContent).toBe('Hello')
    })
  })
})
