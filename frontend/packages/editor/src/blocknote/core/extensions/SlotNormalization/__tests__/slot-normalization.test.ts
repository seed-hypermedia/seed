import {Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {beforeEach, describe, expect, it} from 'vitest'
import {createMinimalSchema} from '../../../api/blockManipulation/__tests__/test-helpers-prosemirror'
import {
  applySlotFixes,
  collectSlotFixes,
  createSlotNormalizationPlugin,
  firstNonRootSlotUnwrap,
  firstSlotMergeSeam,
} from '../SlotNormalizationExtension'

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

  it('does not normalize while suppressed', () => {
    const d = doc(schema, [blockNode('p1', [para('test')]), blockNode('orphan', [slot('Unordered')])])
    const state = EditorState.create({
      doc: d,
      schema,
      plugins: [createSlotNormalizationPlugin(() => true)],
    })
    const newState = state.apply(state.tr.insertText('x', 3))
    // The orphan slot must survive: load/rebase reconcile content by id, so the
    // normalizer must not mutate (and delete ids) during those transactions.
    expect(countSlots(newState.doc)).toBe(1)
  })
})

describe('adjacent slot merging', () => {
  let schema: Schema
  beforeEach(() => {
    schema = createMinimalSchema()
  })

  function item(id: string, text: string) {
    return blockNode(id, [para(text)])
  }
  function slotWrap(id: string, childrenType: string, items: any[]) {
    return blockNode(id, [slot(childrenType), group(childrenType, items)])
  }
  // Simulate the appendTransaction loop: merge adjacent pairs until none remain.
  function mergeToFixedPoint(d: any) {
    let state = EditorState.create({doc: d, schema})
    for (let guard = 0; guard < 20; guard++) {
      const seam = firstSlotMergeSeam(state.doc)
      if (!seam) break
      state = state.apply(state.tr.delete(seam.from, seam.to))
    }
    return state.doc
  }

  it('merges two adjacent same-type slots into one list', () => {
    const d = doc(schema, [
      slotWrap('s1', 'Unordered', [item('a', 'a')]),
      slotWrap('s2', 'Unordered', [item('b', 'b')]),
    ])
    const out = mergeToFixedPoint(d)
    expect(countSlots(out)).toBe(1)
    const merged = out.firstChild!.firstChild!
    expect(merged.firstChild!.type.name).toBe('slot')
    const innerGroup = merged.lastChild!
    expect(innerGroup.type.name).toBe('blockChildren')
    expect(innerGroup.attrs.listType).toBe('Unordered')
    expect(innerGroup.childCount).toBe(2)
    expect(innerGroup.child(0).firstChild!.textContent).toBe('a')
    expect(innerGroup.child(1).firstChild!.textContent).toBe('b')
  })

  it('collapses three adjacent slots into one list', () => {
    const d = doc(schema, [
      slotWrap('s1', 'Unordered', [item('a', 'a')]),
      slotWrap('s2', 'Unordered', [item('b', 'b')]),
      slotWrap('s3', 'Unordered', [item('c', 'c')]),
    ])
    const out = mergeToFixedPoint(d)
    expect(countSlots(out)).toBe(1)
    expect(out.firstChild!.firstChild!.lastChild!.childCount).toBe(3)
  })

  it('collapses three adjacent slots in a single transaction', () => {
    const d = doc(schema, [
      slotWrap('s1', 'Unordered', [item('a', 'a')]),
      slotWrap('s2', 'Unordered', [item('b', 'b')]),
      slotWrap('s3', 'Unordered', [item('c', 'c')]),
    ])
    const state = EditorState.create({doc: d, schema, plugins: [createSlotNormalizationPlugin()]})
    let aPos = -1
    d.descendants((n: any, p: number) => {
      if (n.isText && n.text === 'a') aPos = p
    })
    const newState = state.apply(state.tr.insertText('!', aPos + 1))
    expect(countSlots(newState.doc)).toBe(1)
    expect(newState.doc.firstChild!.firstChild!.lastChild!.childCount).toBe(3)
  })

  it('does not merge slots of different list types', () => {
    const d = doc(schema, [slotWrap('s1', 'Unordered', [item('a', 'a')]), slotWrap('s2', 'Ordered', [item('b', 'b')])])
    expect(firstSlotMergeSeam(d)).toBeNull()
  })

  it('does not merge slots separated by another block', () => {
    const d = doc(schema, [
      slotWrap('s1', 'Unordered', [item('a', 'a')]),
      blockNode('p', [para('between')]),
      slotWrap('s2', 'Unordered', [item('b', 'b')]),
    ])
    expect(firstSlotMergeSeam(d)).toBeNull()
  })

  it('keeps the cursor in the moved item after merging', () => {
    const d = doc(schema, [
      slotWrap('s1', 'Unordered', [item('a', 'a')]),
      slotWrap('s2', 'Unordered', [item('b', 'b')]),
    ])
    let bTextPos = -1
    d.descendants((n: any, p: number) => {
      if (n.isText && n.text === 'b') bTextPos = p
    })
    const state = EditorState.create({doc: d, schema, selection: TextSelection.create(d, bTextPos + 1)})
    const seam = firstSlotMergeSeam(d)!
    const out = state.apply(state.tr.delete(seam.from, seam.to))
    // Cursor should still be inside the item whose text is "b".
    expect(out.selection.$from.parent.textContent).toBe('b')
  })
})

