// @vitest-environment jsdom
import {Schema} from 'prosemirror-model'
import {EditorState, PluginKey, TextSelection} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {isSlashMenuEnabled} from '../extensions/SlashMenu/SlashMenuPlugin'
import {setupSuggestionsMenu} from '../shared/plugins/suggestion/SuggestionPlugin'

function createSchema(): Schema {
  return new Schema({
    nodes: {
      doc: {content: 'block+'},
      paragraph: {
        group: 'block',
        content: 'text*',
        toDOM() {
          return ['p', 0]
        },
      },
      image: {
        group: 'block',
        content: 'text*',
        toDOM() {
          return ['figcaption', 0]
        },
      },
      text: {group: 'inline'},
    },
  })
}

function createDoc(schema: Schema) {
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null),
    schema.nodes.image.create(null, schema.text('caption')),
  ])
}

function findPos(doc: any, nodeType: string, offset = 1): number {
  let found = -1
  doc.descendants((node: any, pos: number) => {
    if (found === -1 && node.type.name === nodeType) {
      found = pos + offset
    }
  })
  if (found === -1) throw new Error(`Node "${nodeType}" not found`)
  return found
}

describe('slash menu caption guards', () => {
  let schema: Schema

  beforeEach(() => {
    schema = createSchema()
  })

  function createView(selectionPos: number) {
    const doc = createDoc(schema)
    const pluginKey = new PluginKey('test-slash-menu')
    const plugin = setupSuggestionsMenu(
      {
        isEditable: true,
        _tiptapEditor: {
          chain: () => ({
            focus: () => ({
              deleteRange: () => ({
                run: vi.fn(),
              }),
            }),
          }),
          state: {selection: {from: selectionPos}},
        },
      } as any,
      () => {},
      pluginKey,
      '/',
      () => [{name: 'Paragraph'} as any],
      () => {},
      {isEnabled: isSlashMenuEnabled},
    ).plugin

    const state = EditorState.create({
      doc,
      schema,
      plugins: [plugin],
      selection: TextSelection.create(doc, selectionPos),
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = new EditorView(container, {
      state,
      editable: () => true,
    })

    return {plugin, pluginKey, view}
  }

  it('allows slash menu in paragraphs', () => {
    const {view, pluginKey, plugin} = createView(findPos(createDoc(schema), 'paragraph', 1))

    const handled = plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', {key: '/'}))

    expect(handled).toBe(true)
    expect(pluginKey.getState(view.state).active).toBe(true)
    view.destroy()
    view.dom.parentElement?.remove()
  })

  it('blocks slash menu inside image captions', () => {
    const {view, pluginKey, plugin} = createView(findPos(createDoc(schema), 'image', 1))

    const handled = plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', {key: '/'}))

    expect(handled).toBe(false)
    expect(pluginKey.getState(view.state).active).toBe(false)
    view.destroy()
    view.dom.parentElement?.remove()
  })

  it('closes an active slash menu when selection moves into an image caption', () => {
    const doc = createDoc(schema)
    const paragraphPos = findPos(doc, 'paragraph', 1)
    const {view, pluginKey} = createView(paragraphPos)

    view.dispatch(
      view.state.tr.insertText('/').setMeta(pluginKey, {
        activate: true,
        triggerCharacter: '/',
      }),
    )
    expect(pluginKey.getState(view.state).active).toBe(true)

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, findPos(view.state.doc, 'image', 1))))

    expect(pluginKey.getState(view.state).active).toBe(false)
    view.destroy()
    view.dom.parentElement?.remove()
  })
})
