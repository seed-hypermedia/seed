import {EditorState, TextSelection} from 'prosemirror-state'
import {beforeEach, describe, expect, it} from 'vitest'
import {getBlockInfoFromPos} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'
import {buildDoc, createMinimalSchema, findPosInBlock} from './test-helpers-prosemirror'
import type {Schema} from 'prosemirror-model'

/**
 * Tests for the "add block at end" logic used by the AddBlockAtEndButton.
 *
 * The button's core behavior:
 *   1. Find the last block via getBlockInfoFromPos(state, doc.content.size - 2)
 *   2. If the last block has content → insert a new empty block after it
 *   3. If the last block is empty → reuse it (just move cursor there)
 *   4. If the second-to-last block has "/" and last is empty (previous dismissed
 *      slash menu), reuse the "/" block instead of creating a new one
 *
 * These tests validate steps 1-4 at the ProseMirror level without
 * needing a full Tiptap/React environment.
 */
describe('addBlockAtEnd — last block detection', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
  })

  it('finds the last block in a single-block document', () => {
    const doc = buildDoc(schema, [{id: 'block-1', text: 'Hello'}])
    const state = EditorState.create({doc, schema})

    const lastBlockPos = doc.content.size - 2
    const blockInfo = getBlockInfoFromPos(state, lastBlockPos)

    expect(blockInfo.block.node.attrs.id).toBe('block-1')
    expect(blockInfo.blockContent.node.textContent).toBe('Hello')
  })

  it('finds the last block in a multi-block document', () => {
    const doc = buildDoc(schema, [
      {id: 'block-1', text: 'First'},
      {id: 'block-2', text: 'Second'},
      {id: 'block-3', text: 'Third'},
    ])
    const state = EditorState.create({doc, schema})

    const lastBlockPos = doc.content.size - 2
    const blockInfo = getBlockInfoFromPos(state, lastBlockPos)

    expect(blockInfo.block.node.attrs.id).toBe('block-3')
    expect(blockInfo.blockContent.node.textContent).toBe('Third')
  })

  it('detects last block has content (should create new block)', () => {
    const doc = buildDoc(schema, [{id: 'block-1', text: 'Some content'}])
    const state = EditorState.create({doc, schema})

    const lastBlockPos = doc.content.size - 2
    const blockInfo = getBlockInfoFromPos(state, lastBlockPos)

    expect(blockInfo.blockContent.node.textContent.length).toBeGreaterThan(0)
  })

  it('detects last block is empty (should reuse it)', () => {
    const doc = buildDoc(schema, [
      {id: 'block-1', text: 'Some content'},
      {id: 'block-2', text: ''},
    ])
    const state = EditorState.create({doc, schema})

    const lastBlockPos = doc.content.size - 2
    const blockInfo = getBlockInfoFromPos(state, lastBlockPos)

    expect(blockInfo.block.node.attrs.id).toBe('block-2')
    expect(blockInfo.blockContent.node.textContent.length).toBe(0)
  })
})

describe('addBlockAtEnd — block insertion', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
  })

  it('inserts a new empty block after the last block with content', () => {
    const doc = buildDoc(schema, [{id: 'block-1', text: 'Hello'}])
    const state = EditorState.create({doc, schema})

    const lastBlockPos = doc.content.size - 2
    const blockInfo = getBlockInfoFromPos(state, lastBlockPos)

    // Simulate inserting a new block at block.afterPos
    const newBlockInsertionPos = blockInfo.block.afterPos
    const newBlock = schema.nodes['blockNode']!.createAndFill()!
    const tr = state.tr.insert(newBlockInsertionPos, newBlock)
    const newState = state.apply(tr)

    // Document should now have 2 blocks
    const topGroup = newState.doc.firstChild!
    expect(topGroup.childCount).toBe(2)

    // First block unchanged
    expect(topGroup.child(0).attrs.id).toBe('block-1')
    expect(topGroup.child(0).firstChild!.textContent).toBe('Hello')

    // New block is empty
    expect(topGroup.child(1).firstChild!.textContent).toBe('')
  })

  it('cursor can be placed in the newly created block', () => {
    const doc = buildDoc(schema, [{id: 'block-1', text: 'Hello'}])
    const state = EditorState.create({doc, schema})

    const lastBlockPos = doc.content.size - 2
    const blockInfo = getBlockInfoFromPos(state, lastBlockPos)

    const newBlockInsertionPos = blockInfo.block.afterPos
    const newBlockContentPos = newBlockInsertionPos + 2
    const newBlock = schema.nodes['blockNode']!.createAndFill()!
    const tr = state.tr.insert(newBlockInsertionPos, newBlock)
    const newState = state.apply(tr)

    // Set cursor in the new block
    const sel = TextSelection.create(newState.doc, newBlockContentPos)
    const stateWithCursor = newState.apply(newState.tr.setSelection(sel))

    // Cursor should be inside the new (second) block's paragraph
    const $pos = stateWithCursor.selection.$from
    expect($pos.parent.type.name).toBe('paragraph')
    expect($pos.parent.textContent).toBe('')
  })

  it('does not insert a block when last block is already empty', () => {
    const doc = buildDoc(schema, [
      {id: 'block-1', text: 'Hello'},
      {id: 'block-2', text: ''},
    ])
    const state = EditorState.create({doc, schema})

    const lastBlockPos = doc.content.size - 2
    const blockInfo = getBlockInfoFromPos(state, lastBlockPos)

    // Last block is empty — no insertion needed
    expect(blockInfo.blockContent.node.textContent.length).toBe(0)

    // Just move cursor to the empty block's paragraph content.
    // In the actual code, tiptap's setTextSelection resolves to the nearest
    // valid text position. Here we use blockContent.beforePos + 1 directly.
    const cursorPos = blockInfo.blockContent.beforePos + 1
    const sel = TextSelection.create(state.doc, cursorPos)
    const newState = state.apply(state.tr.setSelection(sel))

    // Document still has 2 blocks (no new one created)
    const topGroup = newState.doc.firstChild!
    expect(topGroup.childCount).toBe(2)

    // Cursor is inside the empty block's paragraph
    const $pos = newState.selection.$from
    expect($pos.parent.type.name).toBe('paragraph')
    expect($pos.parent.textContent).toBe('')
  })

  it('works with nested blocks (finds top-level last block)', () => {
    const doc = buildDoc(schema, [
      {
        id: 'block-1',
        text: 'Parent',
        children: {
          blocks: [{id: 'child-1', text: 'Nested child'}],
        },
      },
      {id: 'block-2', text: 'Last top-level'},
    ])
    const state = EditorState.create({doc, schema})

    const lastBlockPos = doc.content.size - 2
    const blockInfo = getBlockInfoFromPos(state, lastBlockPos)

    expect(blockInfo.block.node.attrs.id).toBe('block-2')
    expect(blockInfo.blockContent.node.textContent).toBe('Last top-level')
  })
})