describe('non-root slot unwrapping', () => {
  let schema: Schema
  beforeEach(() => {
    schema = createMinimalSchema()
  })

  function item(id: string, text: string) {
    return blockNode(id, [para(text)])
  }
  function slotWrap(id: string, childrenType: string, items: any[]) {
    return blockNode(id, [slot(childrenType), group(childrenType, items)])
  }
  function unwrapAll(d: any) {
    const state = EditorState.create({doc: d, schema, plugins: [createSlotNormalizationPlugin()]})
    return state.apply(state.tr.insertText('!', 6)).doc
  }

  it('leaves a root-level slot untouched', () => {
    const d = doc(schema, [slotWrap('s1', 'Unordered', [item('a', 'a')])])
    expect(firstNonRootSlotUnwrap(d)).toBeNull()
  })

  it('nests a nested slot list under its previous sibling and drops the slot', () => {
    const d = doc(schema, [
      blockNode('parent', [
        para('parent'),
        group('Group', [blockNode('prev', [para('prev')]), slotWrap('nested', 'Unordered', [item('x', 'x')])]),
      ]),
    ])
    const out = unwrapAll(d)
    expect(countSlots(out)).toBe(0)
    // The list should now be nested under "prev".
    const parentGroup = out.firstChild!.firstChild!.lastChild!
    expect(parentGroup.childCount).toBe(1)
    const prev = parentGroup.firstChild!
    expect(prev.attrs.id).toBe('prev')
    expect(prev.lastChild!.type.name).toBe('blockChildren')
    expect(prev.lastChild!.attrs.listType).toBe('Unordered')
    expect(prev.lastChild!.firstChild!.firstChild!.textContent).toBe('x')
  })

  it('flattens a same type slot nested inside a root slot list', () => {
    const d = doc(schema, [
      blockNode('rootSlot', [
        slot('Unordered'),
        group('Unordered', [item('a', 'a'), item('b', 'b'), slotWrap('nested', 'Unordered', [item('x', 'x')])]),
      ]),
    ])
    const out = unwrapAll(d)
    // Only the root slot remains; the pasted item joins the list as a sibling.
    expect(countSlots(out)).toBe(1)
    const rootList = out.firstChild!.firstChild!.lastChild!
    expect(rootList.childCount).toBe(3)
    expect(rootList.child(1).firstChild!.textContent).toBe('b')
    expect(rootList.child(2).firstChild!.textContent).toBe('x')
    // The pasted item is a plain sibling, not a nested sub-list under "b".
    expect(rootList.child(1).childCount).toBe(1)
    expect(rootList.child(2).childCount).toBe(1)
  })

  it('nests a different type slot under the previous item instead of flattening', () => {
    const d = doc(schema, [
      blockNode('rootSlot', [
        slot('Unordered'),
        group('Unordered', [item('a', 'a'), slotWrap('nested', 'Ordered', [item('x', 'x')])]),
      ]),
    ])
    const out = unwrapAll(d)
    expect(countSlots(out)).toBe(1)
    const rootList = out.firstChild!.firstChild!.lastChild!
    expect(rootList.childCount).toBe(1)
    const a = rootList.child(0)
    expect(a.lastChild!.type.name).toBe('blockChildren')
    expect(a.lastChild!.attrs.listType).toBe('Ordered')
  })

  it('falls back to an empty paragraph when there is no mergeable previous block', () => {
    // nested slot is the first child of a nested group with no previous siblings.
    const d = doc(schema, [
      blockNode('parent', [para('parent'), group('Group', [slotWrap('nested', 'Unordered', [item('x', 'x')])])]),
    ])
    const out = unwrapAll(d)
    expect(countSlots(out)).toBe(0)
    const wrapper = out.firstChild!.firstChild!.lastChild!.firstChild!
    expect(wrapper.firstChild!.type.name).toBe('paragraph')
    expect(wrapper.lastChild!.type.name).toBe('blockChildren')
    expect(wrapper.lastChild!.attrs.listType).toBe('Unordered')
  })

  it('does not nest a list under a table', () => {
    // A table can't carry a nested blockChildren, so a slot whose previous
    // sibling is a table must not merge into it.
    const d = doc(schema, [
      blockNode('parent', [
        para('parent'),
        group('Group', [
          {type: 'blockNode', attrs: {id: 'tbl'}, content: [{type: 'table', content: [{type: 'text', text: 'cell'}]}]},
          slotWrap('nested', 'Unordered', [item('x', 'x')]),
        ]),
      ]),
    ])
    const out = unwrapAll(d)
    expect(countSlots(out)).toBe(0)
    const nestedGroup = out.firstChild!.firstChild!.lastChild!
    expect(nestedGroup.child(0).firstChild!.type.name).toBe('table')
    expect(nestedGroup.child(0).childCount).toBe(1)
    const wrapper = nestedGroup.child(1)
    expect(wrapper.firstChild!.type.name).toBe('paragraph')
    expect(wrapper.lastChild!.type.name).toBe('blockChildren')
    expect(wrapper.lastChild!.attrs.listType).toBe('Unordered')
  })
})
