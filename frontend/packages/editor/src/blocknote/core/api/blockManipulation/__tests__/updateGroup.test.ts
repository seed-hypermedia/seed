import {Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {getGroupInfoFromPos} from '../../../extensions/Blocks/helpers/getGroupInfoFromPos'
import {updateGroupCommand} from '../commands/updateGroup'
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

  // Test 2: Sink second blockNode into first as child list
  //
  // Uses setTimeout + editor.chain().sinkListItem() internally.
  // We use vi.useFakeTimers() + vi.runAllTimers() to execute it synchronously.
  //
  // BEFORE:                                    AFTER:
  //   blockChildren (Group)                      blockChildren (Group)
  //     blockNode (block-1)                        blockNode (block-1)
  //       paragraph "First"                          paragraph "First"
  //     blockNode (block-2)                →         blockChildren (Unordered)
  //       paragraph "Second"                           blockNode (block-2)
  //                                                      paragraph "Second"
  //
  describe('sink blockNode into sibling with updateGroupCommand', () => {
    it('sinks second block into first as unordered list', () => {
      const doc = buildDoc(schema, [
        {id: 'block-1', text: 'First'},
        {id: 'block-2', text: 'Second'},
      ])
      // Place selection inside block-2 so sinkListItem knows what to sink
      const pos = findPosInBlock(doc, 'block-2')
      const state = EditorState.create({
        doc,
        schema,
        selection: TextSelection.create(doc, pos),
      })
      const editor = createMockEditor(state)

      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Unordered', false)

      const newState = runDeferredCommand(state, editor, command)

      // Top group should now have 1 child (block-1 with nested children)
      const topGroup = newState.doc.firstChild!
      const block1 = topGroup.firstChild!
      expect(block1.type.name).toBe('blockNode')
      expect(block1.attrs.id).toBe('block-1')
      expect(block1.firstChild!.textContent).toBe('First')

      // block-1 should have a child blockChildren
      const childGroup = block1.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      // sinkListItem creates with default attrs, then updateGroup sets listType
      expect(childGroup.attrs.listType).toBe('Unordered')

      // Contains block-2's content
      const block2 = childGroup.firstChild!
      expect(block2.type.name).toBe('blockNode')
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
