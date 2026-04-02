import {Schema} from 'prosemirror-model'
import {EditorState, Plugin, TextSelection} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {beforeEach, describe, expect, it} from 'vitest'

/**
 * Phase 1 regression tests — readOnly guards.
 *
 * Validates that:
 *  1. The markdown paste handler does not fire in readOnly
 *  2. EditorView.editable reflects the configuration
 *
 * These tests operate at the ProseMirror level to avoid React/TipTap deps.
 */

/** Schema with toDOM specs so EditorView can render in jsdom. */
function createRenderableSchema(): Schema {
  return new Schema({
    nodes: {
      doc: {content: 'blockChildren'},
      blockChildren: {
        content: 'blockNode+',
        attrs: {listType: {default: 'Group'}},
        toDOM() {
          return ['div', {class: 'block-children'}, 0]
        },
      },
      blockNode: {
        content: 'paragraph blockChildren?',
        attrs: {id: {default: null}},
        toDOM(node) {
          return ['div', {'data-id': node.attrs.id}, 0]
        },
      },
      paragraph: {
        content: 'text*',
        group: 'block',
        toDOM() {
          return ['p', 0]
        },
      },
      text: {group: 'inline'},
    },
  })
}

/** Build a simple doc with one block. */
function buildSimpleDoc(schema: Schema, blockId: string, text: string) {
  const para = text ? schema.nodes['paragraph']!.create(null, schema.text(text)) : schema.nodes['paragraph']!.create()
  const block = schema.nodes['blockNode']!.create({id: blockId}, [para])
  const children = schema.nodes['blockChildren']!.create(null, [block])
  return schema.nodes['doc']!.create(null, children)
}

/** Find the text position inside a block by id. */
function findPos(doc: any, blockId: string): number {
  let found = -1
  doc.descendants((node: any, pos: number) => {
    if (found === -1 && node.type.name === 'blockNode' && node.attrs.id === blockId) {
      found = pos + 2 // inside blockNode > inside paragraph
    }
  })
  if (found === -1) throw new Error(`Block "${blockId}" not found`)
  return found
}

describe('readOnly guards (Phase 1)', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createRenderableSchema()
  })

  function createView(opts: {editable: boolean; plugins?: Plugin[]; blockText?: string}): EditorView {
    const doc = buildSimpleDoc(schema, 'b1', opts.blockText ?? 'hello')
    const state = EditorState.create({
      doc,
      schema,
      plugins: opts.plugins ?? [],
      selection: TextSelection.create(doc, findPos(doc, 'b1')),
    })
    const container = document.createElement('div')
    return new EditorView(container, {
      state,
      editable: () => opts.editable,
    })
  }

  describe('markdown paste handler guard', () => {
    // Replicates the core guard from MarkdownExtension.ts
    const pasteGuardPlugin = new Plugin({
      props: {
        handlePaste: (view, _event, _slice) => {
          if (!view.editable) return false
          return true
        },
      },
    })

    it('blocks paste in readOnly mode', () => {
      const view = createView({editable: false, plugins: [pasteGuardPlugin]})
      // jsdom doesn't define ClipboardEvent — use a minimal mock
      const fakeEvent = {clipboardData: {getData: () => ''}} as unknown as ClipboardEvent
      const handled = pasteGuardPlugin.props.handlePaste!(view, fakeEvent, view.state.doc.slice(0))
      expect(handled).toBe(false)
      view.destroy()
    })

    it('allows paste in editable mode', () => {
      const view = createView({editable: true, plugins: [pasteGuardPlugin]})
      const fakeEvent = {clipboardData: {getData: () => ''}} as unknown as ClipboardEvent
      const handled = pasteGuardPlugin.props.handlePaste!(view, fakeEvent, view.state.doc.slice(0))
      expect(handled).toBe(true)
      view.destroy()
    })
  })

  describe('EditorView.editable', () => {
    it('reports editable: true when configured as editable', () => {
      const view = createView({editable: true})
      expect(view.editable).toBe(true)
      view.destroy()
    })

    it('reports editable: false when configured as readOnly', () => {
      const view = createView({editable: false})
      expect(view.editable).toBe(false)
      view.destroy()
    })
  })
})
