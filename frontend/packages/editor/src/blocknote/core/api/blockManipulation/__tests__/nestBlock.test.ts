import {Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {beforeEach, describe, expect, it} from 'vitest'
import {sinkListItem} from '../commands/nestBlock'
import {buildDoc, createMinimalSchema, findPosInBlock} from './test-helpers-prosemirror'

describe('nestBlock - custom sinkListItem', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
  })

  // Helper: call custom sinkListItem and return new state
  function runSink(state: EditorState, listType: string, listLevel: string): EditorState | undefined {
    const itemType = schema.nodes['blockNode']!
    const groupType = schema.nodes['blockChildren']!
    const cmd = sinkListItem(itemType, groupType, listType as any, listLevel)

    let newState: EditorState | undefined
    cmd({
      state,
      dispatch: (tr: any) => {
        newState = state.apply(tr) as EditorState
      },
    })
    return newState
  }

  // Test 1: Simple nest — sink block into previous sibling in a Group
  //
  // BEFORE:                            AFTER:
  //   blockChildren (Group)              blockChildren (Group)
  //     blockNode (block-1)                blockNode (block-1)
  //       paragraph "First"                  paragraph "First"
  //     blockNode (block-2)       →          blockChildren (Group)
  //       paragraph "Second"                   blockNode (block-2)
  //                                              paragraph "Second"
  //
  it('sinks block into previous sibling in Group', () => {
    const doc = buildDoc(schema, [
      {id: 'block-1', text: 'First'},
      {id: 'block-2', text: 'Second'},
    ])
    const pos = findPosInBlock(doc, 'block-2')
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, pos),
    })

    const newState = runSink(state, 'Group', '1')
    expect(newState).toBeDefined()

    // Top group should have 1 child now
    const topGroup = newState!.doc.firstChild!
    expect(topGroup.childCount).toBe(1)

    const block1 = topGroup.firstChild!
    expect(block1.attrs.id).toBe('block-1')
    expect(block1.firstChild!.textContent).toBe('First')

    // block-1 should have a nested blockChildren
    const nested = block1.lastChild!
    expect(nested.type.name).toBe('blockChildren')
    expect(nested.attrs.listType).toBe('Group')
    expect(nested.attrs.listLevel).toBe('1')

    // block-2 should be the first child of block-1
    const block2 = nested.firstChild!
    expect(block2.attrs.id).toBe('block-2')
    expect(block2.firstChild!.textContent).toBe('Second')
  })

  // Test 2: Sink in list — creates nested list preserving type & level
  //
  // BEFORE:                                    AFTER:
  //   ... > blockChildren (Unordered, '1')       ... > blockChildren (Unordered, '1')
  //     blockNode (item-1)                         blockNode (item-1)
  //       paragraph "First"                          paragraph "First"
  //     blockNode (item-2)              →            blockChildren (Unordered, '2')
  //       paragraph "Second"                           blockNode (item-2)
  //                                                      paragraph "Second"
  //
  it('sinks list item creating nested list with preserved type', () => {
    const doc = buildDoc(schema, [
      {
        id: 'root',
        text: 'Root',
        children: {
          listType: 'Unordered',
          blocks: [
            {id: 'item-1', text: 'First'},
            {id: 'item-2', text: 'Second'},
          ],
        },
      },
    ])
    const pos = findPosInBlock(doc, 'item-2')
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, pos),
    })

    const newState = runSink(state, 'Unordered', '2')
    expect(newState).toBeDefined()

    // Navigate to the Unordered list
    const rootNode = newState!.doc.firstChild!.firstChild!
    const list = rootNode.lastChild!
    expect(list.type.name).toBe('blockChildren')
    expect(list.attrs.listType).toBe('Unordered')

    // Should have 1 child now
    expect(list.childCount).toBe(1)

    const item1 = list.firstChild!
    expect(item1.attrs.id).toBe('item-1')
    expect(item1.firstChild!.textContent).toBe('First')

    // Nested list
    const nestedList = item1.lastChild!
    expect(nestedList.type.name).toBe('blockChildren')
    expect(nestedList.attrs.listType).toBe('Unordered')
    expect(nestedList.attrs.listLevel).toBe('2')

    // item-2 should be the first child of item-1
    const item2 = nestedList.firstChild!
    expect(item2.attrs.id).toBe('item-2')
    expect(item2.firstChild!.textContent).toBe('Second')
  })

  // Test 3: Sink into sibling that already has a nested list
  //
  // BEFORE:                                       AFTER:
  //   blockChildren (Group)                         blockChildren (Group)
  //     blockNode (block-a)                           blockNode (block-a)
  //       paragraph "A"                                 paragraph "A"
  //       blockChildren (Unordered)                     blockChildren (Unordered)
  //         blockNode (block-b)                           blockNode (block-b)
  //           paragraph "B"                                 paragraph "B"
  //     blockNode (block-c)              →                blockNode (block-c)
  //       paragraph "C"                                     paragraph "C"
  //
  it('sinks block into sibling with existing nested list', () => {
    const doc = buildDoc(schema, [
      {
        id: 'block-a',
        text: 'A',
        children: {
          listType: 'Unordered',
          blocks: [{id: 'block-b', text: 'B'}],
        },
      },
      {id: 'block-c', text: 'C'},
    ])
    const pos = findPosInBlock(doc, 'block-c')
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, pos),
    })

    const newState = runSink(state, 'Group', '1')
    expect(newState).toBeDefined()

    // Top group should have 1 child
    const topGroup = newState!.doc.firstChild!
    expect(topGroup.childCount).toBe(1)

    const blockA = topGroup.firstChild!
    expect(blockA.attrs.id).toBe('block-a')
    expect(blockA.firstChild!.textContent).toBe('A')

    // A's nested list should now have 2 children (B and C)
    const nestedList = blockA.lastChild!
    expect(nestedList.type.name).toBe('blockChildren')
    expect(nestedList.attrs.listType).toBe('Unordered') // preserved from original

    expect(nestedList.childCount).toBe(2)

    const blockB = nestedList.firstChild!
    expect(blockB.attrs.id).toBe('block-b')
    expect(blockB.firstChild!.textContent).toBe('B')

    const blockC = nestedList.child(1)
    expect(blockC.attrs.id).toBe('block-c')
    expect(blockC.firstChild!.textContent).toBe('C')
  })
})
