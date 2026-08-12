import {describe, expect, test} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {createExploreEditorState, exploreEditorReducer, highlightExploreText} from '../explore-page'
import {parseExploreQuery} from '@shm/shared/explore'

describe('Explore highlighting', () => {
  test('highlights case-insensitive terms and phrases', () => {
    const html = renderToStaticMarkup(
      highlightExploreText('Engelbart wrote about search APIs', ['engelbart', '"search APIs"']),
    )
    expect(html).toContain('<mark')
    expect(html).toContain('Engelbart')
    expect(html).toContain('search APIs')
  })

  test('treats regex metacharacters as literal query text', () => {
    const html = renderToStaticMarkup(highlightExploreText('Use C++ (v2)', ['C++', '(v2)']))
    expect(html.match(/<mark/g)).toHaveLength(2)
  })
})

describe('Explore editor coordination', () => {
  test('a control commit wins over a previously scheduled draft', () => {
    const initial = createExploreEditorState('', null)
    const withDraft = exploreEditorReducer(initial, {type: 'set-draft', draft: 'engelbart'})
    const committed = exploreEditorReducer(withDraft, {
      type: 'commit-query',
      query: 'engelbart type:task',
      builderAst: parseExploreQuery('engelbart type:task').ast,
    })

    expect(committed.draftQuery).toBe('engelbart type:task')
    expect(committed.draft).toBe('engelbart type:task')
  })

  test('a menu commit preserves an uncommitted input draft in the committed query', () => {
    const initial = createExploreEditorState('', null)
    const withDraft = exploreEditorReducer(initial, {type: 'set-draft', draft: 'engelbart'})
    const committed = exploreEditorReducer(withDraft, {
      type: 'commit-query',
      query: 'engelbart type:task',
    })

    expect(committed.draftQuery).toBe('engelbart type:task')
    expect(committed.draft).toContain('engelbart')
    expect(committed.draft).toContain('type:task')
  })

  test('control commits expose the exact query consumed by the results hook', () => {
    const query = 'status:done view:table cols:title,status sort:-status'
    const state = exploreEditorReducer(createExploreEditorState('', null), {
      type: 'commit-query',
      query,
    })

    expect(state.draftQuery).toBe(query)
    expect(state.builderQuery).toBe('')
  })
})
