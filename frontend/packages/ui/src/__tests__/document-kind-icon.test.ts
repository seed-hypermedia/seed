import {describe, expect, it} from 'vitest'
import {getDocumentKind} from '../document-kind-icon'

describe('getDocumentKind', () => {
  it('reads agent mounts from the type attribute, ahead of collection and privacy', () => {
    expect(
      getDocumentKind({metadata: {type: 'hm://hyper.media/agent'}, isCollection: true, visibility: 'PRIVATE'}),
    ).toBe('agent')
  })

  it('prefers collection over private, and private over a plain document', () => {
    expect(getDocumentKind({isCollection: true, visibility: 'PRIVATE'})).toBe('collection')
    expect(getDocumentKind({visibility: 'PRIVATE'})).toBe('private')
    expect(getDocumentKind({metadata: {type: 'hm://example.com/other'}})).toBe('document')
    expect(getDocumentKind({metadata: null})).toBe('document')
  })
})
