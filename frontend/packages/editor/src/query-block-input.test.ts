import {HMBlockQuerySchema, type HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmBlockToEditorBlock} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {editorBlockToHMBlock} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {filterQueryBlockDocuments} from '../../shared/src/models/query-block-filter'
import {describe, expect, it} from 'vitest'
import {getQueryBlockInput, resolveQueryIncludes} from './query-block-input'

const EMPTY = JSON.stringify([{space: '', path: '', mode: 'Children'}])

describe('query block input', () => {
  it('has no input for an empty source outside a document', () => {
    expect(getQueryBlockInput({queryIncludes: EMPTY})).toBeNull()
  })

  it('points an empty source at the containing document', () => {
    expect(getQueryBlockInput({queryIncludes: EMPTY}, {uid: 'z6Mkhome', path: []})?.query.includes).toEqual([
      {space: 'z6Mkhome', path: '', mode: 'Children'},
    ])
    expect(
      resolveQueryIncludes([{space: '', path: '', mode: 'AllDescendants'}], {uid: 'z6Mk', path: ['a', 'b']}),
    ).toEqual([{space: 'z6Mk', path: 'a/b', mode: 'AllDescendants'}])
  })

  it('leaves an explicit source alone', () => {
    const includes = [{space: 'z6Mkother', path: 'notes', mode: 'Children'}]
    expect(resolveQueryIncludes(includes, {uid: 'z6Mkhome', path: []})).toEqual(includes)
  })
})

describe('published View input', () => {
  const filters = [{columnId: 'metadata:Status', operator: 'notEquals', value: 'Done'}]
  it('prefetches the same saved filters used by the renderer', () => {
    expect(
      getQueryBlockInput({queryIncludes: EMPTY, queryView: JSON.stringify({filters})}, {uid: 'alice'})?.viewer,
    ).toEqual({filters})
  })
  it('does not add viewer state to legacy requests', () => {
    expect(getQueryBlockInput({queryIncludes: EMPTY}, {uid: 'alice'})).not.toHaveProperty('viewer')
  })
  it('matches the renderer cache key for saved and cleared Views', () => {
    const includes = [{space: 'alice', path: '', mode: 'Children'}]
    const sort = [{term: 'updated', reverse: true}]
    const rendererInput = (activeFilters: typeof filters) => ({
      query: {includes, sort, limit: undefined},
      ...(activeFilters.length ? {viewer: {filters: activeFilters}} : {}),
    })
    expect(getQueryBlockInput({queryIncludes: EMPTY, queryView: JSON.stringify({filters})}, {uid: 'alice'})).toEqual(
      rendererInput(filters),
    )
    expect(getQueryBlockInput({queryIncludes: EMPTY, queryView: '{"filters":[]}'}, {uid: 'alice'})).toEqual(
      rendererInput([]),
    )
  })
  it('keeps nonempty legacy query filters in the prefetch request', () => {
    expect(
      getQueryBlockInput(
        {queryIncludes: EMPTY, queryFilters: JSON.stringify([{type: 'Author', uid: 'bob'}])},
        {uid: 'alice'},
      )?.query.filters,
    ).toEqual([{type: 'Author', uid: 'bob'}])
  })
})

it('does not prefetch incomplete saved conditions as active filters', () => {
  expect(
    getQueryBlockInput(
      {
        queryIncludes: EMPTY,
        queryView: JSON.stringify({filters: [{columnId: 'title', operator: 'contains', value: ' '}]}),
      },
      {uid: 'alice'},
    )?.viewer,
  ).toBeUndefined()
})

describe('View data roundtrip through renderer request and real filtering', () => {
  const tasks = ['Done', 'To Do'].map(
    (Status) =>
      ({
        id: {id: `hm://alice/tasks/${Status}`, uid: 'alice', path: ['tasks', Status]},
        path: ['tasks', Status],
        metadata: {name: Status, Status},
        createTime: '',
        updateTime: '',
        authors: [],
      }) as unknown as HMDocumentInfo,
  )
  it('restores filters from document bytes in a new reader without browser storage', () => {
    const block = HMBlockQuerySchema.parse({
      id: 'tasks',
      type: 'Query',
      attributes: {
        query: {includes: [{space: 'alice', path: 'tasks', mode: 'Children'}], sort: []},
        view: {filters: [{columnId: 'metadata:Status', operator: 'notEquals', value: 'Done'}]},
      },
    })
    const encoded = JSON.stringify(editorBlockToHMBlock(hmBlockToEditorBlock(block)))
    const freshReaderBlock = HMBlockQuerySchema.parse(JSON.parse(encoded))
    const editor = hmBlockToEditorBlock(freshReaderBlock)
    expect(editor.type).toBe('query')
    if (editor.type !== 'query') throw new Error('Expected Query')
    const request = getQueryBlockInput(editor.props)
    expect(filterQueryBlockDocuments(tasks, request?.viewer).map((task) => task.metadata.Status)).toEqual(['To Do'])
  })
})
