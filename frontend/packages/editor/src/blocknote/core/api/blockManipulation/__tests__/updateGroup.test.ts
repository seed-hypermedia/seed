import {Schema} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'
import {beforeEach, describe, expect, it} from 'vitest'
import {updateGroupCommand} from '../commands/updateGroup'
import {getGroupInfoFromPos} from '../../../extensions/Blocks/helpers/getGroupInfoFromPos'
import {
  createDocFromJSON,
  createMinimalSchema,
  createMockEditor,
  findPosInBlock,
  findPosInLastContainer,
  printDoc,
} from './test-helpers-prosemirror'

// JSON fixtures
import blockGroupSimple from './fixtures/blockGroup-simple.json'
import listGroupUnordered from './fixtures/listGroup-unordered.json'
import twoBlockContainers from './fixtures/two-block-containers.json'
import listGroupTwoItems from './fixtures/listGroup-two-items.json'
import listGroupThreeItemsNullIds from './fixtures/listGroup-three-items-null-ids.json'

describe('updateGroup command', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
  })

  // Test 1: Convert blockGroup to listGroup
  //
  // BEFORE:                                    AFTER:
  // doc                                        doc
  //   blockGroup (top-level)                     blockGroup (top-level)
  //     blockContainer (test-root)                 blockContainer (test-root)
  //       paragraph "Root paragraph"                 paragraph "Root paragraph"
  //       blockGroup                        →        listGroup (Unordered)
  //         blockContainer (test-1)                     listContainer (test-1)
  //           paragraph "Hello"                           paragraph "Hello"
  //
  describe('blockGroup → listGroup', () => {
    it('converts blockGroup to unordered listGroup', () => {
      const doc = createDocFromJSON(schema, blockGroupSimple)
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'test-1')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Unordered', false)

      let newState: EditorState | undefined
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr || state.tr) as EditorState
        },
      })

      expect(newState).toBeDefined()

      // doc > blockGroup (top-level) > blockContainer (test-root)
      const topGroup = newState!.doc.firstChild!
      const rootContainer = topGroup.firstChild!
      const childGroup = rootContainer.lastChild!

      // blockGroup should become listGroup
      expect(childGroup.type.name).toBe('listGroup')
      expect(childGroup.attrs.listType).toBe('Unordered')

      // blockContainer should become listContainer
      const container = childGroup.firstChild!
      expect(container.type.name).toBe('listContainer')
      expect(container.attrs.id).toBe('test-1')

      // text preserved
      expect(container.firstChild!.textContent).toBe('Hello')
    })

    it('converts blockGroup to ordered listGroup', () => {
      const doc = createDocFromJSON(schema, blockGroupSimple)
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'test-1')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Ordered', false)

      let newState: EditorState | undefined
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr || state.tr) as EditorState
        },
      })

      expect(newState).toBeDefined()

      const rootContainer = newState!.doc.firstChild!.firstChild!
      const childGroup = rootContainer.lastChild!

      expect(childGroup.type.name).toBe('listGroup')
      expect(childGroup.attrs.listType).toBe('Ordered')

      const container = childGroup.firstChild!
      expect(container.type.name).toBe('listContainer')
      expect(container.firstChild!.textContent).toBe('Hello')
    })
  })

  // Test 2: Create new listGroup by sinking second blockContainer
  //
  // This is what happens when a user types "* " or "1. " in the second block.
  // The second blockContainer should be sunk into the first as a child listGroup.
  //
  // BEFORE:                                    AFTER:
  // doc                                        doc
  //   blockGroup (top-level)                     blockGroup (top-level)
  //     blockContainer (block-1)                   blockContainer (block-1)
  //       paragraph "First"                          paragraph "First"
  //     blockContainer (block-2)          →          listGroup (Unordered)
  //       paragraph "Second"                           listContainer (block-2)
  //                                                      paragraph "Second"
  //
  describe('sink blockContainer into new listGroup', () => {
    it('sinks second blockContainer into first as unordered listGroup', () => {
      const doc = createDocFromJSON(schema, twoBlockContainers)
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'block-2')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Unordered', false)

      let newState: EditorState | undefined
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr || state.tr) as EditorState
        },
      })

      expect(newState).toBeDefined()

      // doc > blockGroup (top-level) > blockContainer (block-1)
      const topGroup = newState!.doc.firstChild!
      const block1 = topGroup.firstChild!
      expect(block1.type.name).toBe('blockContainer')
      expect(block1.attrs.id).toBe('block-1')
      expect(block1.firstChild!.textContent).toBe('First')

      // block-1 should now have a child listGroup
      const childGroup = block1.lastChild!
      expect(childGroup.type.name).toBe('listGroup')
      expect(childGroup.attrs.listType).toBe('Unordered')

      // listGroup should contain a listContainer with block-2's content
      const listItem = childGroup.firstChild!
      expect(listItem.type.name).toBe('listContainer')
      expect(listItem.attrs.id).toBe('block-2')
      expect(listItem.firstChild!.textContent).toBe('Second')
    })
  })

  // Test 3: Convert listGroup to blockGroup (reverse of test 1)
  //
  // BEFORE:                                    AFTER:
  // doc                                        doc
  //   blockGroup (top-level)                     blockGroup (top-level)
  //     blockContainer (test-root)                 blockContainer (test-root)
  //       paragraph "Root paragraph"                 paragraph "Root paragraph"
  //       listGroup (Unordered)             →        blockGroup
  //         listContainer (test-1)                     blockContainer (test-1)
  //           paragraph "Hello"                          paragraph "Hello"
  //
  describe('listGroup → blockGroup', () => {
    it('converts listGroup to blockGroup', () => {
      const doc = createDocFromJSON(schema, listGroupUnordered)
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'test-1')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Group', false)

      let newState: EditorState | undefined
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr || state.tr) as EditorState
        },
      })

      expect(newState).toBeDefined()

      const rootContainer = newState!.doc.firstChild!.firstChild!
      const childGroup = rootContainer.lastChild!

      // listGroup should become blockGroup
      expect(childGroup.type.name).toBe('blockGroup')

      // listContainer should become blockContainer
      const container = childGroup.firstChild!
      expect(container.type.name).toBe('blockContainer')
      expect(container.attrs.id).toBe('test-1')

      // text preserved
      expect(container.firstChild!.textContent).toBe('Hello')
    })
  })

  // Test 4: Convert between list types (unordered → ordered)
  //
  // BEFORE:                                    AFTER:
  // doc                                        doc
  //   blockGroup (top-level)                     blockGroup (top-level)
  //     blockContainer (test-root)                 blockContainer (test-root)
  //       paragraph "Root paragraph"                 paragraph "Root paragraph"
  //       listGroup (Unordered)             →        listGroup (Ordered)
  //         listContainer (test-1)                     listContainer (test-1)
  //           paragraph "Hello"                          paragraph "Hello"
  //
  describe('listGroup type switching', () => {
    it('converts unordered listGroup to ordered listGroup', () => {
      const doc = createDocFromJSON(schema, listGroupUnordered)
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'test-1')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(
        groupInfo.$pos.start(),
        'Ordered',
        false,
        undefined,
        true, // turnInto: switching between list types in same group
      )

      let newState: EditorState | undefined
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr || state.tr) as EditorState
        },
      })

      expect(newState).toBeDefined()

      const rootContainer = newState!.doc.firstChild!.firstChild!
      const childGroup = rootContainer.lastChild!

      // Same listGroup, different type
      expect(childGroup.type.name).toBe('listGroup')
      expect(childGroup.attrs.listType).toBe('Ordered')

      // Container stays as listContainer
      const container = childGroup.firstChild!
      expect(container.type.name).toBe('listContainer')
      expect(container.firstChild!.textContent).toBe('Hello')
    })
  })

  // Test 5: Sink last listContainer into nested listGroup of different type
  //
  // When the user is in the last item of an unordered list and types "1. ",
  // the item should be sunk and wrapped in a new nested listGroup of type Ordered.
  //
  // BEFORE:                                    AFTER:
  // doc                                        doc
  //   blockGroup (top-level)                     blockGroup (top-level)
  //     blockContainer (root)                      blockContainer (root)
  //       paragraph "Root"                           paragraph "Root"
  //       listGroup (Unordered)                      listGroup (Unordered)
  //         listContainer (item-1)                     listContainer (item-1)
  //           paragraph "First"                          paragraph "First"
  //         listContainer (item-2)          →            listGroup (Ordered)
  //           paragraph "Second"                           listContainer (item-2)
  //                                                          paragraph "Second"
  //
  describe('sink listContainer into nested listGroup', () => {
    it('sinks last listContainer into nested listGroup of different type', () => {
      const doc = createDocFromJSON(schema, listGroupTwoItems)
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      const pos = findPosInBlock(doc, 'item-2')
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(
        groupInfo.$pos.start(),
        'Ordered',
        false,
      )

      let newState: EditorState | undefined
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr || state.tr) as EditorState
        },
      })

      expect(newState).toBeDefined()

      const rootContainer = newState!.doc.firstChild!.firstChild!
      const outerList = rootContainer.lastChild!

      // Outer list stays Unordered
      expect(outerList.type.name).toBe('listGroup')
      expect(outerList.attrs.listType).toBe('Unordered')

      // First item preserved
      const item1 = outerList.firstChild!
      expect(item1.type.name).toBe('listContainer')
      expect(item1.attrs.id).toBe('item-1')
      expect(item1.firstChild!.textContent).toBe('First')

      // item-1 should now have a nested listGroup
      const nestedList = item1.lastChild!
      expect(nestedList.type.name).toBe('listGroup')
      expect(nestedList.attrs.listType).toBe('Ordered')

      // Nested list contains item-2's content
      const item2 = nestedList.firstChild!
      expect(item2.type.name).toBe('listContainer')
      expect(item2.attrs.id).toBe('item-2')
      expect(item2.firstChild!.textContent).toBe('Second')
    })
  })

  // Test 6: Sink last of 3 listContainers when some have null ids
  //
  // Regression: when multiple containers share null ids, the id-based matching
  // would pick the wrong container. Position-based matching fixes this.
  //
  // BEFORE:                                    AFTER:
  // doc                                        doc
  //   blockGroup (top-level)                     blockGroup (top-level)
  //     blockContainer (root)                      blockContainer (root)
  //       paragraph "Root"                           paragraph "Root"
  //       listGroup (Unordered)                      listGroup (Unordered)
  //         listContainer (item-a)                     listContainer (item-a)
  //           paragraph "First"                          paragraph "First"
  //         listContainer (null)                        listContainer (null)
  //           paragraph "Second"                          paragraph "Second"
  //         listContainer (null)            →            listGroup (Ordered)
  //           paragraph ""                                 listContainer (null)
  //                                                          paragraph ""
  //
  describe('sink with null ids (regression)', () => {
    it('sinks last listContainer when multiple siblings have null ids', () => {
      const doc = createDocFromJSON(schema, listGroupThreeItemsNullIds)
      const state = EditorState.create({doc, schema})
      const editor = createMockEditor(state)

      // Use findPosInLastContainer since the target has null id
      const pos = findPosInLastContainer(doc)
      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(
        groupInfo.$pos.start(),
        'Ordered',
        false,
      )

      let newState: EditorState | undefined
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr || state.tr) as EditorState
        },
      })

      expect(newState).toBeDefined()

      const rootContainer = newState!.doc.firstChild!.firstChild!
      const outerList = rootContainer.lastChild!

      // Outer list stays Unordered
      expect(outerList.type.name).toBe('listGroup')
      expect(outerList.attrs.listType).toBe('Unordered')

      // First item preserved
      const item1 = outerList.firstChild!
      expect(item1.type.name).toBe('listContainer')
      expect(item1.attrs.id).toBe('item-a')
      expect(item1.firstChild!.textContent).toBe('First')

      // Second item (null id) preserved, now has nested list
      const item2 = outerList.child(1)
      expect(item2.type.name).toBe('listContainer')
      expect(item2.firstChild!.textContent).toBe('Second')

      // Nested Ordered list inside item-2
      const nestedList = item2.lastChild!
      expect(nestedList.type.name).toBe('listGroup')
      expect(nestedList.attrs.listType).toBe('Ordered')

      // Third item (null id, empty) is now inside nested list
      const item3 = nestedList.firstChild!
      expect(item3.type.name).toBe('listContainer')
      expect(item3.firstChild!.textContent).toBe('')
    })
  })
})
