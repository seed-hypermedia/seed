import {describe, expect, it} from 'vitest'
import {getDocumentSelectionObserverKey} from './document-editor'

describe('getDocumentSelectionObserverKey', () => {
  it('returns a key for collapsed selections', () => {
    expect(getDocumentSelectionObserverKey({from: 12, to: 12})).toBe('12:12')
  })

  it('returns a key for range selections', () => {
    expect(getDocumentSelectionObserverKey({from: 12, to: 18})).toBe('12:18')
  })
})
