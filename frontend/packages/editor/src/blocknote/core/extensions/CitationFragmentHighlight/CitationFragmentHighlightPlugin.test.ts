// @vitest-environment jsdom
import type {CitationFragmentClick, CitationFragmentHighlight} from '@shm/shared/document-content-props'
import {Schema} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {describe, expect, it, vi} from 'vitest'
import {
  citationFragmentHighlightPluginKey,
  createCitationFragmentHighlightPlugin,
} from './CitationFragmentHighlightPlugin'

function createSchema(): Schema {
  return new Schema({
    nodes: {
      doc: {content: 'blockNode+'},
      blockNode: {
        content: 'paragraph',
        attrs: {id: {default: ''}},
        toDOM(node) {
          return ['div', {dataId: node.attrs.id}, 0]
        },
      },
      paragraph: {
        group: 'block',
        content: 'text*',
        toDOM() {
          return ['p', 0]
        },
      },
      text: {group: 'inline'},
    },
  })
}

function citation(id: string, start: number, end: number): CitationFragmentHighlight {
  return {
    id,
    targetBlockId: 'block-1',
    targetRange: {start, end},
    sourceType: 'document',
    sourceId: null,
    sourceDocumentId: null,
    sourceBlockId: null,
    sourceCommentId: null,
    sourceAuthorUid: null,
    raw: {source: `hm://source/${id}`, targetFragment: `block-1[${start}:${end}]`},
  }
}

function createView(onClick = vi.fn()) {
  const schema = createSchema()
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.blockNode.create({id: 'block-1'}, schema.nodes.paragraph.create(null, schema.text('hello world'))),
  ])
  const plugin = createCitationFragmentHighlightPlugin({current: onClick})
  const state = EditorState.create({schema, doc, plugins: [plugin]})
  const view = new EditorView(document.createElement('div'), {state})
  return {view, plugin, onClick}
}

describe('CitationFragmentHighlightPlugin', () => {
  it('renders split inline decorations for overlapping citation fragments', () => {
    const {view} = createView()

    view.dispatch(
      view.state.tr
        .setMeta(citationFragmentHighlightPluginKey, {
          type: 'set',
          citations: [citation('a', 0, 5), citation('b', 3, 8)],
        })
        .setMeta('addToHistory', false),
    )

    const pluginState = citationFragmentHighlightPluginKey.getState(view.state)
    const decorations = pluginState?.decorations.find() ?? []

    expect(decorations).toHaveLength(3)
    expect(decorations.map((deco) => deco.spec.class || deco.type.attrs.class)).toEqual([
      expect.stringContaining('bn-citation-fragment-overlap-1'),
      expect.stringContaining('bn-citation-fragment-overlap-2'),
      expect.stringContaining('bn-citation-fragment-overlap-1'),
    ])
    view.destroy()
  })

  it('reports every citation covering the clicked position', () => {
    const onClick = vi.fn()
    const {view, plugin} = createView(onClick)

    view.dispatch(
      view.state.tr
        .setMeta(citationFragmentHighlightPluginKey, {
          type: 'set',
          citations: [citation('a', 0, 5), citation('b', 3, 8)],
        })
        .setMeta('addToHistory', false),
    )

    const handled = plugin.props.handleClick?.call(plugin, view, 6, new MouseEvent('click', {clientX: 10, clientY: 20}))

    expect(handled).toBe(true)
    const payload = onClick.mock.calls[0]?.[0] as CitationFragmentClick
    expect(payload.clientX).toBe(10)
    expect(payload.clientY).toBe(20)
    expect(payload.citations.map((item) => item.id).sort()).toEqual(['a', 'b'])
    view.destroy()
  })

  it('keeps highlights visible but ignores clicks when interactivity is disabled', () => {
    const onClick = vi.fn()
    const {view, plugin} = createView(onClick)

    view.dispatch(
      view.state.tr
        .setMeta(citationFragmentHighlightPluginKey, {
          type: 'set',
          citations: [citation('a', 0, 5)],
          interactive: false,
        })
        .setMeta('addToHistory', false),
    )

    const pluginState = citationFragmentHighlightPluginKey.getState(view.state)
    const decorations = pluginState?.decorations.find() ?? []
    expect(decorations).toHaveLength(1)
    expect(decorations[0]?.type.attrs.class).toContain('bn-citation-fragment-highlight')
    expect(decorations[0]?.type.attrs.class).not.toContain('bn-citation-fragment-highlight-interactive')

    const handled = plugin.props.handleClick?.call(plugin, view, 4, new MouseEvent('click', {clientX: 10, clientY: 20}))

    expect(handled).toBe(false)
    expect(onClick).not.toHaveBeenCalled()
    view.destroy()
  })

  it('splits a highlight instead of expanding it when text is inserted inside', () => {
    const onClick = vi.fn()
    const {view, plugin} = createView(onClick)

    view.dispatch(
      view.state.tr
        .setMeta(citationFragmentHighlightPluginKey, {
          type: 'set',
          citations: [citation('a', 0, 5)],
        })
        .setMeta('addToHistory', false),
    )

    const initialRange = citationFragmentHighlightPluginKey.getState(view.state)?.ranges[0]
    expect(initialRange).toBeDefined()

    const insertPos = initialRange!.from + 2
    const initialTo = initialRange!.to
    view.dispatch(view.state.tr.insertText('NEW', insertPos))

    const pluginState = citationFragmentHighlightPluginKey.getState(view.state)
    const ranges = pluginState?.ranges ?? []
    const decorations = pluginState?.decorations.find() ?? []

    expect(ranges).toEqual([
      expect.objectContaining({from: initialRange!.from, to: insertPos}),
      expect.objectContaining({from: insertPos + 3, to: initialTo + 3}),
    ])
    expect(decorations).toHaveLength(2)

    const insertedTextHandled = plugin.props.handleClick?.call(
      plugin,
      view,
      insertPos + 1,
      new MouseEvent('click', {clientX: 10, clientY: 20}),
    )

    expect(insertedTextHandled).toBe(false)
    expect(onClick).not.toHaveBeenCalled()
    view.destroy()
  })
})
