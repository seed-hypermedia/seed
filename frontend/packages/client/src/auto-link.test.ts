import {describe, expect, it} from 'vitest'
import {documentHasSelfQuery, shouldAutoLinkParent} from './auto-link'
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

describe('shouldAutoLinkParent', () => {
  it('leaves a typed collection alone: it lists its records itself', () => {
    const child = unpackHmId('hm://alice/notes/n1')!
    const plain = {content: [], metadata: {}} as any
    const typed = {content: [], metadata: {childAttributesSchema: 'hm://alice/types/note'}} as any
    expect(shouldAutoLinkParent(false, plain, child, documentId)).toBe(true)
    expect(shouldAutoLinkParent(false, typed, child, documentId)).toBe(false)
  })
})
