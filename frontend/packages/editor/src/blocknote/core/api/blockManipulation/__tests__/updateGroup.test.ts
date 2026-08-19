import {Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {getGroupInfoFromPos} from '../../../extensions/Blocks/helpers/getGroupInfoFromPos'
import {liftFirstSlotItemCommand, nestFirstSlotItemCommand, updateGroupCommand} from '../commands/updateGroup'
import {buildDoc, createMinimalSchema, createMockEditor, findPosInBlock} from './test-helpers-prosemirror'

describe('updateGroup command', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Helper: run command and return new state from dispatch (for synchronous paths)
  function runCommand(
    state: EditorState,
    editor: any,
    command: ReturnType<typeof updateGroupCommand>,
  ): EditorState | undefined {
    let newState: EditorState | undefined
    command({
      editor,
      state,
      dispatch: (tr: any) => {
        newState = state.apply(tr || state.tr) as EditorState
      },
    })
    return newState
  }

  // Helper: run command that defers via setTimeout (sink paths)
  // Returns editor.state after timers run
  function runDeferredCommand(
    state: EditorState,
    editor: any,
    command: ReturnType<typeof updateGroupCommand>,
  ): EditorState {
    command({
      editor,
      state,
      dispatch: (tr: any) => {
        editor.state = state.apply(tr || state.tr) as EditorState
      },
    })
    vi.runAllTimers()
    return editor.state
  }

  it('wraps a root block in a Slot when it becomes a list', () => {
    const doc = buildDoc(schema, [{id: 'item-1', text: '- '}])
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, findPosInBlock(doc, 'item-1')),
    })
    const editor = createMockEditor(state)
    const onRootChildrenTypeChange = vi.fn()
    editor._onRootChildrenTypeChange = onRootChildrenTypeChange

    const pos = findPosInBlock(doc, 'item-1')
    const command = updateGroupCommand(pos, 'Unordered', false)
    const newState = runDeferredCommand(state, editor, command)

    // Root blockChildren stays Group.
    const rootGroup = newState.doc.firstChild!
    expect(rootGroup.type.name).toBe('blockChildren')
    expect(rootGroup.attrs.listType).toBe('Group')

    // The root block is now wrapped in a Slot blockNode.
    const slotBlock = rootGroup.firstChild!
    expect(slotBlock.type.name).toBe('blockNode')
    expect(slotBlock.firstChild!.type.name).toBe('slot')

    // The slot's blockChildren carries the Unordered grouping and holds item-1.
    const innerGroup = slotBlock.lastChild!
    expect(innerGroup.type.name).toBe('blockChildren')
    expect(innerGroup.attrs.listType).toBe('Unordered')

    const item = innerGroup.firstChild!
    expect(item.type.name).toBe('blockNode')
    expect(item.attrs.id).toBe('item-1')
    expect(item.firstChild!.textContent).toBe('- ')

    // The legacy metadata side-channel must not fire anymore.
    expect(onRootChildrenTypeChange).not.toHaveBeenCalled()
  })

  // Test 1: Toggle blockChildren from Group to Unordered
  //
  // BEFORE:                                    AFTER:
  //   blockChildren (Group)                      blockChildren (Group)
  //     blockNode (test-root)                      blockNode (test-root)
  //       paragraph "Root paragraph"                 paragraph "Root paragraph"
  //       blockChildren (Group)             →        blockChildren (Unordered)
  //         blockNode (test-1)                         blockNode (test-1)
  //           paragraph "Hello"                          paragraph "Hello"
  //
  describe('Group → list type', () => {
    it('updates blockChildren to Unordered', () => {
      const doc = buildDoc(schema, [
        {
          id: 'test-root',
          text: 'Root paragraph',
          children: {blocks: [{id: 'test-1', text: 'Hello'}]},
        },
      ])
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'test-1')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Unordered', false)

      const newState = runCommand(state, editor, command)
      expect(newState).toBeDefined()

      const childGroup = newState!.doc.firstChild!.firstChild!.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      expect(childGroup.attrs.listType).toBe('Unordered')

      const child = childGroup.firstChild!
      expect(child.type.name).toBe('blockNode')
      expect(child.attrs.id).toBe('test-1')
      expect(child.firstChild!.textContent).toBe('Hello')
    })

    it('updates blockChildren to Ordered', () => {
      const doc = buildDoc(schema, [
        {
          id: 'test-root',
          text: 'Root paragraph',
          children: {blocks: [{id: 'test-1', text: 'Hello'}]},
        },
      ])
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'test-1')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Ordered', false)

      const newState = runCommand(state, editor, command)
      expect(newState).toBeDefined()

      const childGroup = newState!.doc.firstChild!.firstChild!.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      expect(childGroup.attrs.listType).toBe('Ordered')

      const child = childGroup.firstChild!
      expect(child.type.name).toBe('blockNode')
      expect(child.firstChild!.textContent).toBe('Hello')
    })
  })

  // Unwrap: turning a slot's item back into a Group lifts it to the root and
  // discards the slot.
  it('unwraps a Slot when its item is turned back into a Group', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'blockChildren',
          attrs: {listType: 'Group', listLevel: '1', columnCount: null},
          content: [
            {
              type: 'blockNode',
              attrs: {id: 'slot-wrapper'},
              content: [
                {type: 'slot', attrs: {childrenType: 'Unordered', listLevel: '1', columnCount: ''}},
                {
                  type: 'blockChildren',
                  attrs: {listType: 'Unordered', listLevel: '1', columnCount: null},
                  content: [
                    {
                      type: 'blockNode',
                      attrs: {id: 'item-1'},
                      content: [{type: 'paragraph', content: [{type: 'text', text: 'test'}]}],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    const pos = findPosInBlock(doc, 'item-1')
    const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
    const editor = createMockEditor(state)

    const command = updateGroupCommand(pos, 'Group', false, undefined, true)
    const newState = runCommand(state, editor, command)!

    // The slot is gone and item-1 is now a plain root child.
    const rootGroup = newState.doc.firstChild!
    expect(rootGroup.attrs.listType).toBe('Group')
    expect(rootGroup.childCount).toBe(1)

    const lifted = rootGroup.firstChild!
    expect(lifted.type.name).toBe('blockNode')
    expect(lifted.attrs.id).toBe('item-1')
    expect(lifted.firstChild!.type.name).toBe('paragraph')
    expect(lifted.firstChild!.textContent).toBe('test')

    // No slot node remains anywhere.
    let hasSlot = false
    newState.doc.descendants((node) => {
      if (node.type.name === 'slot') hasSlot = true
    })
    expect(hasSlot).toBe(false)
  })

  it('leaves the cursor inside the wrapped item, not the next block', () => {
    // Mimics the state right after the input rule's deleteRange: an empty
    // paragraph followed by another block.
    const doc = buildDoc(schema, [
      {id: 'item-1', text: ''},
      {id: 'next', text: 'next'},
    ])
    const pos = findPosInBlock(doc, 'item-1')
    const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
    const editor = createMockEditor(state)

    const newState = runDeferredCommand(state, editor, updateGroupCommand(pos, 'Unordered', false))

    // Check the cursor is in correct block by ID.
    const $from = newState.selection.$from
    let containerId: string | null = null
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'blockNode') {
        containerId = $from.node(d).attrs.id
        break
      }
    }
    expect(containerId).toBe('item-1')
  })

  // Shift-Tab / Backspace on the first item of a root Slot list lifts only that
  // item to the root. The remaining items stay grouped in the Slot.
  describe('lift first root Slot item', () => {
    function rootSlotDoc(itemTexts: string[]) {
      return schema.nodeFromJSON({
        type: 'doc',
        content: [
          {
            type: 'blockChildren',
            attrs: {listType: 'Group', listLevel: '1', columnCount: null},
            content: [
              {
                type: 'blockNode',
                attrs: {id: 'slot-wrapper'},
                content: [
                  {type: 'slot', attrs: {childrenType: 'Unordered', listLevel: '1', columnCount: ''}},
                  {
                    type: 'blockChildren',
                    attrs: {listType: 'Unordered', listLevel: '1', columnCount: null},
                    content: itemTexts.map((text, i) => ({
                      type: 'blockNode',
                      attrs: {id: `item-${i + 1}`},
                      content: [{type: 'paragraph', content: [{type: 'text', text}]}],
                    })),
                  },
                ],
              },
            ],
          },
        ],
      })
    }

    it('lifts the first item to root and keeps the rest grouped', () => {
      const doc = rootSlotDoc(['one', 'two', 'three'])
      const pos = findPosInBlock(doc, 'item-1')
      const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
      const editor = createMockEditor(state)

      const newState = runCommand(state, editor, liftFirstSlotItemCommand())!

      const rootGroup = newState.doc.firstChild!
      expect(rootGroup.childCount).toBe(2)

      // First child: the lifted item, now a plain root block.
      const lifted = rootGroup.firstChild!
      expect(lifted.type.name).toBe('blockNode')
      expect(lifted.attrs.id).toBe('item-1')
      expect(lifted.firstChild!.type.name).toBe('paragraph')
      expect(lifted.firstChild!.textContent).toBe('one')

      // Second child: the Slot with the remaining items still grouped.
      const slotWrap = rootGroup.lastChild!
      expect(slotWrap.firstChild!.type.name).toBe('slot')
      const innerGroup = slotWrap.lastChild!
      expect(innerGroup.attrs.listType).toBe('Unordered')
      expect(innerGroup.childCount).toBe(2)
      expect(innerGroup.child(0).attrs.id).toBe('item-2')
      expect(innerGroup.child(1).attrs.id).toBe('item-3')
    })

    it('unwraps the Slot entirely when it holds a single item', () => {
      const doc = rootSlotDoc(['only'])
      const pos = findPosInBlock(doc, 'item-1')
      const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
      const editor = createMockEditor(state)

      const newState = runCommand(state, editor, liftFirstSlotItemCommand())!

      const rootGroup = newState.doc.firstChild!
      expect(rootGroup.childCount).toBe(1)
      expect(rootGroup.firstChild!.attrs.id).toBe('item-1')
      expect(rootGroup.firstChild!.firstChild!.textContent).toBe('only')

      let hasSlot = false
      newState.doc.descendants((node) => {
        if (node.type.name === 'slot') hasSlot = true
      })
      expect(hasSlot).toBe(false)
    })

    it('does nothing when the cursor is not at the item start', () => {
      const doc = rootSlotDoc(['one', 'two'])
      // Place the cursor after the first character of item-1.
      const pos = findPosInBlock(doc, 'item-1') + 1
      const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
      const editor = createMockEditor(state)

      const newState = runCommand(state, editor, liftFirstSlotItemCommand({requireAtStart: true}))
      // Command returns false so no dispatch.
      expect(newState).toBeUndefined()
    })
  })

  // Tab on the first item of a root-level slot list nests the whole list under
  // the previous root block and drops the slot.
  it('nests a root Slot list under its previous sibling on Tab', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'blockChildren',
          attrs: {listType: 'Group', listLevel: '1', columnCount: null},
          content: [
            {
              type: 'blockNode',
              attrs: {id: 'prev'},
              content: [{type: 'paragraph', content: [{type: 'text', text: 'test'}]}],
            },
            {
              type: 'blockNode',
              attrs: {id: 'slot-wrapper'},
              content: [
                {type: 'slot', attrs: {childrenType: 'Unordered', listLevel: '1', columnCount: ''}},
                {
                  type: 'blockChildren',
                  attrs: {listType: 'Unordered', listLevel: '1', columnCount: null},
                  content: [
                    {
                      type: 'blockNode',
                      attrs: {id: 'item-1'},
                      content: [{type: 'paragraph', content: [{type: 'text', text: 'bullet'}]}],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    const pos = findPosInBlock(doc, 'item-1')
    const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
    const editor = createMockEditor(state)

    const newState = runCommand(state, editor, nestFirstSlotItemCommand())!

    // Root now has one child: the previous block, with the list nested under it.
    const rootGroup = newState.doc.firstChild!
    expect(rootGroup.childCount).toBe(1)

    const prev = rootGroup.firstChild!
    expect(prev.attrs.id).toBe('prev')
    expect(prev.firstChild!.textContent).toBe('test')

    const nested = prev.lastChild!
    expect(nested.type.name).toBe('blockChildren')
    expect(nested.attrs.listType).toBe('Unordered')
    expect(nested.firstChild!.attrs.id).toBe('item-1')
    expect(nested.firstChild!.firstChild!.textContent).toBe('bullet')

    let hasSlot = false
    newState.doc.descendants((node) => {
      if (node.type.name === 'slot') hasSlot = true
    })
    expect(hasSlot).toBe(false)
  })
  //
  // BEFORE:                                    AFTER:
  //   blockChildren (Group)                      blockChildren (Group)
  //     blockNode (block-1)                        blockNode (block-1)
  //       paragraph "First"                          paragraph "First"
  //     blockNode (block-2)                →       blockNode (slot wrapper)
  //       paragraph "Second"                         slot
  //                                                  blockChildren (Unordered)
  //                                                    blockNode (block-2)
  //                                                      paragraph "Second"
  //
  describe('list on a non-first root block', () => {
    it('wraps the block in a root-level Slot instead of nesting it', () => {
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
      const editor = createMockEditor(state)

      const command = updateGroupCommand(pos, 'Unordered', false)
      // The root wrap is deferred (so an input rule's deleteRange runs first).
      const newState = runDeferredCommand(state, editor, command)

      // Root stays Group with two children: the plain paragraph and the Slot.
      const topGroup = newState.doc.firstChild!
      expect(topGroup.attrs.listType).toBe('Group')
      expect(topGroup.childCount).toBe(2)

      // First child is untouched.
      const block1 = topGroup.firstChild!
      expect(block1.attrs.id).toBe('block-1')
      expect(block1.firstChild!.textContent).toBe('First')

      // Second child is the Slot wrapper.
      const slotBlock = topGroup.lastChild!
      expect(slotBlock.type.name).toBe('blockNode')
      expect(slotBlock.firstChild!.type.name).toBe('slot')

      const innerGroup = slotBlock.lastChild!
      expect(innerGroup.type.name).toBe('blockChildren')
      expect(innerGroup.attrs.listType).toBe('Unordered')

      const block2 = innerGroup.firstChild!
      expect(block2.attrs.id).toBe('block-2')
      expect(block2.firstChild!.textContent).toBe('Second')
    })
  })

  // Test 3: Toggle list type back to Group (remove list)
  //
  // BEFORE:                                    AFTER:
  //   blockChildren (Group)                      blockChildren (Group)
  //     blockNode (test-root)                      blockNode (test-root)
  //       paragraph "Root paragraph"                 paragraph "Root paragraph"
  //       blockChildren (Unordered)         →        blockChildren (Group)
  //         blockNode (test-1)                         blockNode (test-1)
  //           paragraph "Hello"                          paragraph "Hello"
  //
  describe('list type → Group', () => {
    it('updates Unordered to Group', () => {
      const doc = buildDoc(schema, [
        {
          id: 'test-root',
          text: 'Root paragraph',
          children: {
            listType: 'Unordered',
            blocks: [{id: 'test-1', text: 'Hello'}],
          },
        },
      ])
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'test-1')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Group', false)

      const newState = runCommand(state, editor, command)
      expect(newState).toBeDefined()

      const childGroup = newState!.doc.firstChild!.firstChild!.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      expect(childGroup.attrs.listType).toBe('Group')

      const child = childGroup.firstChild!
      expect(child.type.name).toBe('blockNode')
      expect(child.attrs.id).toBe('test-1')
      expect(child.firstChild!.textContent).toBe('Hello')
    })
  })

  // Test 4: Switch between list types (Unordered → Ordered)
  //
  // BEFORE:                                    AFTER:
  //   blockChildren (Group)                      blockChildren (Group)
  //     blockNode (test-root)                      blockNode (test-root)
  //       paragraph "Root paragraph"                 paragraph "Root paragraph"
  //       blockChildren (Unordered)         →        blockChildren (Ordered)
  //         blockNode (test-1)                         blockNode (test-1)
  //           paragraph "Hello"                          paragraph "Hello"
  //
  describe('list type switching', () => {
    it('switches Unordered to Ordered', () => {
      const doc = buildDoc(schema, [
        {
          id: 'test-root',
          text: 'Root paragraph',
          children: {
            listType: 'Unordered',
            blocks: [{id: 'test-1', text: 'Hello'}],
          },
        },
      ])
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'test-1')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Ordered', false, undefined, true)

      const newState = runCommand(state, editor, command)
      expect(newState).toBeDefined()

      const childGroup = newState!.doc.firstChild!.firstChild!.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      expect(childGroup.attrs.listType).toBe('Ordered')

      const child = childGroup.firstChild!
      expect(child.type.name).toBe('blockNode')
      expect(child.firstChild!.textContent).toBe('Hello')
    })
  })

  // Test 5: Sink last item into nested list of different type
  //
  // BEFORE:                                    AFTER:
  //     blockChildren (Unordered)                  blockChildren (Unordered)
  //       blockNode (item-1)                         blockNode (item-1)
  //         paragraph "First"                          paragraph "First"
  //       blockNode (item-2)              →            blockChildren (Ordered)
  //         paragraph "Second"                           blockNode (item-2)
  //                                                        paragraph "Second"
  //
  describe('sink into nested list with updateGroup command', () => {
    it('sinks last item into previous sibling with different list type', () => {
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
      const editor = createMockEditor(state)

      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Ordered', false)

      const newState = runDeferredCommand(state, editor, command)

      const rootNode = newState.doc.firstChild!.firstChild!
      const outerList = rootNode.lastChild!
      expect(outerList.type.name).toBe('blockChildren')
      expect(outerList.attrs.listType).toBe('Unordered')

      const item1 = outerList.firstChild!
      expect(item1.type.name).toBe('blockNode')
      expect(item1.attrs.id).toBe('item-1')
      expect(item1.firstChild!.textContent).toBe('First')

      // item-1 should now have a nested blockChildren
      const nestedList = item1.lastChild!
      expect(nestedList.type.name).toBe('blockChildren')
      expect(nestedList.attrs.listType).toBe('Ordered')

      const item2 = nestedList.firstChild!
      expect(item2.type.name).toBe('blockNode')
      expect(item2.attrs.id).toBe('item-2')
      expect(item2.firstChild!.textContent).toBe('Second')
    })
  })
})
