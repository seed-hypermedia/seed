import {Node as TipTapNode, Schema} from '@tiptap/pm/model'
import {describe, expect, it} from 'vitest'
import type {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {buildBlockGroupsById, getBlockGroup} from './utils'

/**
 * Regression tests for #884: serverBlockNodesFromEditorBlocks used to call
 * getBlockGroup (a full-document traversal) once per block, making every
 * serialization O(n²) in document size. buildBlockGroupsById replaces that
 * with a single traversal; these tests pin its equivalence to getBlockGroup
 * and its scaling advantage.
 */

// Minimal schema mirroring the parts of the editor schema that getBlockGroup
// inspects: containers carry an `id` attr, `blockChildren` carries list attrs.
const schema = new Schema({
  nodes: {
    doc: {content: 'blockGroup'},
    blockGroup: {content: 'blockContainer+'},
    blockContainer: {
      content: 'paragraph blockChildren?',
      attrs: {id: {default: null}},
    },
    blockChildren: {
      content: 'blockContainer+',
      attrs: {
        listType: {default: null},
        listLevel: {default: '1'},
        start: {default: null},
        columnCount: {default: null},
      },
    },
    paragraph: {content: 'text*'},
    text: {},
  },
})

type BlockSpec = {
  id: string
  listType?: string
  start?: number
  columnCount?: string
  children?: BlockSpec[]
}

function createBlock(spec: BlockSpec): TipTapNode {
  const content: TipTapNode[] = [schema.nodes.paragraph!.create(null, schema.text(`text of ${spec.id}`))]
  if (spec.children?.length) {
    content.push(
      schema.nodes.blockChildren!.create(
        {
          listType: spec.listType ?? null,
          start: spec.start ?? null,
          columnCount: spec.columnCount ?? null,
          listLevel: '1',
        },
        spec.children.map(createBlock),
      ),
    )
  }
  return schema.nodes.blockContainer!.create({id: spec.id}, content)
}

function createDoc(specs: BlockSpec[]): TipTapNode {
  return schema.nodes.doc!.create(null, schema.nodes.blockGroup!.create(null, specs.map(createBlock)))
}

function collectIds(specs: BlockSpec[]): string[] {
  return specs.flatMap((spec) => [spec.id, ...collectIds(spec.children ?? [])])
}

function fakeEditor(doc: TipTapNode): BlockNoteEditor {
  return {_tiptapEditor: {state: {doc}}} as unknown as BlockNoteEditor
}

function expectEquivalence(specs: BlockSpec[]) {
  const doc = createDoc(specs)
  const editor = fakeEditor(doc)
  const groupsById = buildBlockGroupsById(doc)
  for (const id of collectIds(specs)) {
    expect(groupsById.get(id), `group for block ${id}`).toEqual(getBlockGroup(editor, id))
  }
}

describe('buildBlockGroupsById', () => {
  it('matches getBlockGroup for flat blocks without child groups', () => {
    expectEquivalence([{id: 'a'}, {id: 'b'}, {id: 'c'}])
  })

  it('matches getBlockGroup for blocks with list groups and attributes', () => {
    expectEquivalence([
      {id: 'a', listType: 'Unordered', children: [{id: 'a1'}, {id: 'a2'}]},
      {id: 'b', listType: 'Ordered', start: 3, children: [{id: 'b1'}]},
      {id: 'c', listType: 'Grid', columnCount: '2', children: [{id: 'c1'}, {id: 'c2'}]},
      {id: 'd'},
    ])
  })

  it('matches getBlockGroup for deeply nested mixed groups', () => {
    expectEquivalence([
      {
        id: 'a',
        listType: 'Unordered',
        children: [
          {id: 'a1', listType: 'Ordered', start: 2, children: [{id: 'a1x'}, {id: 'a1y'}]},
          {id: 'a2', listType: 'Group', children: [{id: 'a2x'}]},
        ],
      },
      {id: 'b', listType: 'Group', children: [{id: 'b1', listType: 'Unordered', children: [{id: 'b1x'}]}]},
    ])
  })

  it('matches getBlockGroup when a parent group has no listType but a nested one does', () => {
    // getBlockGroup returns the first blockChildren descendant with a
    // listType, even if it belongs to a nested block; preserve that quirk.
    expectEquivalence([
      {
        id: 'a',
        children: [{id: 'a1', listType: 'Ordered', children: [{id: 'a1x'}]}],
      },
    ])
  })

  it('scales linearly: single traversal beats per-block getBlockGroup on a large document', () => {
    const specs: BlockSpec[] = Array.from({length: 1200}, (_, i) => ({
      id: `block-${i}`,
      listType: 'Unordered',
      children: [{id: `block-${i}-child`}],
    }))
    const doc = createDoc(specs)
    const editor = fakeEditor(doc)
    const ids = collectIds(specs)

    const oldStart = performance.now()
    const oldGroups = new Map(ids.map((id) => [id, getBlockGroup(editor, id)]))
    const oldElapsed = performance.now() - oldStart

    const newStart = performance.now()
    const groupsById = buildBlockGroupsById(doc)
    const newElapsed = performance.now() - newStart

    for (const id of ids) {
      expect(groupsById.get(id)).toEqual(oldGroups.get(id))
    }

    // The old path is O(blocks × document size) — ~90x slower at this size
    // (measured ~228ms vs ~2.5ms), so this comparison has a wide safety margin.
    expect(newElapsed).toBeLessThan(oldElapsed)
  })
})
