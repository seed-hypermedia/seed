import {Node as PMNode, Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {unnestBlock} from '../commands/nestBlock'
import {buildDoc, createMinimalSchema, createMockEditor, findPosInBlock} from './test-helpers-prosemirror'

describe('unnestBlock - liftListItem', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Helper: run unnestBlock (deferred paths use setTimeout)
  function runUnnest(doc: PMNode, blockId: string): EditorState {
    const pos = findPosInBlock(doc, blockId)
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, pos),
    })
    const editor = createMockEditor(state)

    unnestBlock(editor as any, pos)
    vi.runAllTimers()
    return editor.state
  }

  // Test 1: Unnest from Group to Group
  //
  // BEFORE:                                  AFTER:
  //   blockChildren (Group)                    blockChildren (Group)
  //     blockNode (test-root)                    blockNode (test-root)
  //       paragraph "Root paragraph"               paragraph "Root paragraph"
  //       blockChildren (Group)           →    blockNode (test-1)
  //         blockNode (test-1)                   paragraph "Hello"
  //           paragraph "Hello"
  //
  describe('Group → Group', () => {
    it('lifts block out of nested Group into parent Group', () => {
      const doc = buildDoc(schema, [
        {
          id: 'test-root',
          text: 'Root paragraph',
          children: {blocks: [{id: 'test-1', text: 'Hello'}]},
        },
      ])
      const newState = runUnnest(doc, 'test-1')

      const topGroup = newState.doc.firstChild!
      expect(topGroup.type.name).toBe('blockChildren')
      expect(topGroup.childCount).toBe(2)

      const root = topGroup.firstChild!
      expect(root.attrs.id).toBe('test-root')
      expect(root.firstChild!.textContent).toBe('Root paragraph')
      // root should no longer have a blockChildren child
      expect(root.childCount).toBe(1)

      const lifted = topGroup.child(1)
      expect(lifted.attrs.id).toBe('test-1')
      expect(lifted.firstChild!.textContent).toBe('Hello')
    })
  })

  // Test 2: Unnest from list to list
  //
  // BEFORE:                                      AFTER:
  //   blockChildren (Unordered, '1')               blockChildren (Unordered, '1')
  //     blockNode (item-1)                           blockNode (item-1)
  //       paragraph "First"                            paragraph "First"
  //       blockChildren (Unordered, '2')    →      blockNode (item-2)
  //         blockNode (item-2)                       paragraph "Second"
  //           paragraph "Second"
  //
  describe('list → list', () => {
    it('lifts block out of nested Unordered into parent Unordered', () => {
      const doc = buildDoc(
        schema,
        [
          {
            id: 'item-1',
            text: 'First',
            children: {
              listType: 'Unordered',
              listLevel: '2',
              blocks: [{id: 'item-2', text: 'Second'}],
            },
          },
        ],
        {listType: 'Unordered'},
      )
      const newState = runUnnest(doc, 'item-2')

      const topGroup = newState.doc.firstChild!
      expect(topGroup.type.name).toBe('blockChildren')
      expect(topGroup.attrs.listType).toBe('Unordered')
      expect(topGroup.childCount).toBe(2)

      const item1 = topGroup.firstChild!
      expect(item1.attrs.id).toBe('item-1')
      expect(item1.firstChild!.textContent).toBe('First')
      expect(item1.childCount).toBe(1) // no more nested blockChildren

      const item2 = topGroup.child(1)
      expect(item2.attrs.id).toBe('item-2')
      expect(item2.firstChild!.textContent).toBe('Second')
    })
  })

  // Test 3: Unnest from different group types (Unordered → Group)
  //
  // BEFORE:                                      AFTER:
  //   blockChildren (Group)                        blockChildren (Group)
  //     blockNode (test-root)                        blockNode (test-root)
  //       paragraph "Root paragraph"                   paragraph "Root paragraph"
  //       blockChildren (Unordered)           →    blockNode (test-1)
  //         blockNode (test-1)                       paragraph "Hello"
  //           paragraph "Hello"
  //
  describe('cross type: Unordered → Group', () => {
    it('lifts block from Unordered child into parent Group', () => {
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
      const newState = runUnnest(doc, 'test-1')

      const topGroup = newState.doc.firstChild!
      expect(topGroup.type.name).toBe('blockChildren')
      expect(topGroup.attrs.listType).toBe('Group')
      expect(topGroup.childCount).toBe(2)

      const root = topGroup.firstChild!
      expect(root.attrs.id).toBe('test-root')
      expect(root.childCount).toBe(1) // blockChildren removed

      const lifted = topGroup.child(1)
      expect(lifted.attrs.id).toBe('test-1')
      expect(lifted.firstChild!.textContent).toBe('Hello')
    })
  })

  // Test 4: Unnest block that has children (grandchild follows)
  //
  // BEFORE:                                      AFTER:
  //   blockChildren (Group)                        blockChildren (Group)
  //     blockNode (parent)                           blockNode (parent)
  //       paragraph "Parent"                           paragraph "Parent"
  //       blockChildren (Group)                    blockNode (child)
  //         blockNode (child)             →          paragraph "Child"
  //           paragraph "Child"                      blockChildren (Group)
  //           blockChildren (Group)                    blockNode (grandchild)
  //             blockNode (grandchild)                   paragraph "Grandchild"
  //               paragraph "Grandchild"
  //
  describe('unnest with children', () => {
    it('lifts block preserving its children', () => {
      const doc = buildDoc(schema, [
        {
          id: 'parent',
          text: 'Parent',
          children: {
            blocks: [
              {
                id: 'child',
                text: 'Child',
                children: {blocks: [{id: 'grandchild', text: 'Grandchild'}]},
              },
            ],
          },
        },
      ])
      const newState = runUnnest(doc, 'child')

      const topGroup = newState.doc.firstChild!
      expect(topGroup.type.name).toBe('blockChildren')
      expect(topGroup.childCount).toBe(2)

      // Parent should no longer have nested blockChildren
      const parent = topGroup.firstChild!
      expect(parent.attrs.id).toBe('parent')
      expect(parent.firstChild!.textContent).toBe('Parent')
      expect(parent.childCount).toBe(1)

      // Child should be sibling of parent, keeping grandchild
      const child = topGroup.child(1)
      expect(child.attrs.id).toBe('child')
      expect(child.firstChild!.textContent).toBe('Child')
      expect(child.childCount).toBe(2) // paragraph + blockChildren

      const grandchildGroup = child.lastChild!
      expect(grandchildGroup.type.name).toBe('blockChildren')

      const grandchild = grandchildGroup.firstChild!
      expect(grandchild.attrs.id).toBe('grandchild')
      expect(grandchild.firstChild!.textContent).toBe('Grandchild')
    })
  })

  // Test 5: Unnest block with children AND siblings after (manual transaction path)
  //
  // BEFORE:                                         AFTER:
  //   blockChildren (Group)                           blockChildren (Group)
  //     blockNode (parent)                              blockNode (parent)
  //       paragraph "Parent"                              paragraph "Parent"
  //       blockChildren (Group)                       blockNode (child)
  //         blockNode (child)              →            paragraph "Child"
  //           paragraph "Child"                         blockChildren (Group)
  //           blockChildren (Group)                       blockNode (grandchild)
  //             blockNode (grandchild)                      paragraph "Grandchild"
  //               paragraph "Grandchild"                  blockNode (sibling)
  //         blockNode (sibling)                             paragraph "Sibling"
  //           paragraph "Sibling"
  //
  describe('unnest with children and siblings after', () => {
    it('moves siblings into children and lifts block', () => {
      const doc = buildDoc(schema, [
        {
          id: 'parent',
          text: 'Parent',
          children: {
            blocks: [
              {
                id: 'child',
                text: 'Child',
                children: {
                  blocks: [{id: 'grandchild', text: 'Grandchild'}],
                },
              },
              {id: 'sibling', text: 'Sibling'},
            ],
          },
        },
      ])
      const newState = runUnnest(doc, 'child')

      const topGroup = newState.doc.firstChild!
      expect(topGroup.type.name).toBe('blockChildren')
      expect(topGroup.childCount).toBe(2)

      // Parent should no longer have nested blockChildren
      const parent = topGroup.firstChild!
      expect(parent.attrs.id).toBe('parent')
      expect(parent.firstChild!.textContent).toBe('Parent')
      expect(parent.childCount).toBe(1)

      // Child should be sibling of parent
      const child = topGroup.child(1)
      expect(child.attrs.id).toBe('child')
      expect(child.firstChild!.textContent).toBe('Child')
      expect(child.childCount).toBe(2) // paragraph + blockChildren

      // Child's blockChildren should contain both grandchild and sibling
      const childGroup = child.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      expect(childGroup.childCount).toBe(2)

      const grandchild = childGroup.firstChild!
      expect(grandchild.attrs.id).toBe('grandchild')
      expect(grandchild.firstChild!.textContent).toBe('Grandchild')

      const sibling = childGroup.child(1)
      expect(sibling.attrs.id).toBe('sibling')
      expect(sibling.firstChild!.textContent).toBe('Sibling')
    })
  })

  // Test 6: Unnest in list with children+siblings — verify list levels
  //
  // BEFORE:                                              AFTER:
  //   blockChildren (Unordered, '1')                       blockChildren (Unordered, '1')
  //     blockNode (parent)                                   blockNode (parent)
  //       paragraph "Parent"                                   paragraph "Parent"
  //       blockChildren (Unordered, '2')                   blockNode (child)
  //         blockNode (child)                  →             paragraph "Child"
  //           paragraph "Child"                              blockChildren (Unordered, '2')
  //           blockChildren (Unordered, '3')                   blockNode (grandchild)
  //             blockNode (grandchild)                           paragraph "Grandchild"
  //               paragraph "Grandchild"                       blockNode (sibling)
  //         blockNode (sibling)                                  paragraph "Sibling"
  //           paragraph "Sibling"
  //
  describe('list unnest with children+siblings — list levels', () => {
    it('decrements listLevel on children group after lift', () => {
      const doc = buildDoc(
        schema,
        [
          {
            id: 'parent',
            text: 'Parent',
            children: {
              listType: 'Unordered',
              listLevel: '2',
              blocks: [
                {
                  id: 'child',
                  text: 'Child',
                  children: {
                    listType: 'Unordered',
                    listLevel: '3',
                    blocks: [{id: 'grandchild', text: 'Grandchild'}],
                  },
                },
                {id: 'sibling', text: 'Sibling'},
              ],
            },
          },
        ],
        {listType: 'Unordered'},
      )
      const newState = runUnnest(doc, 'child')

      const topGroup = newState.doc.firstChild!
      expect(topGroup.type.name).toBe('blockChildren')
      expect(topGroup.attrs.listType).toBe('Unordered')
      expect(topGroup.attrs.listLevel).toBe('1')
      expect(topGroup.childCount).toBe(2)

      // Parent should no longer have nested blockChildren
      const parent = topGroup.firstChild!
      expect(parent.attrs.id).toBe('parent')
      expect(parent.firstChild!.textContent).toBe('Parent')
      expect(parent.childCount).toBe(1)

      // Child lifted as sibling of parent
      const child = topGroup.child(1)
      expect(child.attrs.id).toBe('child')
      expect(child.firstChild!.textContent).toBe('Child')
      expect(child.childCount).toBe(2) // paragraph + blockChildren

      // Child's blockChildren should preserve listType and decrement level
      const childGroup = child.lastChild!
      expect(childGroup.type.name).toBe('blockChildren')
      expect(childGroup.attrs.listType).toBe('Unordered')
      expect(childGroup.attrs.listLevel).toBe('2') // was '3', should decrement to '2'
      expect(childGroup.childCount).toBe(2)

      const grandchild = childGroup.firstChild!
      expect(grandchild.attrs.id).toBe('grandchild')
      expect(grandchild.firstChild!.textContent).toBe('Grandchild')

      const sibling = childGroup.child(1)
      expect(sibling.attrs.id).toBe('sibling')
      expect(sibling.firstChild!.textContent).toBe('Sibling')
    })
  })
})
