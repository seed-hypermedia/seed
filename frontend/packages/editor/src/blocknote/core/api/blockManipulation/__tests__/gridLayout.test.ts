import {Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {getGroupInfoFromPos} from '../../../extensions/Blocks/helpers/getGroupInfoFromPos'
import {isInGridContainer} from '../../../extensions/Blocks/nodes/BlockChildren'
import {canNestBlock, canUnnestBlock, sinkListItem} from '../commands/nestBlock'
import {updateGroupCommand} from '../commands/updateGroup'
import {buildDoc, createMinimalSchema, createMockEditor, findPosInBlock} from './test-helpers-prosemirror'

describe('Grid Layout', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('In the grid container', () => {
    it('returns true for a block inside a Grid blockChildren', () => {
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Grid',
            columnCount: '3',
            blocks: [
              {id: 'cell-1', text: 'A'},
              {id: 'cell-2', text: 'B'},
              {id: 'cell-3', text: 'C'},
            ],
          },
        },
      ])
      const pos = findPosInBlock(doc, 'cell-2')
      const state = EditorState.create({doc, schema})
      expect(isInGridContainer(state, pos)).toBe(true)
    })

    it('returns false for a block in a normal Group', () => {
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Group',
            blocks: [{id: 'child', text: 'Hello'}],
          },
        },
      ])
      const pos = findPosInBlock(doc, 'child')
      const state = EditorState.create({doc, schema})
      expect(isInGridContainer(state, pos)).toBe(false)
    })

    it('returns false for a top-level block', () => {
      const doc = buildDoc(schema, [{id: 'top', text: 'Hello'}])
      const pos = findPosInBlock(doc, 'top')
      const state = EditorState.create({doc, schema})
      expect(isInGridContainer(state, pos)).toBe(false)
    })
  })

  describe('nest/unnest guards in Grid', () => {
    function createGridState() {
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Grid',
            columnCount: '3',
            blocks: [
              {id: 'cell-1', text: 'A'},
              {id: 'cell-2', text: 'B'},
              {id: 'cell-3', text: 'C'},
            ],
          },
        },
      ])
      const pos = findPosInBlock(doc, 'cell-2')
      return EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
    }

    it('canNestBlock returns false inside Grid', () => {
      const state = createGridState()
      const editor: any = {_tiptapEditor: {state, schema}}
      expect(canNestBlock(editor)).toBe(false)
    })

    it('canUnnestBlock returns false inside Grid', () => {
      const state = createGridState()
      const editor: any = {_tiptapEditor: {state, schema}}
      expect(canUnnestBlock(editor)).toBe(false)
    })

    it('sinkListItem is blocked for first child in Grid (no previous sibling)', () => {
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Grid',
            columnCount: '3',
            blocks: [
              {id: 'cell-1', text: 'A'},
              {id: 'cell-2', text: 'B'},
            ],
          },
        },
      ])
      const pos = findPosInBlock(doc, 'cell-1')
      const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})

      const cmd = sinkListItem(schema.nodes['blockNode']!, schema.nodes['blockChildren']!, 'Grid' as any, '1')
      let dispatched = false
      cmd({state, dispatch: () => (dispatched = true)})
      // First child cannot be sunk — startIndex === 0
      expect(dispatched).toBe(false)
    })
  })

  describe('updateGroupCommand with turnInto for Grid', () => {
    it('changes group type to Grid from first child (turnInto=true)', () => {
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Group',
            blocks: [
              {id: 'child-1', text: 'A'},
              {id: 'child-2', text: 'B'},
            ],
          },
        },
      ])
      const pos = findPosInBlock(doc, 'child-1')
      const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
      const editor = createMockEditor(state)

      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Grid' as any, false, undefined, true)

      let newState: EditorState | undefined
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr) as EditorState
        },
      })
      expect(newState).toBeDefined()

      const childGroup = newState!.doc.firstChild!.firstChild!.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      expect(childGroup.attrs.listType).toBe('Grid')
      expect(childGroup.childCount).toBe(2)
    })

    it('changes whole group type from non-first child when turnInto=true', () => {
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Grid',
            columnCount: '3',
            blocks: [
              {id: 'cell-1', text: 'A'},
              {id: 'cell-2', text: 'B'},
              {id: 'cell-3', text: 'C'},
            ],
          },
        },
      ])
      // Select from cell-2 (non-first child) and switch to Unordered
      const pos = findPosInBlock(doc, 'cell-2')
      const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
      const editor = createMockEditor(state)

      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Unordered', false, undefined, true)

      let newState: EditorState | undefined
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr) as EditorState
        },
      })
      expect(newState).toBeDefined()

      // The whole group should change to Unordered, not just cell-2
      const childGroup = newState!.doc.firstChild!.firstChild!.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      expect(childGroup.attrs.listType).toBe('Unordered')
      // All 3 children should still be in the same group
      expect(childGroup.childCount).toBe(3)
    })

    it('sinks non-first child when turnInto=false (default behavior)', () => {
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Group',
            blocks: [
              {id: 'child-1', text: 'A'},
              {id: 'child-2', text: 'B'},
            ],
          },
        },
      ])
      const pos = findPosInBlock(doc, 'child-2')
      const state = EditorState.create({doc, schema, selection: TextSelection.create(doc, pos)})
      const editor = createMockEditor(state)

      const groupInfo = getGroupInfoFromPos(pos, state)
      const command = updateGroupCommand(groupInfo.$pos.start(), 'Unordered', false)

      // This uses setTimeout path (sink), so run deferred
      command({
        editor,
        state,
        dispatch: (tr: any) => {
          editor.state = state.apply(tr || state.tr) as EditorState
        },
      })
      vi.runAllTimers()

      const newState = editor.state
      // child-2 should be sunk into child-1's children
      const rootBlock = newState.doc.firstChild!.firstChild!
      const childGroup = rootBlock.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      // child-1 should have a nested blockChildren with child-2
      const child1 = childGroup.firstChild!
      expect(child1.attrs.id).toBe('child-1')
      expect(child1.childCount).toBe(2) // paragraph + blockChildren
    })
  })

  describe('Grid structure', () => {
    it('preserves columnCount attribute on blockChildren', () => {
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Grid',
            columnCount: '4',
            blocks: [
              {id: 'cell-1', text: 'A'},
              {id: 'cell-2', text: 'B'},
            ],
          },
        },
      ])

      const gridGroup = doc.firstChild!.firstChild!.lastChild!
      expect(gridGroup.type.name).toBe('blockChildren')
      expect(gridGroup.attrs.listType).toBe('Grid')
      expect(gridGroup.attrs.columnCount).toBe('4')
    })

    it('columnCount defaults to null when not specified', () => {
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Group',
            blocks: [{id: 'child', text: 'Hello'}],
          },
        },
      ])

      const group = doc.firstChild!.firstChild!.lastChild!
      expect(group.attrs.columnCount).toBeNull()
    })
  })

  describe('input rule guards (isInGridContainer)', () => {
    it('detects Grid at any ancestor depth', () => {
      // Nested: Grid > cell with children > deeply nested block
      const doc = buildDoc(schema, [
        {
          id: 'root',
          text: 'Root',
          children: {
            listType: 'Grid',
            columnCount: '2',
            blocks: [
              {
                id: 'cell-1',
                text: 'A',
                children: {
                  listType: 'Group',
                  blocks: [{id: 'deep', text: 'Deep'}],
                },
              },
              {id: 'cell-2', text: 'B'},
            ],
          },
        },
      ])
      const pos = findPosInBlock(doc, 'deep')
      const state = EditorState.create({doc, schema})
      // Even though 'deep' is in a Group, its ancestor is a Grid
      expect(isInGridContainer(state, pos)).toBe(true)
    })
  })
})
