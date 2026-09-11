import {Schema} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
import {createMentionSuggestionPlugin, mentionSuggestionPluginKey} from './mention-suggestion-plugin'

const schema = new Schema({
  nodes: {doc: {content: 'paragraph+'}, paragraph: {content: 'text*'}, text: {}},
  marks: {code: {}, link: {}},
})
function state(text = '') {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, text ? schema.text(text) : undefined)])
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, text.length + 1),
    plugins: [createMentionSuggestionPlugin({onKeyboard: () => {}}).plugin],
  })
}
describe('mention triggers', () => {
  it.each([
    ['@', 'account'],
    ['[[', 'document'],
  ])('recognizes typed %s from document transactions', (trigger, mode) => {
    let s = state()
    for (const char of trigger) s = s.apply(s.tr.insertText(char))
    expect(mentionSuggestionPluginKey.getState(s)).toMatchObject({active: true, mode, from: 1, to: trigger.length + 1})
  })
  it.each(['email@', 'word[['])('does not activate inside %s', (text) => {
    let s = state()
    s = s.apply(s.tr.insertText(text))
    expect(mentionSuggestionPluginKey.getState(s).active).toBe(false)
  })
  it('preserves typed text and does not reopen after cancellation', () => {
    let s = state()
    s = s.apply(s.tr.insertText('@'))
    s = s.apply(s.tr.setMeta(mentionSuggestionPluginKey, {deactivate: true}))
    s = s.apply(s.tr.insertText('a'))
    expect(s.doc.textContent).toBe('@a')
    expect(mentionSuggestionPluginKey.getState(s).active).toBe(false)
  })
  it('deactivates when the trigger is deleted', () => {
    let s = state()
    s = s.apply(s.tr.insertText('@'))
    s = s.apply(s.tr.delete(1, 2))
    expect(mentionSuggestionPluginKey.getState(s).active).toBe(false)
  })
  it('does not activate in code or link marks', () => {
    for (const mark of [schema.marks.code!, schema.marks.link!]) {
      let s = state()
      s = s.apply(s.tr.addStoredMark(mark.create()).insertText('@'))
      expect(mentionSuggestionPluginKey.getState(s).active).toBe(false)
    }
  })
  it('waits for composition to finish before opening the picker', () => {
    let s = state()
    s = s.apply(s.tr.insertText('@Alice').setMeta('composition', 1))
    expect(mentionSuggestionPluginKey.getState(s)?.active).toBe(false)
    s = s.apply(s.tr.setMeta(mentionSuggestionPluginKey, {composing: false}))
    expect(mentionSuggestionPluginKey.getState(s)).toMatchObject({
      active: true,
      mode: 'account',
      from: 1,
      to: 7,
      queryStartPos: 2,
    })
  })
  it('maps a suspended range during unrelated edits', () => {
    let s = state('Hello ')
    s = s.apply(s.tr.insertText('[['))
    s = s.apply(s.tr.setMeta(mentionSuggestionPluginKey, {suspend: true}))
    s = s.apply(s.tr.insertText('X', 1))
    expect(mentionSuggestionPluginKey.getState(s)).toMatchObject({active: true, from: 8, to: 10, suspended: true})
  })
})
