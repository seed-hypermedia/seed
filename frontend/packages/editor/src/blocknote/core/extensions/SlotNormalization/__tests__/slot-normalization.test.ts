import {Schema} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'
import {beforeEach, describe, expect, it} from 'vitest'
import {createMinimalSchema} from '../../../api/blockManipulation/__tests__/test-helpers-prosemirror'
import {applySlotFixes, collectSlotFixes, createSlotNormalizationPlugin} from '../SlotNormalizationExtension'

// Build helpers

function para(text?: string) {
  return {type: 'paragraph', content: text ? [{type: 'text', text}] : undefined}
}
function blockNode(id: string, content: any[]) {
  return {type: 'blockNode', attrs: {id}, content}
}
function group(listType: string, blocks: any[]) {
  return {type: 'blockChildren', attrs: {listType, listLevel: '1', columnCount: null}, content: blocks}
}
function slot(childrenType: string) {
  return {type: 'slot', attrs: {childrenType, listLevel: '1', columnCount: ''}}
}
function doc(schema: Schema, blocks: any[]) {
  return schema.nodeFromJSON({type: 'doc', content: [group('Group', blocks)]})
}

function normalize(schema: Schema, d: any) {
  const state = EditorState.create({doc: d, schema})
  const tr = state.tr
  applySlotFixes(tr, collectSlotFixes(d))
  return state.apply(tr).doc
}

function countSlots(node: any): number {
  let n = 0
  node.descendants((child: any) => {
    if (child.type.name === 'slot') n++
  })
  return n
}

describe('slot normalization', () => {
  let schema: Schema
  beforeEach(() => {
    schema = createMinimalSchema()
  })

  it('removes an orphaned slot only blockNode', () => {
    const d = doc(schema, [
      blockNode('p1', [para('test')]),
      blockNode('orphan', [slot('Unordered')]), // no blockChildren
      blockNode('p2', [para('after')]),
    ])
    const out = normalize(schema, d)
    expect(countSlots(out)).toBe(0)
    const rootGroup = out.firstChild!
    expect(rootGroup.childCount).toBe(2)
    expect(rootGroup.firstChild!.attrs.id).toBe('p1')
    expect(rootGroup.lastChild!.attrs.id).toBe('p2')
  })

  it('replaces a sole orphaned slot with an empty paragraph', () => {
    const d = doc(schema, [blockNode('orphan', [slot('Unordered')])])
    const out = normalize(schema, d)
    expect(countSlots(out)).toBe(0)
    const rootGroup = out.firstChild!
    expect(rootGroup.childCount).toBe(1)
    expect(rootGroup.firstChild!.firstChild!.type.name).toBe('paragraph')
  })

  it('unwraps a Group slot, lifting its items in place', () => {
    const d = doc(schema, [
      blockNode('p1', [para('test')]),
      blockNode('slotWrap', [slot('Group'), group('Group', [blockNode('inner', [para('lifted')])])]),
    ])
    const out = normalize(schema, d)
    expect(countSlots(out)).toBe(0)
    const rootGroup = out.firstChild!
    expect(rootGroup.childCount).toBe(2)
    expect(rootGroup.lastChild!.attrs.id).toBe('inner')
    expect(rootGroup.lastChild!.firstChild!.textContent).toBe('lifted')
  })

  it('leaves a valid slot untouched', () => {
    const d = doc(schema, [
      blockNode('p1', [para('test')]),
      blockNode('slotWrap', [slot('Unordered'), group('Unordered', [blockNode('item', [para('bullet')])])]),
    ])
    expect(collectSlotFixes(d)).toHaveLength(0)
  })

  it('plugin heals an orphaned slot on the next docChanged transaction', () => {
    const d = doc(schema, [blockNode('p1', [para('test')]), blockNode('orphan', [slot('Unordered')])])
    const state = EditorState.create({doc: d, schema, plugins: [createSlotNormalizationPlugin()]})
    // Any doc-changing transaction should trigger the appendTransaction cleanup.
    const textPos = 3
    const newState = state.apply(state.tr.insertText('x', textPos))
    expect(countSlots(newState.doc)).toBe(0)
  })
})
