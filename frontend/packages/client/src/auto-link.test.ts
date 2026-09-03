import {describe, expect, it} from 'vitest'
import {documentHasSelfQuery} from './auto-link'
import {unpackHmId} from './hm-types'

const documentId = unpackHmId('hm://alice/notes')!

function documentWithIncludes(includes?: unknown[]) {
  return {
    content: [
      {
        block: {
          id: 'query',
          type: 'Query',
          attributes: includes === undefined ? {} : {query: {includes}},
        },
        children: [],
      },
    ],
  } as any
}

describe('documentHasSelfQuery', () => {
  it('recognizes the implicit empty target used by new collections', () => {
    expect(documentHasSelfQuery(documentWithIncludes([{}]), documentId)).toBe(true)
    expect(documentHasSelfQuery(documentWithIncludes([]), documentId)).toBe(true)
    expect(documentHasSelfQuery(documentWithIncludes(), documentId)).toBe(true)
  })
})
