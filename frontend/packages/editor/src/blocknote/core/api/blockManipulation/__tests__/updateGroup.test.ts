import {beforeEach, describe, expect, it} from 'vitest'
import {EditorState} from 'prosemirror-state'
import {Schema} from 'prosemirror-model'
import {updateGroupCommand} from '../commands/updateGroup'
import {
  createMinimalSchema,
  createDocFromJSON,
  printDoc,
  createMockEditor,
} from './test-helpers-prosemirror'

// Import JSON fixtures
import blockGroupSimple from './fixtures/blockGroup-simple.json'
import listGroupUnordered from './fixtures/listGroup-unordered.json'

describe('updateGroup command', () => {
  // Shared variables for all tests
  let schema: Schema
  let editor: any

  // Run before each test
  beforeEach(() => {
    schema = createMinimalSchema()
    // editor will be created per test with different state
  })

  describe('Group type conversions', () => {
    it('converts blockGroup to unordered listGroup', () => {
      // Load document from JSON fixture
      const doc = createDocFromJSON(schema, blockGroupSimple)
      const state = EditorState.create({doc, schema})
      editor = createMockEditor(state)

      console.log('\n=== Initial Document Structure ===')
      console.log(printDoc(doc))

      // Position inside the nested paragraph
      const posInBlock = 6

      // Call the updateGroup command
      const command = updateGroupCommand(posInBlock, 'Unordered', false)

      let newState: EditorState | undefined = undefined
      const result = command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr || state.tr) as EditorState
          console.log('\n=== After updateGroup Command ===')
          console.log(printDoc(newState.doc))
        },
      })

      console.log('\nCommand result:', result)
      console.log('Transaction dispatched:', newState !== undefined)

      // CRITICAL: Transaction MUST have been dispatched
      expect(result).toBe(true)
      expect(newState).toBeDefined()

      // Verify structure was converted
      const rootContainer = newState!.doc.firstChild
      expect(rootContainer).toBeDefined()

      const childGroup = rootContainer!.lastChild
      expect(childGroup).toBeDefined()

      console.log('\nChild group type:', childGroup!.type.name)
      console.log('Child group attrs:', childGroup!.attrs)

      // Expect the blockGroup to be converted to listGroup
      expect(childGroup!.type.name).toBe('listGroup')
      expect(childGroup!.attrs.listType).toBe('Unordered')

      // Expect the blockContainer to be converted to listContainer
      const container = childGroup!.firstChild
      expect(container).toBeDefined()
      console.log('Container type:', container!.type.name)
      expect(container!.type.name).toBe('listContainer')

      // Expect text to be preserved
      const para = container!.firstChild
      expect(para).toBeDefined()
      expect(para!.textContent).toBe('Hello')
    })

    it('converts blockGroup to ordered listGroup', () => {
      // Same test but with 'Ordered' type
      const doc = createDocFromJSON(schema, blockGroupSimple)
      const state = EditorState.create({doc, schema})
      editor = createMockEditor(state)

      const command = updateGroupCommand(6, 'Ordered', false)
      let newState: EditorState | undefined = undefined

      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr) as EditorState
        },
      })

      expect(newState).toBeDefined()

      const childGroup = newState!.doc.firstChild!.lastChild
      expect(childGroup!.type.name).toBe('listGroup')
      expect(childGroup!.attrs.listType).toBe('Ordered')
    })

    it('converts unordered listGroup to ordered listGroup', () => {
      // Start with listGroup fixture
      const doc = createDocFromJSON(schema, listGroupUnordered)
      const state = EditorState.create({doc, schema})
      editor = createMockEditor(state)

      const command = updateGroupCommand(6, 'Ordered', false)
      let newState: EditorState | undefined = undefined

      command({
        editor,
        state,
        dispatch: (tr: any) => {
          newState = state.apply(tr) as EditorState
        },
      })

      expect(newState).toBeDefined()

      const childGroup = newState!.doc.firstChild!.lastChild
      expect(childGroup!.type.name).toBe('listGroup')
      expect(childGroup!.attrs.listType).toBe('Ordered')
    })

    it('converts listGroup to blockGroup', () => {
      // TODO: Implement this test
    })

    it('converts all child containers when switching group types', () => {
      // TODO: Test with nested structures
    })
  })
})
