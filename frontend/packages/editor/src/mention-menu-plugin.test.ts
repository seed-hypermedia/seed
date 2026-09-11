import {Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
import {MentionMenuProsemirrorPlugin} from './mention-menu-plugin'
import {mentionSuggestionPluginKey} from './mention-suggestion-plugin'
const schema = new Schema({
  nodes: {
    doc: {content: 'paragraph+'},
    paragraph: {content: 'inline*'},
    text: {group: 'inline'},
    'inline-embed': {inline: true, group: 'inline', atom: true, attrs: {link: {}, mentionKind: {default: null}}},
  },
})
function setup() {
  const editor = {_tiptapEditor: {view: undefined as any}}
  const menu = new MentionMenuProsemirrorPlugin(editor as any)
  const doc = schema.node('doc', null, [schema.node('paragraph')])
  const view = {
    state: EditorState.create({schema, doc, plugins: [menu.plugin]}),
    dispatch(tr: any) {
      this.state = this.state.apply(tr)
    },
  }
  editor._tiptapEditor.view = view
  return {menu, view}
}
describe('shared mention insertion', () => {
  it('consumes both brackets and preserves the explicit document kind', () => {
    const {menu, view} = setup()
    view.dispatch(view.state.tr.insertText('[['))
    view.dispatch(view.state.tr.insertText('Doc]]'))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)))
    menu.insertMention('hm://site/doc?v=abc&l', 'document')
    expect(view.state.doc.textContent).toBe(' ')
    expect(view.state.doc.firstChild!.firstChild!.attrs).toEqual({
      link: 'hm://site/doc?v=abc&l',
      mentionKind: 'document',
    })
    expect(view.state.selection.from).toBe(3)
  })
  it('restores a selected toolbar range on cancel without modifying text', () => {
    const {menu, view} = setup()
    view.dispatch(view.state.tr.insertText('Hello world'))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)))
    menu.open('account')
    menu.suspend()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)))
    menu.close()
    expect(view.state.selection.from).toBe(1)
    expect(view.state.selection.to).toBe(6)
    expect(view.state.doc.textContent).toBe('Hello world')
  })
  it('refuses insertion when the saved trigger range has been removed', () => {
    const {menu, view} = setup()
    view.dispatch(view.state.tr.insertText('@'))
    menu.suspend()
    view.dispatch(view.state.tr.delete(1, 2))
    menu.insertMention('hm://a/:profile', 'account')
    expect(view.state.doc.textContent).toBe('')
    expect(mentionSuggestionPluginKey.getState(view.state)?.active).toBe(false)
  })
})
