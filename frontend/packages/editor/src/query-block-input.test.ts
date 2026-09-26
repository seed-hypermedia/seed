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
