import {describe, expect, it} from 'vitest'
import {editorBlockToHMBlock} from './editorblock-to-hmblock'
import {hmBlockToEditorBlock} from './hmblock-to-editorblock'
import {HMBlockQuerySchema, HMQueryViewSchema, parseHMQueryViewJSON} from './hm-types'
import type {EditorQueryBlock} from './editor-types'

const filters = [{columnId: 'metadata:Status', operator: 'notEquals' as const, value: 'Done'}]
function queryBlock() {
  return HMBlockQuerySchema.parse({
    id: 'tasks',
    type: 'Query',
    text: '',
    annotations: [],
    attributes: {
      query: {
        includes: [{space: 'alice', path: 'tasks', mode: 'Children'}],
        sort: [{term: 'updated', reverse: true}],
        limit: 10,
        filters: [{type: 'Author', uid: 'bob'}],
      },
      style: 'Table',
      columnCount: 3,
      banner: true,
      table: {columns: [{id: 'metadata:Status', visible: true}]},
      view: {filters},
    },
  })
}
describe('shared Query View data', () => {
  it('round-trips through editor conversion without changing query or presentation', () => {
    const original = queryBlock()
    expect(editorBlockToHMBlock(hmBlockToEditorBlock(original))).toEqual(original)
  })
  it('saves an explicit empty View when filters are cleared', () => {
    const editor = hmBlockToEditorBlock(queryBlock()) as EditorQueryBlock
    editor.props.queryView = JSON.stringify({filters: []})
    const saved = editorBlockToHMBlock(editor)
    expect(saved.type === 'Query' && saved.attributes.view).toEqual({filters: []})
  })
  it('keeps older blocks without a View unchanged', () => {
    const original = queryBlock()
    delete original.attributes.view
    expect(editorBlockToHMBlock(hmBlockToEditorBlock(original))).toEqual(original)
  })
  it.each(['', '{', '{"filters":false}', '{"filters":[{"columnId":"title","operator":"execute","value":"x"}]}'])(
    'handles invalid draft reader data: %s',
    (raw) => {
      expect(parseHMQueryViewJSON(raw)).toBeUndefined()
    },
  )
  it('rejects malformed View data at publication rather than silently dropping it', () => {
    const editor = hmBlockToEditorBlock(queryBlock()) as EditorQueryBlock
    editor.props.queryView = '{"filters":false}'
    expect(() => editorBlockToHMBlock(editor)).toThrow()
  })
  it.each(['contains', 'equals', 'notEquals', 'greaterThan', 'lessThan'])(
    'supports existing operator %s',
    (operator) => {
      expect(HMQueryViewSchema.safeParse({filters: [{...filters[0], operator}]}).success).toBe(true)
    },
  )
})