describe('addBlockAtEnd — leftover "/" detection', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createMinimalSchema()
  })

  // After clicking "+" and dismissing the slash menu, the doc looks like:
  //   [content..., block with "/", empty trailing block]
  // The button should detect this and reuse the "/" block.

  it('detects second-to-last block with "/" when last is empty', () => {
    const doc = buildDoc(schema, [
      {id: 'block-1', text: 'Some content'},
      {id: 'block-slash', text: '/'},
      {id: 'block-trailing', text: ''},
    ])
    const state = EditorState.create({doc, schema})

    const topGroup = doc.firstChild!
    expect(topGroup.childCount).toBe(3)

    // Find last and second-to-last blocks
    const lastInfo = getBlockInfoFromPos(state, doc.content.size - 2)
    expect(lastInfo.block.node.attrs.id).toBe('block-trailing')
    expect(lastInfo.blockContent.node.textContent).toBe('')

    const prevPos = lastInfo.block.beforePos - 1
    const prevInfo = getBlockInfoFromPos(state, prevPos)
    expect(prevInfo.block.node.attrs.id).toBe('block-slash')
    expect(prevInfo.blockContent.node.textContent).toBe('/')

    // Condition matches: prevInfo has "/" and lastInfo is empty
    expect(prevInfo.blockContent.node.textContent === '/').toBe(true)
    expect(lastInfo.blockContent.node.textContent.length === 0).toBe(true)
    // Confirm they're different blocks
    expect(prevInfo.block.node).not.toBe(lastInfo.block.node)
  })

  it('deletes the "/" block so the trailing block can be reused', () => {
    const doc = buildDoc(schema, [
      {id: 'block-1', text: 'Some content'},
      {id: 'block-slash', text: '/'},
      {id: 'block-trailing', text: ''},
    ])
    const state = EditorState.create({doc, schema})

    const lastInfo = getBlockInfoFromPos(state, doc.content.size - 2)
    const prevInfo = getBlockInfoFromPos(state, lastInfo.block.beforePos - 1)

    // Delete the entire "/" block
    const tr = state.tr.delete(prevInfo.block.beforePos, prevInfo.block.afterPos)
    const newState = state.apply(tr)

    // Document now has 2 blocks (the "/" block was removed)
    const topGroup = newState.doc.firstChild!
    expect(topGroup.childCount).toBe(2)

    // First block unchanged
    expect(topGroup.child(0).attrs.id).toBe('block-1')
    expect(topGroup.child(0).firstChild!.textContent).toBe('Some content')

    // The trailing empty block is now the last block — ready for the normal flow
    expect(topGroup.child(1).firstChild!.textContent).toBe('')
  })

  it('does not match when second-to-last has other content', () => {
    const doc = buildDoc(schema, [
      {id: 'block-1', text: 'Some content'},
      {id: 'block-2', text: 'Not a slash'},
      {id: 'block-trailing', text: ''},
    ])
    const state = EditorState.create({doc, schema})

    const lastInfo = getBlockInfoFromPos(state, doc.content.size - 2)
    const prevInfo = getBlockInfoFromPos(state, lastInfo.block.beforePos - 1)

    // Should NOT match the "/" reuse condition
    expect(prevInfo.blockContent.node.textContent).toBe('Not a slash')
    expect(prevInfo.blockContent.node.textContent === '/').toBe(false)
  })

  it('does not match when only one block exists', () => {
    const doc = buildDoc(schema, [{id: 'block-1', text: 'Only block'}])
    const state = EditorState.create({doc, schema})

    const topGroup = doc.firstChild!
    // Only 1 block — the reuse logic requires >= 2
    expect(topGroup.childCount).toBe(1)
  })
})
